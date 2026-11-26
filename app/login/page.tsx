"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, { status: "idle" });

  return (
    <main className="login">
      <form action={action} className="panel login-card">
        <span className="eyebrow">Ledger</span>
        <h1>Sign in</h1>
        {state.status === "sent" ? (
          <p className="sentence">Check your email for a sign-in link. It expires in an hour.</p>
        ) : (
          <>
            <label className="f" htmlFor="email">
              Email
              <input id="email" name="email" type="email" required autoComplete="email" />
            </label>
            <button className="btn primary" type="submit" disabled={pending}>
              {pending ? "Sending…" : "Email me a sign-in link"}
            </button>
            {state.status === "error" && <p className="small down">{state.message}</p>}
          </>
        )}
      </form>
    </main>
  );
}
