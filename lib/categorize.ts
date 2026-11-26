import "server-only";
import { generateText, Output } from "ai";
import { z } from "zod";
import { fromPatterns, fromPlaid, type Kind } from "@/lib/categories";
import { config } from "@/lib/config";
import { DEMO } from "@/lib/demo/mode";
import { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;
type Txn = {
  id: string; date: string; amount: number; name: string; merchant_name: string | null;
  plaid_category: string | null; plaid_category_detailed: string | null; account_name: string;
};
type Result = { kind: Kind; category: string | null; sub: string | null; source: "rule" | "auto" | "plaid" | "ai"; confidence: number | null; review: boolean };
type Taxonomy = Map<string, string[]>; // category → its sub-categories

const MODEL = "anthropic/claude-haiku-5.5";
const REVIEW_BELOW = 0.75;

const aiSchema = z.object({
  results: z.array(z.object({
    id: z.string(),
    kind: z.enum(["spend", "transfer", "income"]),
    category: z.string().nullable(),
    subcategory: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  })),
});

/** Keep a guess only if its category and sub-category exist. */
function fit(tax: Taxonomy, category: string | null, sub: string | null | undefined) {
  if (!category || !tax.has(category)) return { category: "Other", sub: null };
  return { category, sub: sub && tax.get(category)!.includes(sub) ? sub : null };
}

async function classifyWithClaude(txns: Txn[], tax: Taxonomy): Promise<Map<string, Result>> {
  const { output } = await generateText({
    model: MODEL,
    output: Output.object({ schema: aiSchema }),
    system: [
      `You categorize personal bank and credit card transactions for ${config.ai.about}.`,
      "Amounts: positive = money out, negative = money in.",
      "kind: 'spend' for purchases and bills (refunds are spend with negative amounts); 'transfer' for card payments and moves between the person's own accounts;",
      "'income' for paychecks, interest, gifts received and money people send them that isn't tied to a purchase.",
      "Money in from a person (Zelle, Venmo, a check) is 'income'; the person marks paybacks themselves.",
      "Venmo account rows look like: Person Name \"note\". Use the note to pick the category of a payment.",
      "category (spend only, else null) and subcategory (one of that category's, or null when unsure) must come from:",
      ...[...tax].map(([c, subs]) => `- ${c}${subs.length ? `: ${subs.join(", ")}` : ""}`),
      ...config.ai.hints,
      "Recurring software or media are Subscriptions. TST* and SQ* prefixes are restaurant/shop card readers.",
      "confidence: how sure you are, 0 to 1. Use below 0.75 when the name is ambiguous.",
    ].join("\n"),
    prompt: JSON.stringify(txns.map((t) => ({
      id: t.id, date: t.date, amount: t.amount, description: t.name, merchant: t.merchant_name,
      account: t.account_name, plaid_hint: t.plaid_category_detailed,
    }))),
  });
  return new Map(output.results.map((r) => [r.id, {
    kind: r.kind, ...(r.kind === "spend" ? fit(tax, r.category, r.subcategory) : { category: null, sub: null }),
    source: "ai" as const, confidence: r.confidence, review: r.confidence < REVIEW_BELOW,
  }]));
}

/** Categorize every transaction that doesn't have a kind yet. Returns how many were categorized. */
export async function categorizePending(db: Db = createAdminClient()): Promise<number> {
  if (DEMO) return 0;
  const [{ data: rows, error }, { data: rules, error: rErr }, { data: cats, error: cErr }, { data: subs, error: sErr }] = await Promise.all([
    db.from("transactions")
      .select("id, date, amount, name, merchant_name, plaid_category, plaid_category_detailed, accounts(name)")
      .is("kind", null).order("date", { ascending: false }).limit(3000),
    db.from("category_rules").select("match, kind, category, subcategory"),
    db.from("categories").select("name").is("finished_on", null).order("sort"),
    db.from("subcategories").select("category, name").order("sort"),
  ]);
  if (error) throw error;
  if (rErr) throw rErr;
  if (cErr) throw cErr;
  if (sErr) throw sErr;
  if (!rows.length) return 0;
  const tax: Taxonomy = new Map(cats.map((c) => [c.name, subs.filter((s) => s.category === c.name).map((s) => s.name)]));

  const txns: Txn[] = rows.map((r) => ({
    id: r.id, date: r.date, amount: Number(r.amount), name: r.name, merchant_name: r.merchant_name,
    plaid_category: r.plaid_category, plaid_category_detailed: r.plaid_category_detailed,
    account_name: (r.accounts as unknown as { name: string } | null)?.name ?? "",
  }));

  const results = new Map<string, Result>();
  const forClaude: Txn[] = [];
  for (const t of txns) {
    const text = `${t.merchant_name ?? ""} ${t.name}`.toLowerCase();
    const rule = rules.find((r) => text.includes(r.match));
    if (rule) { results.set(t.id, { kind: rule.kind, category: rule.category, sub: rule.subcategory, source: "rule", confidence: 1, review: false }); continue; }
    const pattern = fromPatterns(t.name) ?? (t.merchant_name ? fromPatterns(t.merchant_name) : null);
    if (pattern) { results.set(t.id, { ...pattern, sub: pattern.sub ?? null, source: "auto", confidence: 1, review: false }); continue; }
    const plaid = fromPlaid(t.plaid_category, t.plaid_category_detailed);
    if (plaid) {
      const c = plaid.kind === "spend" ? fit(tax, plaid.category, plaid.sub) : { category: null, sub: null };
      results.set(t.id, { kind: plaid.kind, ...c, source: "plaid", confidence: null, review: false });
      continue;
    }
    forClaude.push(t);
  }

  // With AI off, whatever rules and Plaid couldn't place waits in Needs a look.
  const unguessed: string[] = config.ai.enabled ? [] : forClaude.map((t) => t.id);
  for (let i = 0; config.ai.enabled && i < forClaude.length; i += 60) {
    const batch = forClaude.slice(i, i + 60);
    try {
      for (const [id, r] of await classifyWithClaude(batch, tax)) results.set(id, r);
    } catch (e) {
      // Claude unavailable: send these to Needs a look uncategorized. The next sync tries Claude again.
      console.error("Claude categorization failed", e);
      unguessed.push(...batch.map((t) => t.id));
    }
  }
  for (let i = 0; i < unguessed.length; i += 50) {
    await db.from("transactions").update({ needs_review: true }).in("id", unguessed.slice(i, i + 50));
  }

  // Write in groups that share the same values to keep the number of requests small.
  const groups = new Map<string, string[]>();
  for (const [id, r] of results) {
    const key = JSON.stringify([r.kind, r.category, r.sub, r.source, r.confidence, r.review]);
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  for (const [key, ids] of groups) {
    const [kind, category, subcategory, source, confidence, review] = JSON.parse(key);
    for (let i = 0; i < ids.length; i += 50) {
      const { error: uErr } = await db.from("transactions")
        .update({ kind, category, subcategory, category_source: source, confidence, needs_review: review })
        .in("id", ids.slice(i, i + 50)); // ids go in the URL; keep it short
      if (uErr) throw uErr;
    }
  }
  return results.size;
}
