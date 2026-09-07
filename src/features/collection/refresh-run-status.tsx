"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function RefreshRunStatus({ pending }: { pending: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => router.refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [pending, router]);
  return null;
}
