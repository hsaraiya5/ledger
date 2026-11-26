// Categories live in the database (categories + subcategories tables). Transfers and income are kinds, not categories.
import { config } from "@/lib/config";
export type Kind = "spend" | "transfer" | "income";
export type Cat = {
  name: string;
  isProject: boolean;
  color: string; // palette slot g1–g12, drawn as var(--g1)…
  sort: number;
  startedOn: string | null;
  finishedOn: string | null;
  subs: string[];
};
type Guess = { kind: Kind; category: string | null; sub?: string | null };

export const PALETTE = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9", "g10", "g12", "g13", "g14"];

// Names from before categories moved into the database. The old daily sync can still write these until it's
// replaced, so they're read as their new equivalents.
const LEGACY: Record<string, string> = {
  Housing: "Housing & living", Utilities: "Housing & living", Insurance: "Housing & living", Transportation: "Getting around",
  Household: "Shopping", "Personal care": "Shopping", Entertainment: "Fun", "Gifts & donations": "Gifts & giving",
  Services: "Fees & services", "Fees & taxes": "Fees & services", "Venmo (unsorted)": "Other",
};
export const normalizeCategory = (c: string | null) => (c && LEGACY[c]) || c;

/** Plaid detailed/primary category → ours. Only used where Plaid is reliable; OTHER goes to Claude. */
export function fromPlaid(primary: string | null, detailed: string | null): Guess | null {
  const d = detailed ?? "";
  if (!primary || primary === "OTHER") return null;
  if (d === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") return { kind: "transfer", category: null };
  if (primary === "INCOME") return { kind: "income", category: null };
  if (primary === "TRANSFER_IN") return null; // own-account moves vs paybacks vs paychecks: decided by rules or Claude
  if (primary === "TRANSFER_OUT") return null;
  // Other "loan payments" and general services are often mislabeled (rent portals, travel bookings): let Claude decide.
  if (primary === "LOAN_PAYMENTS") return null;
  if (d === "FOOD_AND_DRINK_GROCERIES") return { kind: "spend", category: "Groceries" };
  if (d === "FOOD_AND_DRINK_COFFEE") return { kind: "spend", category: "Dining", sub: "Coffee" };
  if (primary === "FOOD_AND_DRINK") return { kind: "spend", category: "Dining", sub: "Restaurants" };
  if (d === "RENT_AND_UTILITIES_RENT") return { kind: "spend", category: "Housing & living", sub: "Rent" };
  if (d === "RENT_AND_UTILITIES_INTERNET_AND_CABLE") return { kind: "spend", category: "Housing & living", sub: "Internet" };
  if (primary === "RENT_AND_UTILITIES") return { kind: "spend", category: "Housing & living", sub: "Utilities" };
  if (d === "TRANSPORTATION_TAXIS_AND_RIDE_SHARES") return { kind: "spend", category: "Getting around", sub: "Rideshare" };
  if (d === "TRANSPORTATION_GAS") return { kind: "spend", category: "Getting around", sub: "Gas" };
  if (d === "TRANSPORTATION_PARKING") return { kind: "spend", category: "Getting around", sub: "Parking" };
  if (d === "TRANSPORTATION_PUBLIC_TRANSIT") return { kind: "spend", category: "Getting around", sub: "Metro & transit" };
  if (primary === "TRANSPORTATION") return { kind: "spend", category: "Getting around" };
  if (d === "TRAVEL_FLIGHTS") return { kind: "spend", category: "Travel", sub: "Flights" };
  if (d === "TRAVEL_LODGING") return { kind: "spend", category: "Travel", sub: "Lodging" };
  if (primary === "TRAVEL") return { kind: "spend", category: "Travel" };
  if (primary === "GENERAL_MERCHANDISE") return { kind: "spend", category: "Shopping" };
  if (primary === "HOME_IMPROVEMENT") return { kind: "spend", category: "Shopping", sub: "Household" };
  if (d === "ENTERTAINMENT_TV_AND_MOVIES" || d === "ENTERTAINMENT_MUSIC_AND_AUDIO") return { kind: "spend", category: "Subscriptions", sub: "Streaming" };
  if (primary === "ENTERTAINMENT") return { kind: "spend", category: "Fun" };
  if (d === "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS") return { kind: "spend", category: "Health & fitness", sub: "Gym" };
  if (primary === "MEDICAL") return { kind: "spend", category: "Health & fitness", sub: "Medical & pharmacy" };
  if (primary === "PERSONAL_CARE") return { kind: "spend", category: "Shopping", sub: "Personal care" };
  if (d === "GENERAL_SERVICES_INSURANCE") return null; // renters vs car vs travel: Claude decides
  if (primary === "GENERAL_SERVICES") return null;
  if (d === "GOVERNMENT_AND_NON_PROFIT_DONATIONS") return { kind: "spend", category: "Gifts & giving" };
  if (primary === "GOVERNMENT_AND_NON_PROFIT" || primary === "BANK_FEES") return { kind: "spend", category: "Fees & services", sub: "Fees & taxes" };
  return null;
}

/** Built-in patterns for things Plaid often mislabels: card payments, own-account moves, paychecks, Venmo. */
export function fromPatterns(text: string): Guess | null {
  const t = text.toLowerCase();
  if (/autopay|card online|payment thank you|online payment|credit card payment/.test(t)) return { kind: "transfer", category: null };
  if (/transfer (to|from) (checking|savings)/.test(t) || config.ownTransfers?.test(t)) return { kind: "transfer", category: null };
  if (config.paycheck?.test(t)) return { kind: "income", category: null };
  if (/monthly interest paid|interest earned/.test(t)) return { kind: "income", category: null };
  // Venmo on a bank statement is money moving to or from the Venmo account, which syncs its own detailed rows.
  if (/^venmo\b|venmo (payment|cashout|cash out|transfer)/.test(t)) return { kind: "transfer", category: null };
  return null;
}
