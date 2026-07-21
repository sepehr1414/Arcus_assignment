// Gemini client.
//
// Structured output is not a nicety here — it is what makes the reply checkable.
// The schema forces the model to declare which catalog entries it used, and
// grounding.ts re-verifies the prose against exactly those entries.

import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { SYSTEM_INSTRUCTION } from "./prompt.js";

export interface AssistantDraft {
  intent: string;
  needs_human: boolean;
  escalation_reason: string;
  cited_product_ids: string[];
  cited_order_number: string;
  reply: string;
}

/** A model call. Injectable so tests can drive the pipeline without a network. */
export type LlmClient = (userTurn: string) => Promise<AssistantDraft>;

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

// Generation happens *after* the webhook has ACKed, so nobody is waiting on
// this timeout — it only bounds how long a conversation can sit unanswered
// before we give up and fall back to the rules. Measured live: even a tiny
// gemini-3.5-flash call can take ~6s under load, so 8s was far too tight.
const TIMEOUT_MS = 30_000;
const ATTEMPTS = 3;
// Backoff between attempts. The API returns 503 "high demand" in bursts;
// retrying instantly just burns the attempt inside the same burst.
const BACKOFF_MS = [0, 2_000, 5_000];

// All fields are required, with "" as the empty sentinel: constrained decoding
// is more reliable when nothing is optional.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: [
        "greeting",
        "product_question",
        "order_status",
        "policy_question",
        "complaint",
        "unsupported",
        "other",
      ],
    },
    needs_human: { type: "boolean" },
    escalation_reason: { type: "string" },
    cited_product_ids: { type: "array", items: { type: "string" } },
    cited_order_number: { type: "string" },
    reply: { type: "string" },
  },
  required: [
    "intent",
    "needs_human",
    "escalation_reason",
    "cited_product_ids",
    "cited_order_number",
    "reply",
  ],
} as const;

/**
 * The configured client, or null when GEMINI_API_KEY is unset — which is the
 * normal case for a fresh checkout, and why the rules fallback exists.
 */
export function createGeminiClient(): LlmClient | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const ai = new GoogleGenAI({ apiKey });

  // Gemini 3.x models "think" before answering, and the default level is slow.
  // This is an extractive task — every fact is already in the prompt — so low
  // thinking is enough, and it roughly halves latency. The knob only exists on
  // 3.x; sending it to a 2.5 model is a 400, hence the guard.
  const thinking = MODEL.startsWith("gemini-3")
    ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
    : {};

  return async function call(userTurn: string): Promise<AssistantDraft> {
    let lastError: unknown;

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      if (BACKOFF_MS[attempt]) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
      }
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
      try {
        const response = await ai.models.generateContent({
          model: MODEL,
          contents: userTurn,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            // Deterministic: the same question yields the same answer, which
            // makes behaviour reproducible and reviewable.
            temperature: 0,
            topP: 1,
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            abortSignal: abort.signal,
            ...thinking,
          },
        });

        const text = response.text;
        if (!text) throw new Error("empty response from Gemini");
        return parseDraft(text);
      } catch (err) {
        lastError = err;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };
}

/**
 * Parse and shape-check the model's JSON. The schema makes this unlikely to
 * fail, but the validator downstream assumes these types, so we do not take the
 * response's word for it.
 */
export function parseDraft(text: string): AssistantDraft {
  const raw = JSON.parse(text) as Record<string, unknown>;

  const asString = (v: unknown) => (typeof v === "string" ? v : "");
  const ids = Array.isArray(raw.cited_product_ids)
    ? raw.cited_product_ids.filter((v): v is string => typeof v === "string")
    : [];

  return {
    intent: asString(raw.intent) || "other",
    needs_human: raw.needs_human === true,
    escalation_reason: asString(raw.escalation_reason),
    cited_product_ids: ids,
    cited_order_number: asString(raw.cited_order_number),
    reply: asString(raw.reply),
  };
}
