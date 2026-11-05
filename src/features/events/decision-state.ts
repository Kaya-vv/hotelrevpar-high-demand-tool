import type { ValidationReason } from "./types";

export const providerStatusReasons = new Set<ValidationReason>(["cancelled", "postponed", "removed"]);

// Every exclusion the pipeline decides records why, so later evidence can reverse it. A null
// reason means a human excluded the event, and that decision is sticky.
export function automatedExclusionReason(
  state: string,
  validationReason: ValidationReason | null,
  existingManualExclusion: boolean,
) {
  if (existingManualExclusion || state !== "excluded" || !validationReason) return null;
  return providerStatusReasons.has(validationReason) ? `provider_${validationReason}` : validationReason;
}
