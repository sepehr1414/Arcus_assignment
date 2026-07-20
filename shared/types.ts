// Payload delivered to POST /api/webhook by the simulator and seed data.
// How you model conversations internally is up to you.
export interface InboundMessage {
  id: string; // provider message id; may arrive more than once
  from: string; // stable customer id (phone number)
  customerName: string;
  text: string;
  timestamp: string; // ISO 8601
}

// A product from data/catalog.json.
export interface Product {
  id: string;
  name: string;
  category: string;
  color: string;
  price: number;
  inStock: boolean;
}

// Who sent a stored message.
export type Sender = "customer" | "assistant" | "agent";

// A stored message inside a conversation. `id` is the provider id for customer
// messages (used for de-duplication); assistant/agent messages get a generated id.
export interface Message {
  id: string;
  conversationId: string; // = customer phone (from)
  sender: Sender;
  text: string;
  timestamp: string; // ISO 8601
}

// One conversation per customer, keyed by their phone number (`from`).
export interface Conversation {
  id: string; // natural key = customer phone (from)
  customerName: string;
  customerPhone: string; // = from
  messages: Message[];
  lastMessageAt: string; // ISO 8601; drives newest-first sort
}

// Lightweight shape returned by the list endpoint.
export interface ConversationSummary {
  id: string;
  customerName: string;
  customerPhone: string;
  preview: string; // text of the most recent message
  lastMessageAt: string;
  messageCount: number;
  awaitingReply: boolean; // the customer spoke last — nobody has answered yet
}
