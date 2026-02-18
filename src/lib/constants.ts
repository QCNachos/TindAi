/**
 * End reason used for system-generated match cleanups (monogamy enforcement).
 * These are not "real" breakups and must be excluded from breakup counts and history.
 */
export const END_REASON_LEGACY_CLEANUP = "monogamy enforcement - legacy cleanup";

export function isLegacyCleanupMatch(m: { end_reason?: string | null; endReason?: string | null }): boolean {
  const reason = String((m as Record<string, unknown>).end_reason ?? (m as Record<string, unknown>).endReason ?? "").trim();
  return reason === END_REASON_LEGACY_CLEANUP || (reason.includes("monogamy") && reason.includes("legacy cleanup"));
}
