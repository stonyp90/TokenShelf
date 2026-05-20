import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/header";

export const metadata: Metadata = {
  title: "TokenShelf — Showcase AI builds with verified token spend",
  description:
    "A public shelf of AI-engineering realizations. Every project carries a receipt: how many tokens, on which model, for how many dollars.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen font-sans antialiased">
        <Header />
        <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-8">{children}</main>
        <footer className="border-t border-border/60 py-8 text-center text-sm text-muted">
          TokenShelf — receipts over claims.
        </footer>
      </body>
    </html>
  );
}
