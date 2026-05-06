import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BarChart3, Bell, Code2, ListChecks, Newspaper, Settings } from "lucide-react";

import { ChatPanel } from "@/components/ChatPanel";
import { LogoutButton } from "@/components/LogoutButton";
import { getSession } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "股票 AI 监控",
  description: "股票监控与 AI 辅助分析系统"
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await getSafeSession();

  return (
    <html lang="zh-CN" className="dark">
      <body>
        <div className="min-h-screen bg-background terminal-grid">
          <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
            <div className="mx-auto flex w-full max-w-[1760px] items-center justify-between px-4 py-3 lg:px-6 2xl:px-8">
              <Link href="/watchlist" className="flex items-center gap-2 font-semibold">
                <BarChart3 className="h-5 w-5 text-primary" />
                股票 AI 监控
              </Link>
              {session ? (
                <nav className="flex items-center gap-1">
                  <NavLink href="/watchlist" icon={<ListChecks className="h-4 w-4" />} label="自选股" />
                  <NavLink href="/news" icon={<Newspaper className="h-4 w-4" />} label="新闻" />
                  <NavLink href="/alerts" icon={<Bell className="h-4 w-4" />} label="提醒" />
                  <NavLink href="/api-docs" icon={<Code2 className="h-4 w-4" />} label="接口" />
                  <NavLink href="/settings" icon={<Settings className="h-4 w-4" />} label="设置" />
                  <LogoutButton />
                </nav>
              ) : null}
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1760px] px-4 py-6 lg:px-6 2xl:px-8">{children}</main>
          <footer className="mx-auto w-full max-w-[1760px] px-4 pb-6 text-xs text-muted-foreground lg:px-6 2xl:px-8">
            本系统仅用于研究和辅助分析，不构成投资建议。市场有风险，决策需独立判断。
          </footer>
          {session ? <ChatPanel /> : null}
        </div>
      </body>
    </html>
  );
}

function NavLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link href={href} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground">
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}

async function getSafeSession() {
  try {
    return await getSession();
  } catch {
    return null;
  }
}
