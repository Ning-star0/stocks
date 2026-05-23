"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type ThemeMode = "system" | "light" | "dark";

const modes: Array<{ value: ThemeMode; label: string; icon: typeof Monitor }> = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon }
];

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("system");
  const active = modes.find((item) => item.value === mode) ?? modes[0];
  const Icon = active.icon;

  useEffect(() => {
    const saved = readThemeMode();
    setMode(saved);
    applyTheme(saved);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readThemeMode() === "system") applyTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  function cycleMode() {
    const index = modes.findIndex((item) => item.value === mode);
    const next = modes[(index + 1) % modes.length].value;
    setMode(next);
    window.localStorage.setItem("theme", next);
    applyTheme(next);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={cycleMode}
      title={`主题：${active.label}`}
      aria-label={`切换主题，当前为${active.label}`}
      className="h-9 px-2.5"
    >
      <Icon className="h-4 w-4" />
      <span className="hidden xl:inline">{active.label}</span>
    </Button>
  );
}

function readThemeMode(): ThemeMode {
  const value = window.localStorage.getItem("theme");
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function applyTheme(mode: ThemeMode) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const shouldDark = mode === "dark" || (mode === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", shouldDark);
  document.documentElement.style.colorScheme = shouldDark ? "dark" : "light";
}
