"use client";

import { useRouter } from "next/navigation";

import { useRunStatusPoll } from "./use-run-status-poll";

export function RefreshRunStatus({ pending }: { pending: boolean }) {
  const router = useRouter();
  const expired = useRunStatusPoll(pending);
  if (!expired) return null;
  return (
    <p className="updated-at">
      Nog bezig. Automatisch bijwerken is gestopt.{" "}
      <button type="button" className="link-button" onClick={() => router.refresh()}>
        Nu verversen
      </button>
    </p>
  );
}
