import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppHeader } from "@/components/AppHeader";
import { LazyChatPanel } from "@/components/LazyChatPanel";
import { getSession } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "股票 AI 监控",
  description: "股票监控与 AI 辅助分析系统",
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }]
  }
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await getSafeSession();

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <div className="min-h-screen terminal-grid">
          <AppHeader signedIn={Boolean(session)} />
          <main className="mx-auto w-full max-w-7xl px-5 py-6 lg:px-8">{children}</main>
          <footer className="mx-auto w-full max-w-7xl px-5 pb-6 text-xs text-muted-foreground lg:px-8">
            本系统仅用于研究和辅助分析，不构成投资建议。市场有风险，决策需独立判断。
          </footer>
          {session ? <LazyChatPanel /> : null}
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
