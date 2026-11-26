import type { Metadata, Viewport } from "next";
import { Geist_Mono, Onest, Sora } from "next/font/google";
import { config } from "@/lib/config";
import "./globals.css";

const display = Sora({ subsets: ["latin"], weight: ["600", "700"], variable: "--f-display" });
const body = Onest({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--f-body" });
const data = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--f-data" });

// Applies a saved dark/light choice (see ThemeToggle) before first paint, so it never flashes the other theme.
const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

const THEME_BOOT = `try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

export const metadata: Metadata = {
  title: "Ledger",
  description: DEMO ? "A demo of Ledger, a personal finance tracker, with made-up data." : config.description,
  robots: { index: false, follow: false },
  // Added to the iPhone home screen, it opens full screen like an app.
  appleWebApp: { capable: true, title: "Ledger", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e6efe3" },
    { media: "(prefers-color-scheme: dark)", color: "#071417" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${data.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
