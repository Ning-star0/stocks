"use client";

import { useEffect } from "react";

const EDGE_SENSITIVITY = 88;
const ACTIVE_SELECTOR = ".glow-card";

export function BorderGlowController() {
  useEffect(() => {
    let frame = 0;
    let latestEvent: PointerEvent | null = null;
    const activeCards = new Set<HTMLElement>();

    function schedule(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      latestEvent = event;
      if (frame) return;
      frame = window.requestAnimationFrame(updateGlow);
    }

    function updateGlow() {
      frame = 0;
      if (!latestEvent) return;

      const pointerX = latestEvent.clientX;
      const pointerY = latestEvent.clientY;
      const nextActiveCards = new Set<HTMLElement>();
      const cards = document.querySelectorAll<HTMLElement>(ACTIVE_SELECTOR);

      cards.forEach((card) => {
        const rect = card.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const isNear =
          pointerX >= rect.left - EDGE_SENSITIVITY &&
          pointerX <= rect.right + EDGE_SENSITIVITY &&
          pointerY >= rect.top - EDGE_SENSITIVITY &&
          pointerY <= rect.bottom + EDGE_SENSITIVITY;

        if (!isNear) return;

        const localX = clamp(pointerX - rect.left, 0, rect.width);
        const localY = clamp(pointerY - rect.top, 0, rect.height);
        const distanceToRect = distanceFromRect(pointerX, pointerY, rect);
        const distanceToEdge = distanceToRect > 0
          ? distanceToRect
          : Math.min(localX, rect.width - localX, localY, rect.height - localY);
        const edgeProximity = clamp(1 - distanceToEdge / EDGE_SENSITIVITY, 0, 1);

        if (edgeProximity <= 0) return;

        const angle = Math.atan2(localY - rect.height / 2, localX - rect.width / 2) * (180 / Math.PI) + 90;
        card.style.setProperty("--glow-x", `${localX}px`);
        card.style.setProperty("--glow-y", `${localY}px`);
        card.style.setProperty("--glow-angle", `${angle}deg`);
        card.style.setProperty("--glow-edge", edgeProximity.toFixed(3));
        nextActiveCards.add(card);
      });

      activeCards.forEach((card) => {
        if (!nextActiveCards.has(card)) card.style.setProperty("--glow-edge", "0");
      });
      activeCards.clear();
      nextActiveCards.forEach((card) => activeCards.add(card));
    }

    function clearGlow() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      latestEvent = null;
      activeCards.forEach((card) => card.style.setProperty("--glow-edge", "0"));
      activeCards.clear();
    }

    window.addEventListener("pointermove", schedule, { passive: true });
    window.addEventListener("pointerleave", clearGlow);
    window.addEventListener("blur", clearGlow);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", schedule);
      window.removeEventListener("pointerleave", clearGlow);
      window.removeEventListener("blur", clearGlow);
    };
  }, []);

  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function distanceFromRect(x: number, y: number, rect: DOMRect) {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}
