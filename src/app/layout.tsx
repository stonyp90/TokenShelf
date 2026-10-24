import type { Metadata } from "next";
import { Inter, Source_Serif_4, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/header";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

const serif = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif",
  weight: ["400", "600", "700"],
  style: ["normal", "italic"],
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "TokenShelf — Verifiable AI engineering productivity",
  description:
    "Open-source daemon. Token-spend receipts. Builder-owned certified badge. Save up to 90% on AI tokens while earning a portable, cryptographically signed productivity score.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${serif.variable} ${mono.variable}`}
      data-theme="dark"
    >
      <body className="min-h-screen font-sans antialiased">
        <Header />
        <main className="container-wide pb-24 pt-8">{children}</main>
        <footer className="border-t border-border/60 py-10">
          <div className="container-wide flex flex-col items-center gap-3 text-center text-xs text-muted-foreground sm:flex-row sm:justify-between sm:text-left">
            <span>
              TokenShelf &middot; Verifiable AI engineering productivity.
            </span>
            <span className="font-mono">
              receipts over claims &middot; ed25519 &middot; open daemon
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
