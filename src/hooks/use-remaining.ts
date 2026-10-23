"use client";

import { useEffect, useState } from "react";

/** Sisa detik sampai `until` (ISO), berdetak tiap detik; null bila tidak ada batas. */
export function useRemaining(until: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  return Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
}

export const mmss = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
