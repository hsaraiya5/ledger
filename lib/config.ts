// The shape of ledger.config.ts: the few things that differ from one person's copy to the next.
export type LedgerConfig = {
  /** Shown to search engines and link previews. */
  description: string;
  /** Bank descriptions that mark a paycheck, matched against the lowercased text. */
  paycheck: RegExp | null;
  /** Bank descriptions for moves between your own accounts that Plaid can't tell apart from spending. */
  ownTransfers: RegExp | null;
  /** Categorize what rules and Plaid can't with Claude, through the Vercel AI Gateway. Off: those land in Needs a look. */
  ai: { enabled: boolean; about: string; hints: string[] };
  /** The monthly Sheet page (a personal export, not part of the shared template). */
  sheet?: boolean;
};

export { config } from "@/ledger.config";
