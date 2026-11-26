import { Suspense } from "react";
import { NavLinks, PhoneTabs, SideNav } from "@/components/Nav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DemoTour, ReplayTourButton } from "@/components/DemoTour";
import { DEMO } from "@/lib/demo/mode";
import { resetDemoAction } from "./demo-actions";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      {/* Desktop: a sidebar. Phone: a slim top bar plus the bottom tab bar. */}
      <aside className="side">
        <div className="brand">Ledger<span>.</span>{DEMO && <i className="demo-tag">Demo</i>}</div>
        <Suspense fallback={<NavLinks />}>
          <SideNav />
        </Suspense>
        <div className="side-foot">
          {DEMO ? (
            <div className="demo-ctl">
              <ReplayTourButton className="signout" />
              <form action={resetDemoAction}><button className="signout" type="submit">Reset demo</button></form>
            </div>
          ) : (
            <form action="/auth/signout" method="post">
              <button className="signout" type="submit">Sign out</button>
            </form>
          )}
          <ThemeToggle />
        </div>
      </aside>
      <header className="bar">
        <div className="wrap bar-in">
          <div className="brand">Ledger<span>.</span></div>
          <ThemeToggle />
        </div>
      </header>
      <main className="wrap">{children}</main>
      <Suspense>
        <PhoneTabs />
      </Suspense>
      {DEMO && <Suspense><DemoTour /></Suspense>}
    </div>
  );
}
