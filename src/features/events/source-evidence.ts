type SourceEvidence = {
  provider: string;
  source_state: string;
  primary_source_confirmed: boolean;
  public_source_url: string | null;
};

export type ScoreEvidence = SourceEvidence & {
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
  return sources
    .filter((source) => isEnabledPrimarySource(source, enabledSources))
    .sort(
      (left, right) =>
        rank(right) - rank(left) ||
        right.checked_at.localeCompare(left.checked_at),
    )[0];
}
