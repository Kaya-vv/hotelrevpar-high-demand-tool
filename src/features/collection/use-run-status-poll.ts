"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 15_000;
// A pending Anthropic batch legitimately spans hours of 120-second continuations, and
// router.refresh() re-renders the whole server tree: roughly 140 kB of reads per tick. An
// unbounded three-second poll spent an entire monthly egress quota during one stuck run, so the
// watch now covers a normal run and then hands the wait back to the operator.
const POLL_WINDOW_MS = 10 * 60_000;

/** True once the watch window closed while work was still pending, so callers can offer a reload. */
export function useRunStatusPoll(pending: boolean) {
  const router = useRouter();
  const [watching, setWatching] = useState(pending);
  const [expired, setExpired] = useState(false);

  // A fresh run reopens the watch. Adjusting during render is React's documented reset pattern and
  // avoids the cascading re-render that setState inside the effect body would cause.
  if (watching !== pending) {
    setWatching(pending);
    setExpired(false);
  }

  // The window must not depend on the router's identity: a re-created router would restart the
  // watch on every render and reinstate the unbounded poll this bound exists to remove.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    if (!pending) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt >= POLL_WINDOW_MS) {
        window.clearInterval(timer);
        setExpired(true);
        return;
      }
      routerRef.current.refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [pending]);

  return pending && expired;
}
