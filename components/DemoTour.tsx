"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";

/** One stop on the tour. `target` is a CSS selector; without one (or if it isn't on screen) the card sits centered. */
type Step = { path: string; target?: string; title: string; body: string };

const STEPS: Step[] = [
  { path: "/", title: "Welcome to Ledger",
    body: "A personal finance tracker: net worth, retirement, investments and spending in one place, fed by your banks through Plaid. Everything here is a made-up household, so click anything. Your edits stay in this browser only." },
  { path: "/", target: ".dash.home .hero", title: "Net worth, by bucket",
    body: "Every account rolls up into retirement, investments or cash. Hover for any month; click a band to open that bucket." },
  { path: "/", target: "#cash", title: "Widgets that open into pages",
    body: "Home is a wall of widgets, each a summary of one page. Accounts you keep apart, like this travel fund, are shown but not counted." },
  { path: "/retirement", target: ".panel.sticky", title: "Contributions vs IRS limits",
    body: "What you and your employer put in this year, month by month, checked against the 401(k) and IRA limits across every account." },
  { path: "/retirement", target: ".fgroup", title: "Every fund, with real growth",
    body: "Invested is what went in; growth compares it to today's value. Pick a time range at the top and these follow it." },
  { path: "/investments", target: ".addp", title: "Fill in what the brokerage doesn't know",
    body: "Some brokerages don't report what you paid, like these ESPP shares. Click Add what you paid to enter it, and gains appear." },
  { path: "/investments", target: ".panel.sticky", title: "Stock comp, read from transactions",
    body: "RSU vests, shares sold to cover taxes, and ESPP purchases are picked out of the brokerage's activity automatically." },
  { path: "/spending", target: ".toolbar", title: "Spending, month by month",
    body: "Step through months or widen to 3 months or a year. Account tabs below split it by card and bank." },
  { path: "/spending", target: ".txns tbody tr", title: "Click a transaction's name",
    body: "Change its category (and save a rule for that merchant), split it across categories, add a note, or record who owes you for it. Transfers between your own accounts are paired up and left out of spending." },
  { path: "/spending", target: ".owedbtn", title: "Who owes you",
    body: "Shared dinners and trips land here until they're paid back. Paybacks that arrive (say, on Venmo) aren't counted as income." },
  { path: "/spending", target: ".bdbtn", title: "Breakdown and categories",
    body: "Where the money went by category, plus projects like a trip that collect spending across months. Rename, merge and add categories here." },
  { path: "/connections", target: ".panel.s12", title: "Your banks, through Plaid",
    body: "In your own copy, this is where you link banks and brokerages. It syncs daily and flags logins that need attention. Linking is off in the demo." },
  { path: "/connections", target: ".theme-toggle", title: "Dark or light",
    body: "Switch any time. Until you do, it follows your device." },
  { path: "/", title: "Now explore",
    body: "Try recategorizing a transaction, splitting one, or marking an IOU paid. Reset demo in the sidebar puts everything back, and Replay tour runs this again." },
];

const KEY = "ledger-demo-tour";
const visible = (el: Element | null): el is HTMLElement => !!el && (el as HTMLElement).offsetParent !== null;

export function DemoTour() {
  const router = useRouter();
  const path = usePathname();
  const [step, setStep] = useState<number | null>(null);
  // Where the current step's target sits, tagged with its step so a stale one is ignored.
  const [spot, setSpot] = useState<{ step: number; rect: DOMRect | null } | null>(null);

  // First visit starts the tour; Replay tour (in the sidebar) restarts it.
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(KEY) === "done"; } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the saved state once after hydration
    if (!seen) setStep(0);
    const start = () => setStep(0);
    window.addEventListener("ledger-tour:start", start);
    return () => window.removeEventListener("ledger-tour:start", start);
  }, []);

  const finish = useCallback(() => {
    setStep(null);
    try { localStorage.setItem(KEY, "done"); } catch {}
  }, []);

  const s = step === null ? null : STEPS[step];

  // Go to the step's page, wait for its target, bring it into view, and follow it as the page moves.
  useLayoutEffect(() => {
    if (!s || step === null) return;
    if (path !== s.path) { router.push(s.path); return; }
    if (!s.target) return;
    let el: HTMLElement | null = null, tries = 0, raf = 0;
    const measure = () => setSpot({ step, rect: el ? el.getBoundingClientRect() : null });
    const find = () => {
      const found = document.querySelector(s.target!);
      if (visible(found)) {
        el = found;
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        measure();
      } else if (++tries < 60) raf = window.setTimeout(find, 80);
      else measure();
    };
    find();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => { clearTimeout(raf); window.removeEventListener("scroll", measure, true); window.removeEventListener("resize", measure); };
  }, [s, step, path, router]);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") setStep((i) => (i === null ? i : Math.min(STEPS.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setStep((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, finish]);

  if (!s || step === null) return null;
  const rect = spot?.step === step ? spot.rect : null;
  const last = step === STEPS.length - 1;
  const pad = 8;

  // The card goes below the target when there's room, otherwise above; on phones it docks to the bottom.
  let cardStyle: React.CSSProperties | undefined;
  if (rect && typeof window !== "undefined" && window.innerWidth > 640) {
    const below = rect.bottom + pad + 12, above = rect.top - pad - 12, w = 360;
    const left = Math.min(Math.max(16, rect.left), window.innerWidth - w - 16);
    // Below if it fits, else above, else (a target taller than the window) docked in the corner.
    cardStyle = below + 230 < window.innerHeight ? { top: below, left, width: w }
      : above > 230 ? { bottom: window.innerHeight - above, left, width: w }
      : { bottom: 24, right: 24, width: w };
  }

  return (
    <div className="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title">
      {rect
        ? <div className="tour-spot" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
        : <div className="tour-dim" />}
      <div className={`tour-card${rect ? "" : " center"}`} style={cardStyle}>
        <div className="tour-count num">{step + 1} / {STEPS.length}</div>
        <h2 id="tour-title">{s.title}</h2>
        <p>{s.body}</p>
        <div className="tour-actions">
          {!last && <button type="button" className="tour-skip" onClick={finish}>Skip tour</button>}
          {step > 0 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>Back</button>}
          <button type="button" className="btn primary" autoFocus onClick={() => (last ? finish() : setStep(step + 1))}>
            {step === 0 ? "Show me around" : last ? "Start exploring" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Restarts the tour from the first step. */
export function ReplayTourButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event("ledger-tour:start"))}>
      Replay tour
    </button>
  );
}
