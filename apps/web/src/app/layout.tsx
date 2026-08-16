import type { Metadata, Viewport } from "next";
import { getTheme, themeAttribute } from "@/server/theme";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Both families are self-hosted by next/font rather than pulled from the
 * Google CDN the design system linked. That removes a render-blocking
 * third-party request and, more importantly for a figures-first product, stops
 * the tabular-figure font arriving late and reflowing every number column.
 */
const sans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-instrument-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Falorb",
    template: "%s · Falorb",
  },
  description: "Self-hosted, first-party web analytics across every property you own.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#f4f4f4" },
  ],
  // Both are supported; which one applies is decided by the cookie or, absent
  // one, by the media query in themes.css.
  colorScheme: "light dark",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read server-side so the correct theme is in the very first paint. Resolving
  // it in the browser means rendering once in the wrong one — a full page of
  // white figures flashing before it goes black.
  const theme = await getTheme();

  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      data-theme={themeAttribute(theme)}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
