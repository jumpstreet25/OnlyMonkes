/**
 * Hermes-compatible fetch with timeout.
 *
 * React Native's AbortSignal polyfill (abort-controller package) does NOT
 * support the static AbortSignal.timeout() method. Using it throws:
 *   TypeError: AbortSignal.timeout is not a function
 *
 * This helper uses AbortController + setTimeout instead, which works on
 * all RN versions.
 */
export function fetchWithTimeout(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 10000, ...fetchOpts } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...fetchOpts, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}
