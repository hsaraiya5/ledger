"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { mergeAccount, removeItem, syncNow, updateAccount } from "@/app/(app)/connections/actions";
import { PlaidLinkButton } from "@/components/PlaidLinkButton";

type Item = { id: string; institution_name: string; products: string[]; status: string; last_error: string | null; last_synced_at: string | null };
type Acct = { id: string; name: string; institution: string; bucket: string; mask: string | null; plaid_item_id: string | null; hidden: boolean; data_source: string; parent_id: string | null; nickname: string | null; kept_separate: boolean };

const BUCKET_LABEL: Record<string, string> = { retirement: "Retirement", brokerage: "Investments", cash: "Cash", credit: "Credit card" };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";

export function ConnectionsView({ items, accounts, env }: { items: Item[]; accounts: Acct[]; env: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  // Sheet accounts not yet tied to Plaid; a new Plaid account can be merged into one of these.
  const unlinked = accounts.filter((a) => !a.plaid_item_id && !a.id.startsWith("p-") && !accounts.some((c) => c.parent_id === a.id));
  // Sheet lines a linked account can roll up into (e.g. a new savings account counting toward "Capital One").
  const groups = accounts.filter((a) => !a.parent_id && !a.plaid_item_id && a.bucket !== "credit");
  const label = (a: Acct) => `${a.institution} ${a.name}`;

  const run = (fn: () => Promise<unknown>, done?: string) =>
    startTransition(async () => {
      setMessage(null);
      try {
        await fn();
        if (done) setMessage(done);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Something went wrong.");
      }
      router.refresh();
    });

  return (
    <div className="dash">
      <div className="panel s12">
        <div className="ph">
          <div className="lede">
            <span className="eyebrow">Connections · Plaid {env}</span>
            <h1>Linked accounts</h1>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
            <PlaidLinkButton kind="bank" label="Connect bank or card" className="btn primary" />
            <PlaidLinkButton kind="investment" label="Connect investment account" />
            <button type="button" className="btn" disabled={pending || !items.length}
              onClick={() => run(async () => {
                const r = await syncNow();
                const failed = r.filter((x) => !x.ok).length;
                setMessage(failed ? `${failed} of ${r.length} logins had a problem. See below.` : `Synced ${r.length} logins.`);
              })}>
              {pending ? "Syncing…" : "Sync now"}
            </button>
          </div>
        </div>
        <p className="sentence">
          Connect each login once. New accounts show up below. If one is the same as an account you already track,
          match it so its history carries on. Everything syncs every morning on its own.
        </p>
        {message && <p className="notice">{message}</p>}
      </div>

      {items.length === 0 && (
        <div className="panel s12"><p className="muted">Nothing linked yet. Start with your main bank, then your cards and investment accounts.</p></div>
      )}

      {items.map((item) => (
        <div key={item.id} className="panel s6">
          <div className="ph">
            <h2>{item.institution_name}</h2>
            <span className={`cchip ${item.status === "ok" ? "" : "rv"}`}>
              {item.status === "ok" ? `Synced ${when(item.last_synced_at)}` : item.status === "needs_login" ? "Sign in again" : "Sync problem"}
            </span>
          </div>
          {item.last_error && <p className="small down">{item.last_error}</p>}
          <div className="ledger">
            {accounts.filter((a) => a.plaid_item_id === item.id).map((a) => (
              <div key={a.id} className="ln" style={{ flexWrap: "wrap", alignItems: "center", opacity: a.hidden ? 0.55 : 1 }}>
                <span>
                  <b>{a.name}</b>{a.mask ? <span className="muted"> ··{a.mask}</span> : null}
                  <span className="muted small"> · {BUCKET_LABEL[a.bucket]}{a.hidden ? " · hidden" : ""}{a.kept_separate ? " · kept separate from spending" : ""}</span>
                </span>
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {a.id.startsWith("p-") && !a.parent_id && unlinked.length > 0 && (
                    <select aria-label={`Match ${a.name} to an existing account`} defaultValue="" disabled={pending}
                      onChange={(e) => e.target.value && run(() => mergeAccount(a.id, e.target.value), `Matched ${a.name}.`)}>
                      <option value="">Same as…</option>
                      {unlinked.map((u) => <option key={u.id} value={u.id}>{u.institution} {u.name}</option>)}
                    </select>
                  )}
                  {a.bucket !== "credit" && (
                    <select aria-label={`What ${a.name} counts toward`} value={a.parent_id ?? ""} disabled={pending}
                      onChange={(e) => run(() => updateAccount(a.id, { parent_id: e.target.value || null }))}>
                      <option value="">Its own line</option>
                      {groups.map((g) => <option key={g.id} value={g.id}>Counts toward {label(g)}</option>)}
                    </select>
                  )}
                  {!a.parent_id && (
                    <select aria-label={`Bucket for ${a.name}`} value={a.bucket} disabled={pending}
                      onChange={(e) => run(() => updateAccount(a.id, { bucket: e.target.value }))}>
                      {Object.entries(BUCKET_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  )}
                  {(a.bucket === "cash" || a.bucket === "credit") && (
                    <>
                      <input aria-label={`Short name for ${a.name} on the Spending page`} placeholder="Short name" defaultValue={a.nickname ?? ""}
                        key={a.nickname ?? ""} disabled={pending} style={{ width: 120 }}
                        onBlur={(e) => e.target.value.trim() !== (a.nickname ?? "") && run(() => updateAccount(a.id, { nickname: e.target.value.trim() || null }))} />
                      {a.bucket === "cash" && (
                        <button type="button" className="btn sm" disabled={pending} title="A separate account (like a gift fund) never counts as spending or money in"
                          onClick={() => run(() => updateAccount(a.id, { kept_separate: !a.kept_separate }))}>
                          {a.kept_separate ? "Count in spending" : "Keep separate"}
                        </button>
                      )}
                    </>
                  )}
                  <button type="button" className="btn sm" disabled={pending}
                    onClick={() => run(() => updateAccount(a.id, { hidden: !a.hidden }))}>
                    {a.hidden ? "Show" : "Hide"}
                  </button>
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {item.status === "needs_login" && (
              <PlaidLinkButton kind={item.products.includes("investments") ? "investment" : "bank"} label="Sign in again" updateItemId={item.id} className="btn sm primary" />
            )}
            <button type="button" className="btn sm" disabled={pending}
              onClick={() => run(() => removeItem(item.id), `Disconnected ${item.institution_name}. Its history stays.`)}>
              Disconnect
            </button>
          </div>
        </div>
      ))}

      {unlinked.length > 0 && items.length > 0 && (
        <div className="panel s12">
          <div className="ph"><h2>Accounts not linked yet</h2></div>
          <p className="small muted">{unlinked.map((u) => `${u.institution} ${u.name}`).join(" · ")}</p>
        </div>
      )}
    </div>
  );
}
