"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { PALETTE, type Kind } from "@/lib/categories";
import { categorizePending } from "@/lib/categorize";
import { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;
export type Prior = { id: string; kind: Kind | null; category: string | null; subcategory: string | null; category_source: string | null; needs_review: boolean };

const done = () => revalidatePath("/spending");
const check = <T extends { error: unknown }>(r: T) => { if (r.error) throw r.error; return r; };

async function assertCategory(db: Db, category: string, sub: string | null) {
  const { data } = await db.from("categories").select("name, subcategories(name)").eq("name", category).maybeSingle();
  if (!data) throw new Error(`There's no category called ${category}.`);
  if (sub && !(data.subcategories as { name: string }[]).some((s) => s.name === sub)) throw new Error(`${category} has no sub-category ${sub}.`);
}

/**
 * Set a transaction's kind and category. With `always`, also save a rule for its merchant and apply it to every
 * other transaction from that merchant you haven't set by hand. Returns what changed, so it can be undone.
 */
export async function setCategory(id: string, kind: Kind, category: string | null, sub: string | null, always: boolean): Promise<{ prior: Prior[]; rule: string | null }> {
  await requireOwner();
  const db = createAdminClient();
  if (kind === "spend") {
    if (!category) throw new Error("Pick a category.");
    await assertCategory(db, category, sub);
  }
  const cat = kind === "spend" ? category : null, subcat = kind === "spend" ? sub : null;
  const cols = "id, kind, category, subcategory, category_source, needs_review";

  const { data: t, error } = await db.from("transactions").select(`${cols}, name, merchant_name`).eq("id", id).single();
  if (error) throw error;
  const prior: Prior[] = [{ id: t.id, kind: t.kind, category: t.category, subcategory: t.subcategory, category_source: t.category_source, needs_review: t.needs_review }];
  check(await db.from("transactions")
    .update({ kind, category: cat, subcategory: subcat, category_source: "user", confidence: 1, needs_review: false }).eq("id", id));

  let rule: string | null = null;
  if (always) {
    rule = (t.merchant_name ?? t.name).toLowerCase().trim();
    check(await db.from("category_rules").upsert({ match: rule, kind, category: cat, subcategory: subcat }, { onConflict: "match" }));
    const field = t.merchant_name ? "merchant_name" : "name";
    const { data, error: oErr } = await db.from("transactions").select(cols).ilike(field, `%${rule}%`).neq("category_source", "user");
    if (oErr) throw oErr;
    const others = (data as Prior[]).filter((o) => o.id !== id);
    prior.push(...others);
    if (others.length) {
      check(await db.from("transactions")
        .update({ kind, category: cat, subcategory: subcat, category_source: "rule", confidence: 1, needs_review: false })
        .in("id", others.map((o) => o.id)));
    }
  }
  done();
  return { prior, rule };
}

/** Put transactions back the way they were before setCategory, and drop the rule it saved. */
export async function undoCategory(prior: Prior[], rule: string | null) {
  await requireOwner();
  const db = createAdminClient();
  for (const p of prior) {
    const { id, ...rest } = p;
    check(await db.from("transactions").update(rest).eq("id", id));
  }
  if (rule) check(await db.from("category_rules").delete().eq("match", rule));
  done();
}

export async function setNote(id: string, note: string) {
  await requireOwner();
  check(await createAdminClient().from("transactions").update({ note: note.trim() || null }).eq("id", id));
  done();
}

/** Money in that's someone paying you back isn't counted as money in. */
export async function setPayback(id: string, payback: boolean) {
  await requireOwner();
  check(await createAdminClient().from("transactions").update({ payback }).eq("id", id));
  done();
}

/** Replace a transaction's split. Pass null to un-split it into the first part's category. */
export async function setSplits(id: string, parts: { category: string; sub: string | null; amount: number }[] | null) {
  await requireOwner();
  const db = createAdminClient();
  for (const p of parts ?? []) await assertCategory(db, p.category, p.sub);
  check(await db.from("transaction_splits").delete().eq("transaction_id", id));
  if (parts?.length) {
    check(await db.from("transaction_splits").insert(parts.map((p, i) => ({ transaction_id: id, category: p.category, subcategory: p.sub, amount: p.amount, sort: i }))));
    check(await db.from("transactions").update({ kind: "spend", category: parts[0].category, subcategory: parts[0].sub, category_source: "user", needs_review: false }).eq("id", id));
  }
  done();
}

/** Replace who owes you what on a purchase. Pass null to stop tracking it. */
export async function setOwed(id: string, people: { person: string; amount: number; status: string }[] | null) {
  await requireOwner();
  const db = createAdminClient();
  check(await db.from("owed").delete().eq("transaction_id", id));
  if (people?.length) {
    check(await db.from("owed").insert(people.map((p, i) => ({ transaction_id: id, person: p.person.trim() || `Person ${i + 1}`, amount: p.amount, status: p.status, sort: i }))));
  }
  done();
}

export async function setOwedStatus(ids: number[], status: "waiting" | "paid" | "gone") {
  await requireOwner();
  check(await createAdminClient().from("owed").update({ status }).in("id", ids));
  done();
}

// ---- Categories ----

export async function createCategory(name: string, isProject: boolean) {
  await requireOwner();
  const db = createAdminClient();
  const clean = name.trim();
  if (!clean) throw new Error("Give it a name.");
  const { data: existing } = check(await db.from("categories").select("color, sort"));
  // The first color nobody uses yet, so a new category doesn't look like an old one.
  const taken = new Set(existing!.map((c: { color: string }) => c.color));
  const color = PALETTE.find((p) => !taken.has(p)) ?? PALETTE[existing!.length % PALETTE.length];
  check(await db.from("categories").insert({
    name: clean, is_project: isProject, color, sort: Math.max(0, ...existing!.map((c: { sort: number }) => c.sort)) + 1,
    started_on: isProject ? new Date().toISOString().slice(0, 10) : null,
  }));
  done();
}

export async function addSubcategory(category: string, name: string) {
  await requireOwner();
  const db = createAdminClient();
  const clean = name.trim();
  if (!clean) throw new Error("Give it a name.");
  const { count } = await db.from("subcategories").select("name", { count: "exact", head: true }).eq("category", category);
  check(await db.from("subcategories").upsert({ category, name: clean, sort: (count ?? 0) + 1 }, { onConflict: "category,name" }));
  done();
}

/** Removing a sub-category keeps its transactions in the category. */
export async function removeSubcategory(category: string, name: string) {
  await requireOwner();
  const db = createAdminClient();
  check(await db.from("transactions").update({ subcategory: null }).eq("category", category).eq("subcategory", name));
  check(await db.from("transaction_splits").update({ subcategory: null }).eq("category", category).eq("subcategory", name));
  check(await db.from("category_rules").update({ subcategory: null }).eq("category", category).eq("subcategory", name));
  check(await db.from("subcategories").delete().eq("category", category).eq("name", name));
  done();
}

/** Rename a category; every transaction, split and rule in it follows. */
export async function renameCategory(from: string, to: string) {
  await requireOwner();
  const db = createAdminClient();
  const clean = to.trim();
  if (!clean || clean === from) return;
  const { data: exists } = await db.from("categories").select("name").eq("name", clean).maybeSingle();
  if (exists) throw new Error(`There's already a category called ${clean}.`);
  check(await db.from("categories").update({ name: clean }).eq("name", from)); // sub-categories follow by cascade
  for (const table of ["transactions", "transaction_splits", "category_rules"] as const) {
    check(await db.from(table).update({ category: clean }).eq("category", from));
  }
  done();
}

/**
 * Delete a category, moving its transactions, splits and rules into another one. With `keepSubs`, its
 * sub-categories come along as sub-categories of the new home; otherwise they're dropped.
 */
export async function deleteCategory(name: string, moveTo: string, keepSubs: boolean) {
  await requireOwner();
  const db = createAdminClient();
  if (name === moveTo) throw new Error("Pick a different category to move things into.");
  await assertCategory(db, moveTo, null);
  if (keepSubs) {
    const { data: subs } = check(await db.from("subcategories").select("name").eq("category", name));
    const { count } = await db.from("subcategories").select("name", { count: "exact", head: true }).eq("category", moveTo);
    const rows = (subs as { name: string }[]).map((s, i) => ({ category: moveTo, name: s.name, sort: (count ?? 0) + i + 1 }));
    if (rows.length) check(await db.from("subcategories").upsert(rows, { onConflict: "category,name", ignoreDuplicates: true }));
  }
  for (const table of ["transactions", "transaction_splits", "category_rules"] as const) {
    check(await db.from(table).update(keepSubs ? { category: moveTo } : { category: moveTo, subcategory: null }).eq("category", name));
  }
  check(await db.from("categories").delete().eq("name", name)); // its sub-categories go with it
  done();
}

/** Switch between a regular category and a project, or finish/reopen a project. */
export async function updateCategory(name: string, patch: { is_project?: boolean; finished?: boolean }) {
  await requireOwner();
  const update: Record<string, unknown> = {};
  if (patch.is_project !== undefined) update.is_project = patch.is_project;
  if (patch.finished !== undefined) update.finished_on = patch.finished ? new Date().toISOString().slice(0, 10) : null;
  check(await createAdminClient().from("categories").update(update).eq("name", name));
  done();
}

export async function recategorizeNow() {
  await requireOwner();
  const n = await categorizePending();
  done();
  return n;
}
