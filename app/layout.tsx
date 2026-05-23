import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BarChart3 } from "lucide-react";

import { AppNav } from "@/components/AppNav";
import { ChatPanel } from "@/components/ChatPanel";
import { getSession } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "股票 AI 监控",
  description: "股票监控与 AI 辅助分析系统"
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await getSafeSession();

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <div className="min-h-screen bg-background terminal-grid">
          <header className="sticky top-0 z-40 border-b border-border/70 bg-background/82 backdrop-blur-xl">
            <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-3 lg:px-8">
              <Link href="/watchlist" className="flex shrink-0 items-center gap-2 font-semibold">
                <BarChart3 className="h-5 w-5 text-primary" />
                股票 AI 监控
              </Link>
              {session ? <AppNav /> : null}
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl px-5 py-6 lg:px-8">{children}</main>
          <footer className="mx-auto w-full max-w-7xl px-5 pb-6 text-xs text-muted-foreground lg:px-8">
            本系统仅用于研究和辅助分析，不构成投资建议。市场有风险，决策需独立判断。
          </footer>
          {session ? <ChatPanel /> : null}
        </div>
      </body>
    </html>
  );
}

const themeScript = `
(() => {
  try {
    const mode = localStorage.getItem("theme") || "system";
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = mode === "dark" || (mode === "system" && prefersDark);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch {
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
  }
})();
`;

async function getSafeSession() {
  try {
    return await getSession();
  } catch {
    return null;
  }
}
