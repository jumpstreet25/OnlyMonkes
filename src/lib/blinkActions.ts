/**
 * blinkActions.ts — Solana Actions / Blinks client
 *
 * Detects Action URLs in messages, fetches metadata via GET,
 * and executes actions via POST (returns unsigned transaction).
 *
 * Spec: https://solana.com/developers/guides/advanced/actions
 */

// ── Types (Solana Actions spec) ─────────────────────────────────────────────

export interface ActionParameter {
  name: string;
  label?: string;
  type?: "text" | "number" | "email" | "url" | "textarea" | "select";
  required?: boolean;
  min?: number;
  max?: number;
  options?: { label: string; value: string }[];
}

export interface ActionLink {
  label: string;
  href: string;
  type?: "transaction" | "message" | "external-link";
  parameters?: ActionParameter[];
}

export interface ActionMetadata {
  type: "action" | "completed";
  icon: string;
  title: string;
  description: string;
  label: string;
  disabled?: boolean;
  error?: { message: string };
  links?: {
    actions: ActionLink[];
  };
}

export interface ActionPostResponse {
  type?: "transaction";
  transaction: string; // base64-encoded serialized transaction
  message?: string;
  links?: {
    next?: {
      type: "inline" | "post";
      action?: ActionMetadata;
      href?: string;
    };
  };
}

// ── URL Detection ───────────────────────────────────────────────────────────

const SOLANA_ACTION_PREFIX = "solana-action:";
const DIAL_TO_REGEX = /https?:\/\/dial\.to\/?\?action=([^&\s]+)/;
const ACTION_URL_REGEX = /(?:solana-action:)(https?:\/\/[^\s"'<>)]+)/;

/**
 * Check if a URL is a Blink / Solana Action URL.
 */
export function isBlinkUrl(url: string): boolean {
  return (
    url.startsWith(SOLANA_ACTION_PREFIX) ||
    DIAL_TO_REGEX.test(url) ||
    url.includes("/api/actions/")
  );
}

/**
 * Extract a Blink URL from message content and resolve it to an Actions API URL.
 * Returns null if no Blink URL found.
 */
export function extractBlinkUrl(content: string): string | null {
  // Skip media messages
  if (
    content.startsWith("GIF:") ||
    content.startsWith("IMAGE:") ||
    content.startsWith("VIDEO:")
  )
    return null;

  // 1. solana-action:https://...
  const actionMatch = content.match(ACTION_URL_REGEX);
  if (actionMatch) return actionMatch[1];

  // 2. https://dial.to/?action=solana-action:https://...
  const dialMatch = content.match(DIAL_TO_REGEX);
  if (dialMatch) {
    const decoded = decodeURIComponent(dialMatch[1]);
    if (decoded.startsWith(SOLANA_ACTION_PREFIX)) {
      return decoded.slice(SOLANA_ACTION_PREFIX.length);
    }
    return decoded;
  }

  // 3. Direct Actions API URL pattern (our own server or known providers)
  const urlMatch = content.match(/https?:\/\/[^\s"'<>)]*\/api\/actions\/[^\s"'<>)]+/);
  if (urlMatch) return urlMatch[0];

  return null;
}

// ── Metadata Cache ──────────────────────────────────────────────────────────

const _metadataCache = new Map<string, ActionMetadata | null>();
const _pendingFetches = new Map<string, Promise<ActionMetadata | null>>();
const FETCH_TIMEOUT = 8000;

/**
 * Fetch Action metadata via GET request.
 * Cached in memory to avoid refetching on scroll.
 */
export async function fetchActionMetadata(
  actionUrl: string,
): Promise<ActionMetadata | null> {
  if (_metadataCache.has(actionUrl)) return _metadataCache.get(actionUrl)!;
  if (_pendingFetches.has(actionUrl)) return _pendingFetches.get(actionUrl)!;

  const promise = _doFetchMetadata(actionUrl);
  _pendingFetches.set(actionUrl, promise);

  try {
    const result = await promise;
    _metadataCache.set(actionUrl, result);
    return result;
  } finally {
    _pendingFetches.delete(actionUrl);
  }
}

async function _doFetchMetadata(
  actionUrl: string,
): Promise<ActionMetadata | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const res = await fetch(actionUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json();

    // Validate minimum required fields
    if (!data.title || !data.icon) return null;

    // Resolve relative icon URL
    if (data.icon && !data.icon.startsWith("http")) {
      try {
        data.icon = new URL(data.icon, actionUrl).href;
      } catch {
        /* leave as-is */
      }
    }

    return data as ActionMetadata;
  } catch {
    return null;
  }
}

/**
 * Execute an Action: POST with account, get back base64 transaction.
 */
export async function executeAction(
  actionHref: string,
  walletAddress: string,
): Promise<ActionPostResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  const res = await fetch(actionHref, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ account: walletAddress }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Action failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  if (!data.transaction) {
    throw new Error("Action response missing transaction");
  }

  return data as ActionPostResponse;
}

/**
 * Resolve a parametric href by substituting {param} placeholders.
 */
export function resolveActionHref(
  href: string,
  baseUrl: string,
  params: Record<string, string>,
): string {
  let resolved = href;
  for (const [key, value] of Object.entries(params)) {
    resolved = resolved.replace(`{${key}}`, encodeURIComponent(value));
  }
  // Resolve relative URLs
  if (!resolved.startsWith("http")) {
    try {
      resolved = new URL(resolved, baseUrl).href;
    } catch {
      /* leave as-is */
    }
  }
  return resolved;
}
