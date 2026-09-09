import { readEventEvidence } from "./evidence";

type SourceEvidence = {
  provider: string;
  source_state: string;
  primary_source_confirmed: boolean;
  public_source_url: string | null;
};

export type ScoreEvidence = SourceEvidence & {
  evidence?: unknown;
  ai_impact_points: number | null;
  local_rank: number | null;
  attendance: number | null;
  venue_capacity: number | null;
  checked_at: string;
};

export function isEnabledPrimarySource(
  source: SourceEvidence,
  enabledSources: string[],
) {
  return (
    enabledSources.includes(source.provider) &&
    source.source_state === "active" &&
    source.primary_source_confirmed &&
    Boolean(source.public_source_url)
  );
}

export function selectScoreEvidence<T extends ScoreEvidence>(
  sources: T[],
  enabledSources: string[],
) {
  const rank = (source: ScoreEvidence) =>
    source.ai_impact_points !== null
      ? 3
      : source.local_rank !== null
        ? 2
        : source.attendance !== null || source.venue_capacity !== null
          ? 1
          : 0;
  const enabled = sources
    .filter((source) => isEnabledPrimarySource(source, enabledSources))
    .sort(
      (left, right) =>
        rank(right) - rank(left) ||
        right.checked_at.localeCompare(left.checked_at),
    );
  const selected = enabled[0];
  if (!selected) return undefined;
  const records = enabled.flatMap((source) => {
    const evidence = readEventEvidence(source.evidence);
    return evidence ? [evidence] : [];
  });
  if (!records.length) return selected;
  // Complementary demand facts about this canonical edition survive provider selection.
  const demand = [...new Map(records.flatMap((record) => record.demand)
    .map((fact) => [`${fact.sourceUrl}:${fact.text}`, fact])).values()];
  return { ...selected, evidence: { ...records[0], demand } };
}
