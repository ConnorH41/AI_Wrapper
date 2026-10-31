import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";


export const metadata: Metadata = {
  title: "AI Wrapper",
  description: "Choose a character and scene to create a moving video.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-foreground">
        <header className="border-b bg-card">
          <div className="mx-auto flex min-h-16 max-w-5xl items-center justify-between gap-4 px-5 sm:px-6">
            <Link href="/" className="shrink-0 font-semibold tracking-tight">
              AI Wrapper
            </Link>
            <Link href="/studio" className="rounded-md px-2 py-2 text-right text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              Character video studio
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </body>
    </html>
  );
}
