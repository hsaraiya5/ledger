"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { usePlaidLink } from "react-plaid-link";
import { createLinkToken, exchangePublicToken, type LinkKind } from "@/app/(app)/connections/actions";

export const LINK_STORAGE_KEY = "ledger.plaidLink";

/** Fetches a link token on click, then opens Plaid Link once it's ready. */
export function PlaidLinkButton({ kind, label, updateItemId, className = "btn" }: {
  kind: LinkKind;
  label: string;
  updateItemId?: string;
  className?: string;
}) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { open, ready } = usePlaidLink({
    token,
    onSuccess: (publicToken, metadata) => {
      startTransition(async () => {
        if (updateItemId || !publicToken) {
          router.refresh();
          return;
        }
        const res = await exchangePublicToken(publicToken, kind, metadata.institution?.name ?? "");
        if ("error" in res) setError(res.error ?? "Linking failed.");
        router.refresh();
      });
    },
    onExit: (err, metadata) => {
      setToken(null);
      // Show Plaid's reason so a failed link can be diagnosed (also in Plaid dashboard → Activity).
      if (err) {
        const bank = metadata.institution?.name ? `${metadata.institution.name}: ` : "";
        setError(`${bank}${err.display_message || err.error_message} (${err.error_code})`);
      }
    },
  });

  useEffect(() => {
    if (token && ready) open();
  }, [token, ready, open]);

  function start() {
    setError(null);
    startTransition(async () => {
      const res = await createLinkToken(kind, updateItemId);
      if ("error" in res) return setError(res.error ?? "Couldn't start Plaid.");
      // Banks that use OAuth send you back to /plaid/oauth, which needs the same token to resume.
      try {
        localStorage.setItem(LINK_STORAGE_KEY, JSON.stringify({ token: res.token, kind, updateItemId }));
      } catch {}
      setToken(res.token);
    });
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button type="button" className={className} onClick={start} disabled={pending}>
        {pending ? "Working…" : label}
      </button>
      {error && <span className="small down">{error}</span>}
    </span>
  );
}
