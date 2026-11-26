# Setting up Ledger

**This guide is written for a coding agent** (Claude Code, Codex, Cursor and so on) that is setting Ledger up for the person it's working with. It works just as well read by a person.

## How to run this setup (agent)

- Go in order. Run every command yourself. Stop only at steps marked **👤 You**. For those, tell the person exactly what to open and click, then wait for them.
- Secrets go into `.env.local` through `node scripts/setup.mjs`. Never echo a secret, print `.env.local`, or commit it.
- After each stage, run `node scripts/setup.mjs check`. It tests every piece that exists so far and lists what's left.
- Before you start, tell the person what to expect: about 30 to 45 minutes, and free accounts at Supabase, Plaid and Vercel. Real banks come at the end and need Plaid's approval, which takes a few days.
- If a CLI's flags have changed, read its `--help` and adapt. The steps say what each command must achieve.

What gets built:
- A Next.js app on **Vercel**.
- A Postgres database on **Supabase**, which holds their data and handles sign-in by emailed link.
- **Plaid**, which connects their banks. The app syncs once a day.
- Exactly one person can sign in: the owner.

---

## 1. Look around first (optional, 2 minutes)

```sh
npm install
npm run demo
```

This opens http://localhost:3000 with a made-up household, so the person can see what they're getting. No accounts are needed. Stop it before moving on.

## 2. Their own copy of the code

They'll customize this app, so it should live in their own GitHub repository.

- **If they cloned the template directly:** keep the template as a second remote and push to a new private repo. You need the GitHub CLI signed in. If `gh auth status` fails, ask them to run `gh auth login`.
  ```sh
  git remote rename origin template
  gh repo create my-ledger --private --source . --remote origin --push
  ```
- **If they made their own repo** with "Use this template" on GitHub, there's nothing to do.

## 3. Start the settings file

```sh
node scripts/setup.mjs init
```

Ask the person which email they'll sign in with, then save it:

```sh
node scripts/setup.mjs set ALLOWED_EMAIL=them@example.com
```

## 4. Supabase: database and sign-in

**👤 You:** make a free account at https://supabase.com/dashboard if you don't have one.

Then:

```sh
npx -y supabase@3 login                    # opens the browser; the person approves
npx -y supabase@3 orgs list -o json        # note the org id (ask which, if there's more than one)
```

Create the project. Ask them for a region near them; the default here is `us-east-1`. The database password comes from `.env.local` and isn't shown:

```sh
sh -c '. ./.env.local && npx -y supabase@3 projects create ledger --org-id <org-id> --db-password "$SUPABASE_DB_PASSWORD" --region us-east-1 --yes -o json'
```

- **Project ref:** note the `ref` (or `id`) in the output.
- **Free-plan limit:** the free plan allows 2 active projects. If creation fails for that reason, the person can pause an old one in the dashboard.

Wait until the project is ready (a minute or two):

```sh
npx -y supabase@3 projects list -o json    # wait for its status to be ACTIVE_HEALTHY
```

Then save its keys, create the tables, and record the owner:

```sh
node scripts/setup.mjs supabase-keys <ref>
sh -c '. ./.env.local && npx -y supabase@3 db push --remote=<ref> --password "$SUPABASE_DB_PASSWORD" --yes'
node scripts/setup.mjs owner
node scripts/setup.mjs check               # Supabase lines should all be ✓
```

## 5. Plaid: bank connections (sandbox first)

**👤 You:**
1. Make a free account at https://dashboard.plaid.com/signup.
2. Open **Developers → Keys** (https://dashboard.plaid.com/developers/keys).
3. Copy the **client_id** and the **Sandbox** secret.

Then do one of these:
- Paste them into `.env.local` yourself, after `PLAID_CLIENT_ID=` and `PLAID_SECRET_SANDBOX=`.
- Or give them to your agent, which runs:

```sh
node scripts/setup.mjs set PLAID_CLIENT_ID=... PLAID_SECRET_SANDBOX=...
node scripts/setup.mjs check               # "sandbox keys work"
```

Sandbox gives you test banks with fake data, so everything can be tried before Plaid approves real banks (step 9).

## 6. Try it locally

```sh
npm run dev
```

1. **👤 You:** open http://localhost:3000, enter your email, and click the link that arrives. It may take a minute; check spam.
2. Then go to **Connections → Connect bank or card**, pick any bank, and sign in with `user_good` / `pass_good`.
3. Do the same with **Connect investment account**.

Home, Spending, Retirement and Investments fill in.

- **No email arrives:** Supabase's built-in email is rate-limited. Wait a few minutes and try again.
- **"Not signed in":** the email doesn't exactly match `ALLOWED_EMAIL`.

## 7. Vercel: put it online

**👤 You:** make a free (Hobby) account at https://vercel.com/signup if you don't have one.

```sh
npx vercel login
npx vercel link --yes --project my-ledger        # creates the project; its address will be https://my-ledger.vercel.app (or close)
node scripts/setup.mjs vercel-env                # copies every setting to the project
npx vercel deploy --prod
```

1. **Record the address:** note the production URL the deploy prints, and save it:
   ```sh
   node scripts/setup.mjs set NEXT_PUBLIC_SITE_URL=https://<their-url>
   node scripts/setup.mjs vercel-env
   ```
2. **Deploy on push (recommended):** run `npx vercel git connect` so every push to their GitHub repo deploys automatically.
   - If that asks for the Vercel GitHub app, have them approve it.
   - If it fails, deploys still work with `npx vercel deploy --prod`.
3. **Daily sync:** the schedule in `vercel.json` runs at 11:00 UTC. It also keeps a free Supabase project from pausing for inactivity.

## 8. Point sign-in at the live site

**👤 You:**
1. Open https://supabase.com/dashboard/project/<ref>/auth/url-configuration.
2. Set **Site URL** to your Vercel address, e.g. `https://my-ledger.vercel.app`.
3. Under **Redirect URLs**, add both:
   - `https://my-ledger.vercel.app/auth/callback`
   - `http://localhost:3000/auth/callback`
4. Save.

Then sign in on the live site and link a sandbox bank there, as in step 6. Running `node scripts/setup.mjs check` should now show everything ✓.

**The site is working.** Tell the person, and point them to step 9 for real banks.

## 9. Real banks (when Plaid approves)

Sandbox banks are fake. For real ones:

1. **👤 You:** in the Plaid dashboard, request **Production** access.
   - Describe the app as a personal finance tracker for yourself.
   - Plaid reviews requests, often within a few days. Check https://plaid.com/pricing, since production can charge per connected account.
2. **👤 You:** once approved, copy the **Production** secret from Developers → Keys.
3. **👤 You:** under **Developers → API → Allowed redirect URIs**, add `https://<your-url>/plaid/oauth`. Many big banks sign you in on their own site and need this.
4. Then:
   ```sh
   node scripts/setup.mjs set PLAID_SECRET_PRODUCTION=... PLAID_ENV=production PLAID_REDIRECT_URI=https://<their-url>/plaid/oauth
   node scripts/setup.mjs check
   node scripts/setup.mjs vercel-env
   npx vercel deploy --prod
   ```
5. **👤 You:** on Connections, **Disconnect** the sandbox banks, since they stop working in production. Then connect your real ones. The first sync brings in up to two years of transactions.

## Optional: AI categorizing

Out of the box, transactions are sorted by your rules and Plaid's labels, and anything unclear waits in **Needs a look** on Spending. To have Claude sort those too:

1. In `ledger.config.ts`, set `ai.enabled: true` and describe yourself in `ai.about` (for example "a couple in Denver with a dog"). It helps the model.
2. **👤 You:** in the Vercel dashboard, open **AI Gateway**, enable it for the project, and add credit. The deployed app authenticates automatically.
3. To try it locally, run `npx vercel env pull` for a short-lived token.
4. Deploy. The model is set at the top of `lib/categorize.ts`.

## Make it yours

Once it works, the person can ask their agent for changes; `AGENTS.md` explains how the code fits together. Two quick wins after the first real sync:

- **Paychecks:** find a paycheck under Spending → Money in, and set `paycheck` in `ledger.config.ts` to a piece of its description. Future paychecks are then always counted as income.
- **Recurring charges:** recategorize one with **Always** ticked, and every past and future charge from that merchant follows.

## Troubleshooting

| What happens | Why, and the fix |
| --- | --- |
| The sign-in link opens `localhost` | Step 8 isn't done: the Site URL still points at localhost. |
| "Not signed in" after clicking the link | `ALLOWED_EMAIL` (in Vercel too) must exactly match the email used. Re-run `set`, then `vercel-env`, then redeploy. |
| The page is empty after signing in | `node scripts/setup.mjs owner` hasn't run, or ran with a different email. |
| `INVALID_API_KEYS` from Plaid | The secret doesn't match `PLAID_ENV` (sandbox vs production). |
| The build fails on Vercel | A setting is missing there: run `node scripts/setup.mjs vercel-env` and deploy again. |
| `supabase@3` commands fail to authenticate | Run `npx -y supabase@3 login` again. |
