import type { LedgerConfig } from "@/lib/config";

// Settings for your copy of Ledger. Your agent can tailor these as you go (see CLAUDE.md).
export const config: LedgerConfig = {
  description: "My net worth, investments, cash and spending.",
  // After your first sync, find your paycheck under Spending > Money in and put a piece of its description here,
  // e.g. /acme corp payroll/. Until then, paychecks are picked up from Plaid's own labels when it has them.
  paycheck: null,
  // Moves between your own accounts that your bank describes in its own way, e.g. /transfer to savings/.
  ownTransfers: null,
  ai: {
    // Off by default. Turning it on needs the Vercel AI Gateway (see docs/SETUP.md, "Optional: AI categorizing").
    enabled: false,
    about: "one person",
    hints: [],
  },
};
