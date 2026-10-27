/**
 * An XMTP backend push is a data-only hint: `{ topic, sequence_id }` (no content). expo-notifications
 * hands the FCM data to a background task nested differently per app state, sometimes as a JSON string.
 */
export function isXmtpHint(payload: unknown, depth = 0): boolean {
  if (!payload || typeof payload !== "object" || depth > 5) return false;
  const o = payload as Record<string, unknown>;
  if (typeof o.topic === "string" && o.sequence_id != null) return true;
  return Object.values(o).some((v) => isXmtpHint(typeof v === "string" && v.startsWith("{") ? safeJson(v) : v, depth + 1));
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
