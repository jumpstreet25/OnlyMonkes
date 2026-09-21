/** Keep in lockstep with worker-actions/src/botCommand.ts and bot botHttpCommand.ts */
const MAX_COMMAND_CHARS = 4000;

export function isAllowedBotCommand(raw: string): boolean {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_COMMAND_CHARS) return false;

  const setupMatch = trimmed.match(/^\/autonomonke setup\s+(\{[\s\S]*\})$/i)
    ?? trimmed.match(/^\/automonke setup\s+(\{[\s\S]*\})$/i);
  if (setupMatch) {
    try {
      const parsed = JSON.parse(setupMatch[1]);
      return !!parsed && typeof parsed === "object";
    } catch {
      return false;
    }
  }

  const s = trimmed.replace(/\s+/g, " ").replace(/^\/automonke\b/i, "/autonomonke").toLowerCase();
  if (s === "/autonomonke" || s === "/autonomonke status") return true;
  if (s === "/autonomonke start" || s === "/autonomonke enable") return true;
  if (s === "/autonomonke stop" || s === "/autonomonke pause" || s === "/autonomonke resume") return true;
  if (s === "/autonomonke positions" || s === "/autonomonke pos") return true;
  if (s === "/autonomonke limits" || s === "/autonomonke limits on" || s === "/autonomonke limits off"
    || s === "/autonomonke limits toggle" || s === "/autonomonke limits status") return true;
  if (s === "/portfolio" || s === "/positions") return true;
  return false;
}
