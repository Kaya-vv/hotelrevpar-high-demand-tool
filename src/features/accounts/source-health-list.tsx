"use client";

import { useEffect, useState } from "react";
import type { SourceHealthRun, SourceHealthSummary } from "./source-health";
import { SourceHealthDetails } from "./source-health-table";

function RunDetails({ run }: { run: SourceHealthSummary }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<SourceHealthRun | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setError(true);
      controller.abort();
    }, 10_000);
    fetch(`/api/source-health/${run.id}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok || response.redirected)
          throw new Error("Details unavailable");
        const data: SourceHealthRun = await response.json();
        if (!controller.signal.aborted) {
          setDetail(data);
          setError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [open, run.id, run.label, retry]);
  return (
    <details
      className="panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <strong>{run.accountName}</strong>
        <span>{run.areaName}</span>
        <span>{new Date(run.startedAt).toLocaleString("nl-NL")}</span>
        <span>{run.label}</span>
      </summary>
      {error ? (
        <p role="status">
          Details tijdelijk niet bereikbaar.{" "}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Opnieuw proberen
          </button>
        </p>
      ) : detail ? (
        <SourceHealthDetails run={detail} />
      ) : open ? (
        <p role="status">Details laden…</p>
      ) : null}
    </details>
  );
}

export function SourceHealthList({ runs }: { runs: SourceHealthSummary[] }) {
  return (
    <div className="health-list">
      {runs.map((run) => (
        <RunDetails key={run.id} run={run} />
      ))}
    </div>
  );
}
