type SourceState = { state?: string; error?: string };

export function currentSourceError(source: SourceState | undefined, finishedAt: string | null) {
  return source?.error ?? (!source && finishedAt ? "Run stopte voordat deze bron verwerkt kon worden." : null);
}
