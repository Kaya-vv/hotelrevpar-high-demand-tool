"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

export function RefreshButton() {
  const { pending } = useFormStatus();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!pending) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1_000)), 1_000);
    return () => window.clearInterval(timer);
  }, [pending]);

  return (
    <button className="primary" type="submit" disabled={pending} aria-live="polite" onClick={() => setElapsed(0)}>
      {pending ? `Bronnen verzamelen… ${elapsed}s` : "Nu verversen"}
    </button>
  );
}
