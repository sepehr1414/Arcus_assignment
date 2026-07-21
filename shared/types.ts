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
//
// This is the assistant's closed world: if a fact is not a field here, the
// assistant does not know it. Note what is deliberately *absent* — there is no
// restock date, no per-item delivery estimate and no discount field, because
// those are exactly the facts an LLM is most tempted to invent.
export interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  subcategory: string;
  price: number;
  currency: string;
  inStock: boolean;
  stockCount: number;
  colors: string[];
  sizes?: string[];
  description: string;
  specs: Record<string, string>;
  weightGrams: number;
  dimensionsCm: string;
  warrantyMonths: number;
  rating: number;
  reviewCount: number;
  tags: string[];
  // Other ways customers refer to this product ("headphones" -> Wireless
  // Headphones). Used both to find products in a message and to catch a reply
  // that mentions a product without citing it.
  aliases: string[];
  relatedIds: string[];
}

// Store policies from data/policies.json — the only source for shipping,
// returns, warranty and payment answers.
export interface ShippingOption {
  name: string;
  cost: number;
  duration: string;
  freeOver: number | null;
}

export interface Policies {
  storeName: string;
  currency: string;
  shipping: {
    options: ShippingOption[];
    shipsFrom: string;
    destinations: string;
    cutOffTime: string;
    note: string;
  };
  returns: {
    windowDays: number;
    condition: string;
    cost: string;
    refundProcessingDays: string;
    exclusions: string[];
    exclusionReason: string;
  };
  warranty: {
    default: string;
    covers: string;
    excludes: string;
    claimProcess: string;
  };
  payment: { methods: string[]; installments: string; currencyNote: string };
  support: { hours: string; responseTarget: string; channels: string[] };
  priceMatching: string;
  discountCodes: string;
  stockNote: string;
}

// An order from data/orders.json. Looked up by number *before* the model runs,
// and only the matched record is ever put in a prompt.
export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface Order {
  orderNumber: string;
  customerPhone: string;
  customerName: string;
  status: string;
  placedAt: string;
  dispatchedAt: string | null;
  shippingOption: string;
  carrier: string | null;
  trackingNumber: string | null;
  estimatedDelivery: string | null;
  deliveredAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  items: OrderItem[];
  total: number;
}

// Who sent a stored message.
//
// "system" is an internal note for the agent — why the assistant declined to
// answer — and is NOT part of the conversation with the customer. It must never
// be delivered to them, and it does not count as having answered them: see
// `awaitingReply` in server/src/store.ts.
export type Sender = "customer" | "assistant" | "agent" | "system";

// What an assistant reply was checked against. Present only on assistant
// messages that came from the LLM path and passed the grounding validator, so
// the UI can show an agent *why* the reply is trustworthy.
export interface Citations {
  productIds: string[];
  orderNumber?: string;
}

// A stored message inside a conversation. `id` is the provider id for customer
// messages (used for de-duplication); assistant/agent messages get a generated id.
export interface Message {
  id: string;
  conversationId: string; // = customer phone (from)
  sender: Sender;
  text: string;
  timestamp: string; // ISO 8601
  citations?: Citations;
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
