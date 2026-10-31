/**
 * Bot → worker Bearer check. Fails closed: with BOT_HTTP_SECRET unset the old
 * `auth === \`Bearer ${env.BOT_HTTP_SECRET}\`` accepted the literal header "Bearer undefined"
 * (fixed 2026-10-28). Compares without an early exit on the first differing character.
 */
export function bearerOk(header: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const want = `Bearer ${secret}`;
  let diff = header.length ^ want.length;
  for (let i = 0; i < want.length; i++) diff |= (header.charCodeAt(i) || 0) ^ want.charCodeAt(i);
  return diff === 0;
}
