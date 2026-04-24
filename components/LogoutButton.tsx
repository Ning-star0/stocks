"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button size="sm" variant="ghost" onClick={logout} disabled={loading} title="退出登录">
      <LogOut className="h-4 w-4" />
      <span className="hidden sm:inline">{loading ? "退出中" : "退出"}</span>
    </Button>
  );
}
