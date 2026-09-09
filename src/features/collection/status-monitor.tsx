"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { CollectionStatus } from "./status";
import { RunStatusContext } from "./use-run-status-poll";
import { CollectionProgress } from "@/components/collection-progress";

export function StatusMonitor({
  initial,
  children,
}: {
  initial?: CollectionStatus;
  children: ReactNode;
}) {
  const router = useRouter();
  const platform = usePathname() === "/admin/source-health";
  const [interests, setInterests] = useState<Record<string, boolean>>({});
  const register = useCallback(
    (id: string, pending: boolean) =>
      setInterests((previous) => {
        if (Boolean(previous[id]) === pending) return previous;
        const next = { ...previous };
        if (pending) next[id] = true;
        else delete next[id];
        return next;
      }),
    [],
  );
  const [expired, setExpired] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState(initial);
  const [restart, setRestart] = useState(0);
  const routerRef = useRef(router);
  const initialRef = useRef(initial);
  const interested = Boolean(initial?.pending || Object.keys(interests).length);
  const interestedRef = useRef(interested);
  useEffect(() => {
    routerRef.current = router;
    initialRef.current = initial;
    interestedRef.current = interested;
  }, [router, initial, interested]);
  const resume = useCallback(() => setRestart((value) => value + 1), []);

  useEffect(() => {
    let stopped = false;
    let pending = interestedRef.current;
    let revision = platform ? undefined : initialRef.current?.revision;
    let failures = 0;
    let inFlight = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 10 * 60_000;
    const available = () =>
      document.visibilityState === "visible" && navigator.onLine;
    const schedule = (delay: number) => {
      clearTimeout(timer);
      if (!stopped && pending && available()) timer = setTimeout(check, delay);
    };
    async function check(onFocus = false) {
      if (stopped || inFlight || !available()) return;
      if (Date.now() >= deadline && !onFocus) {
        setExpired(true);
        return;
      }
      inFlight = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 10_000);
      try {
        const response = await fetch(
          `/api/collection-status${platform ? "?scope=platform" : ""}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (response.redirected || [401, 403].includes(response.status)) {
          stopped = true;
          setProblem(
            "Sessie verlopen of geen toegang. Vernieuw de pagina om verder te gaan.",
          );
          return;
        }
        if (!response.ok) throw new Error("Status niet bereikbaar");
        const next: CollectionStatus = await response.json();
        if (stopped) return;
        if (
          (revision && revision !== next.revision) ||
          (!revision && pending && !next.pending)
        )
          routerRef.current.refresh();
        revision = next.revision;
        pending = next.pending;
        setStatus(next);
        setExpired(pending && Date.now() >= deadline);
        setProblem(null);
        failures = 0;
      } catch {
        if (stopped) return;
        failures++;
        setProblem(
          "Status tijdelijk niet bereikbaar. De laatst bekende gegevens blijven zichtbaar.",
        );
      } finally {
        clearTimeout(timeout);
        inFlight = false;
        if (Date.now() < deadline)
          schedule(Math.min(60_000, 15_000 * 2 ** Math.min(failures, 2)));
        else if (!stopped && pending) setExpired(true);
      }
    }
    const onAvailability = () => {
      clearTimeout(timer);
      // Returning to an expired/idle tab gets one fresh snapshot, not a new watch.
      if (available()) void check(true);
      else controller?.abort();
    };
    document.addEventListener("visibilitychange", onAvailability);
    window.addEventListener("online", onAvailability);
    window.addEventListener("offline", onAvailability);
    if (restart) void check();
    else schedule(15_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onAvailability);
      window.removeEventListener("online", onAvailability);
      window.removeEventListener("offline", onAvailability);
    };
  }, [initial?.watchKey, platform, restart, interested]);

  return (
    <RunStatusContext.Provider value={{ expired, register, resume }}>
      <CollectionProgress
        waitingForProvider={
          status?.watchKey === initial?.watchKey
            ? status?.waitingForProvider
            : initial?.waitingForProvider
        }
        batch={
          status?.watchKey === initial?.watchKey
            ? (status?.batch ?? null)
            : (initial?.batch ?? null)
        }
      />
      {(expired || problem) && (
        <p className="updated-at" role="status">
          {problem ??
            "Automatisch bijwerken is gestopt. Het onderzoek loopt op de server door."}{" "}
          <button type="button" className="link-button" onClick={resume}>
            Status opnieuw volgen
          </button>
        </p>
      )}
      {children}
    </RunStatusContext.Provider>
  );
}
