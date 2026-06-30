import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppHeader } from "@/components/AppHeader";
import { BorderGlowController } from "@/components/BorderGlowController";
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
        <script dangerouslySetInnerHTML={{ __html: chunkErrorScript }} />
      </head>
      <body>
        <BorderGlowController />
        <div className="min-h-screen terminal-grid">
          <AppHeader signedIn={Boolean(session)} />
          <main className="mx-auto w-full max-w-[90rem] px-3 py-4 sm:px-5 sm:py-5 lg:px-7">{children}</main>
          <footer className="mx-auto flex w-full max-w-[90rem] flex-col gap-2 px-3 pb-6 text-xs text-muted-foreground sm:px-5 lg:flex-row lg:items-center lg:justify-between lg:px-7">
            <span>本系统仅用于研究和辅助分析，不构成投资建议。市场有风险，决策需独立判断。</span>
            <a className="transition-colors hover:text-foreground" href="https://beian.miit.gov.cn/" rel="noreferrer" target="_blank">
              冀ICP备2026007268号-1
            </a>
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

const chunkErrorScript = `
(() => {
  var KEY = "__chunk_reload_at";
  var RELOAD_WINDOW_MS = 30000;
  function reloadedRecently() {
    try {
      var last = Number(sessionStorage.getItem(KEY) || 0);
      return last > 0 && Date.now() - last < RELOAD_WINDOW_MS;
    } catch (e) {
      return false;
    }
  }
  function markReload() {
    try { sessionStorage.setItem(KEY, String(Date.now())); } catch (e) {}
  }
  function clearReloadMark() {
    try { sessionStorage.removeItem(KEY); } catch (e) {}
  }
  function isChunkMessage(message) {
    return /ChunkLoadError|Loading chunk|CSS_CHUNK_LOAD_FAILED|dynamically imported module/i.test(message || "");
  }
  function isNextAsset(target) {
    var url = target && (target.src || target.href || "");
    return typeof url === "string" && url.indexOf("/_next/static/") !== -1;
  }
  function reloadIfChunkError(error) {
    var msg = error && error.message ? error.message : String(error);
    if (isChunkMessage(msg) && !reloadedRecently()) {
      markReload();
      window.location.reload();
    }
  }
  window.addEventListener("load", function () {
    setTimeout(clearReloadMark, 1000);
  });
  window.addEventListener("unhandledrejection", function (event) {
    reloadIfChunkError(event.reason);
  });
  window.addEventListener("error", function (event) {
    if (isNextAsset(event.target) && !reloadedRecently()) {
      markReload();
      window.location.reload();
      return;
    }
    if (event.target && event.target.tagName === "SCRIPT") {
      reloadIfChunkError(event.error || new Error("Loading chunk failed"));
    }
  }, true);
})();
`;

async function getSafeSession() {
  try {
    return await getSession();
  } catch {
    return null;
  }
}
