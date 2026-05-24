"use client";

import dynamic from "next/dynamic";
import { MessageCircle } from "lucide-react";

const ChatPanel = dynamic(() => import("@/components/ChatPanel").then((mod) => mod.ChatPanel), {
  ssr: false,
  loading: () => (
    <button
      className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
      aria-label="AI 助手加载中"
      disabled
    >
      <MessageCircle className="h-6 w-6" />
    </button>
  )
});

export function LazyChatPanel() {
  return <ChatPanel />;
}
