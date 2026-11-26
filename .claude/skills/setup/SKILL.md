---
name: setup
description: Set up this Ledger app from scratch — Supabase database, Plaid bank connections, Vercel hosting — ending with a live site. Use when the user asks to set up, install, configure, deploy or get this project running.
---

Follow `docs/SETUP.md` from the top, in order. Run every command yourself; pause only at the steps marked 👤 and tell the user exactly what to open and click. Keep secrets out of the conversation and out of your output: they go into `.env.local` through `node scripts/setup.mjs`. Run `node scripts/setup.mjs check` after each stage and before you tell the user it's done.
