"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { exchangePublicToken, type LinkKind } from "@/app/(app)/connections/actions";
import { LINK_STORAGE_KEY } from "@/components/PlaidLinkButton";

type Saved = { token: string; kind: LinkKind; updateItemId?: string };

/** Banks that use OAuth (Capital One, Citi, Schwab) send you back here to finish linking. */
export default function PlaidOAuthPage() {
  const router = useRouter();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [status, setStatus] = useState("Finishing the connection…");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LINK_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after hydration
      if (raw) setSaved(JSON.parse(raw));
      else setStatus("This link expired. Start again from Connections.");
    } catch {
      setStatus("This link expired. Start again from Connections.");
    }
  }, []);

  const { open, ready } = usePlaidLink({
    token: saved?.token ?? null,
    receivedRedirectUri: typeof window === "undefined" ? undefined : window.location.href,
    onSuccess: async (publicToken, metadata) => {
      if (saved && !saved.updateItemId && publicToken) {
        const res = await exchangePublicToken(publicToken, saved.kind, metadata.institution?.name ?? "");
        if ("error" in res) return setStatus(res.error ?? "Linking failed.");
      }
      localStorage.removeItem(LINK_STORAGE_KEY);
      router.replace("/connections");
    },
    onExit: (err) => {
      if (err) return setStatus(`${err.display_message || err.error_message} (${err.error_code})`);
      router.replace("/connections");
    },
  });

  useEffect(() => {
    if (saved && ready) open();
  }, [saved, ready, open]);

  return <p className="muted">{status}</p>;
}
