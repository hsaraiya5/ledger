# Ledger

A personal finance tracker you host yourself: net worth over time, retirement accounts against IRS limits, investments and stock comp, and spending by category, all fed by your banks through Plaid.

**Try the demo:** https://ledger-demo-alpha.vercel.app. It uses made-up data and starts with a short tour.

## Get your own

1. Click **Use this template → Create a new repository** (private is a good idea), and clone it.
2. Open it with your coding agent (Claude Code, Codex, Cursor and so on) and say:

   > Help me set this up.

   The agent follows [docs/SETUP.md](docs/SETUP.md). It runs the commands and tells you when you need to click something: making accounts, approving logins, pasting a key. You end with a live site. You can also follow that guide yourself.

You'll need about 45 minutes and free accounts at [Supabase](https://supabase.com), [Plaid](https://dashboard.plaid.com/signup) and [Vercel](https://vercel.com). Test banks work right away. Real banks need Plaid's production approval, which usually takes a few days and may cost a little per connected account; see [Plaid pricing](https://plaid.com/pricing).

Want to see it running before making any accounts? Run `npm install && npm run demo`.

## What you get

- **Home:** net worth by bucket over time, with widgets for cash, retirement, investments, spending, credit cards, IOUs and sync status.
- **Retirement:** every fund with what you put in and how it grew, plus this year's contributions against the 401(k) and IRA limits.
- **Investments:** holdings and growth, and stock comp (RSU vests, sell-to-cover, ESPP) read from your brokerage's activity.
- **Spending:**
  - month by month, with your own categories and sub-categories
  - rules ("always put this merchant here"), splits and notes
  - who owes you for what, and projects like a trip
- **Connections:** link banks through Plaid, group accounts, keep some separate. It syncs daily on its own.
- Dark and light themes, and it works on a phone. Add it to your home screen and it opens like an app.

## Privacy

Your data lives in your own Supabase database and nowhere else. Only the email you choose can sign in. Plaid logins are encrypted before they're stored. Nothing is shared with the author of this template.

## Make it yours

Ask your agent for changes. [AGENTS.md](AGENTS.md) explains how the code fits together and what to keep working. Small personal settings live in `ledger.config.ts`.

Built with Next.js, Supabase, Plaid and Vercel.

## License

MIT: copy it, change it, make it yours. See [LICENSE](LICENSE).
