"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { resetDemoAction } from "@/app/(app)/demo-actions";
import { ReplayTourButton } from "@/components/DemoTour";
import { config } from "@/lib/config";
import { DEMO } from "@/lib/demo/mode";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/retirement", label: "Retirement" },
  { href: "/investments", label: "Investments" },
  { href: "/spending", label: "Spending" },
  { href: "/sheet", label: "Sheet" },
  { href: "/connections", label: "Connections" },
].filter((l) => l.href !== "/sheet" || (config.sheet && !DEMO)); // the sheet is a personal export, left out of the demo

const ICON: Record<string, string> = {
  "/": "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  "/spending": "M3 6h18v12H3zM3 10h18M7 15h4",
  "/retirement": "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7v5l3 2",
  "/investments": "M3 17l6-6 4 4 8-8M15 7h6v6",
  "/sheet": "M4 4h16v16H4zM4 10h16M4 15h16M10 4v16",
  "/connections": "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};
// Phone tab bar: the pages you check most, and the rest under More.
const TABS = ["/", "/spending", "/retirement", "/investments"];
const MORE = ["/sheet", "/connections"].filter((h) => LINKS.some((l) => l.href === h));

// Account detail pages (/retirement/fid) highlight their bucket's link.
function useActive() {
  const path = usePathname();
  return "/" + (path.split("/")[1] ?? "");
}

export function SideNav() {
  return <NavLinks active={useActive()} />;
}

export function PhoneTabs() {
  return <TabBar active={useActive()} />;
}

export function NavLinks({ active }: { active?: string }) {
  return (
    <nav aria-label="Sections" className="side-nav">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} title={l.label} aria-current={active === l.href ? "page" : undefined}>
          <Icon d={ICON[l.href]} /><span>{l.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function TabBar({ active }: { active: string }) {
  const [more, setMore] = useState(false);
  const label = (href: string) => LINKS.find((l) => l.href === href)!.label;
  // Close the More sheet whenever the page changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on navigation
    setMore(false);
  }, [active]);
  return (
    <>
      {more && (
        <div className="more-sheet" role="dialog" aria-label="More pages">
          {MORE.map((h) => (
            <Link key={h} href={h} aria-current={active === h ? "page" : undefined}>{label(h)}</Link>
          ))}
          {DEMO ? (
            <><ReplayTourButton /><form action={resetDemoAction}><button type="submit">Reset demo</button></form></>
          ) : (
            <form action="/auth/signout" method="post"><button type="submit">Sign out</button></form>
          )}
        </div>
      )}
      <nav className="tabbar" aria-label="Sections">
        {TABS.map((h) => (
          <Link key={h} href={h} aria-current={active === h ? "page" : undefined}>
            <Icon d={ICON[h]} /><span>{label(h)}</span>
          </Link>
        ))}
        <button type="button" aria-expanded={more} aria-current={MORE.includes(active) ? "page" : undefined} onClick={() => setMore(!more)}>
          <Icon d={ICON.more} /><span>More</span>
        </button>
      </nav>
    </>
  );
}
