# Ledger: notes for coding agents

Ledger is a single-person finance tracker: net worth, retirement, investments and spending. It's fed by Plaid and stored in Supabase, and it runs on Vercel. One email, the owner, can sign in.

**If you've been asked to set this project up, follow [docs/SETUP.md](docs/SETUP.md) step by step.** The rest of this file is for changing the app.

## Commands

| Command | What it does |
| --- | --- |
| `npm run demo` | Runs the app with made-up data and no accounts or keys. Use it for any UI work. |
| `npm run dev` | Runs against the real Supabase and Plaid in `.env.local`. |
| `npm run build` / `npm run lint` | Run both before calling a change done. |
| `node scripts/setup.mjs check` | Checks every setting and service. |
| `npx vercel deploy --prod` | Deploys. Pushing to GitHub also deploys if Vercel is connected to the repo. |

## How it fits together

- **Pages** (`app/(app)/*/page.tsx`) are server components. They load data through `lib/data.ts` and hand it to one client component per page (`components/*View.tsx`), which does all the math and drawing.
- **Edits** are server actions in `app/(app)/*/actions.ts`. Each one starts with `await requireOwner()`, writes through `createAdminClient()` (service role), then calls `revalidatePath`.
- **Bank data:**
  - `lib/sync.ts` pulls accounts, balances, transactions and holdings from Plaid.
  - Vercel runs it daily through `app/api/cron/sync` (the schedule is in `vercel.json`), and "Sync now" on Connections runs it on demand.
  - Plaid access tokens are encrypted with `PLAID_TOKEN_KEY` (`lib/crypto.ts`).
- **Categorizing** (`lib/categorize.ts`) goes in this order:
  1. the person's saved rules
  2. built-in patterns (`lib/categories.ts`)
  3. Plaid's labels
  4. Claude, if `ai.enabled` is set in `ledger.config.ts`; otherwise the transaction goes to "Needs a look".
- **Personal settings** live in `ledger.config.ts`: paycheck and transfer patterns, the AI switch and its prompt context, and the site description. Prefer adding a setting there over hard-coding anything about one person.
- **Shared math:** `lib/ledger.ts` has the types and formatting; `lib/retirement.ts` has IRS limits and vesting.
- **Charts:** `components/Chart.tsx` is a small SVG charting helper. No chart library.
- **Styling:** plain CSS in `app/globals.css`, no Tailwind.
  - Colors and fonts are tokens at the top, with a light set and a dark set; components use only the tokens, so both themes keep working.
  - The theme toggle sets `data-theme` on `<html>`.

### Data conventions

- **Amounts** follow Plaid's sign: positive is money out, negative is money in.
- **Months** are `ym = year * 12 + monthIndex`, which makes month arithmetic easy.
- **Account tree:**
  - An account can have a `parent_id`, meaning it rolls up into a parent "line" (for example, checking and savings under one bank).
  - Top-level accounts are what the charts show.
  - The `bucket` is `retirement`, `brokerage` (shown as Investments), `cash` or `credit`. Credit cards count for spending, not net worth.
- **Transactions** have a `kind` (`spend`, `transfer` or `income`). Only `spend` has a category.
  - Transfers between the person's own accounts are paired and left out of totals.
  - `payback` marks money in that repays them, so it isn't counted as income.

## Rules that keep it working

1. **Demo mode must keep working.**
   - With `NEXT_PUBLIC_DEMO_MODE=1`, `lib/supabase/*` return a stand-in client (`lib/demo/db.ts`) over generated data (`lib/demo/seed.ts`).
   - The stand-in supports only the query-builder calls the app uses today. If you use a new one (e.g. `.lt`, `.or`, `.range`), a new table, or a new embedded relation, add it to `db.ts` (the `Query` class, `KEYS`, `RELATIONS`).
   - Give new columns and tables data in `seed.ts`.
   - Check with `npm run demo`.
2. **Schema changes:**
   - Add a new file in `supabase/migrations/` named `<YYYYMMDDHHMMSS>_<what>.sql`. Never edit an applied one.
   - New tables follow the pattern at the bottom of the first migration: row-level security on, a select policy using `private.is_owner()`, nothing granted to `anon`, writes only through the service role.
   - Apply with:
     ```sh
     sh -c '. ./.env.local && npx -y supabase@3 db push --remote=<ref> --password "$SUPABASE_DB_PASSWORD" --yes'
     ```
     The project ref is the subdomain of `NEXT_PUBLIC_SUPABASE_URL`.
3. **Security:**
   - Every server action calls `requireOwner()` first.
   - Secrets (`SUPABASE_SECRET_KEY`, Plaid secrets, `PLAID_TOKEN_KEY`, `CRON_SECRET`) are never sent to the browser, never prefixed `NEXT_PUBLIC_`, and never logged.
   - `plaid_items` holds access tokens and stays server-only.
4. **Settings:** a new environment variable goes in `.env.example` and in the `VARS` list in `scripts/setup.mjs`, so setup and `vercel-env` know about it.
5. **Empty data:** a fresh install has no accounts. Pages must still render; see `components/EmptyState.tsx`.

## Writing for the person

Labels and messages are plain and specific, from the user's side:
- "Connect bank or card", not "Create Plaid item".
- Errors say what to do next.
- Keep comments sparse and about *why*.
- Match the surrounding code's style.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
