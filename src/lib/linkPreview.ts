/**
 * OpenGraph Link Preview
 *
 * Fetches OG metadata (title, description, image) for URLs in messages.
 * Results are cached in memory to avoid refetching on scroll.
 */

export interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
}

/** In-memory cache: URL → preview data (or null if fetch failed) */
const _previewCache = new Map<string, LinkPreviewData | null>();

/** Pending fetches to avoid duplicate requests */
const _pendingFetches = new Map<string, Promise<LinkPreviewData | null>>();

const URL_REGEX = /https?:\/\/[^\s"'<>)]+/;
const OG_TIMEOUT = 5000;

/** Extract the first URL from message content */
export function extractUrl(content: string): string | null {
  // Skip media messages
  if (content.startsWith('GIF:') || content.startsWith('IMAGE:') || content.startsWith('VIDEO:')) {
    return null;
  }
  const match = content.match(URL_REGEX);
  return match ? match[0] : null;
}

/** Get cached preview (returns undefined if not yet fetched) */
export function getCachedPreview(url: string): LinkPreviewData | null | undefined {
  return _previewCache.has(url) ? _previewCache.get(url)! : undefined;
}

/** Fetch OpenGraph data for a URL */
export async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
  // Return cached
  if (_previewCache.has(url)) return _previewCache.get(url)!;

  // Return pending
  if (_pendingFetches.has(url)) return _pendingFetches.get(url)!;

  const promise = _doFetch(url);
  _pendingFetches.set(url, promise);

  try {
    const result = await promise;
    _previewCache.set(url, result);
    return result;
  } finally {
    _pendingFetches.delete(url);
  }
}

async function _doFetch(url: string): Promise<LinkPreviewData | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OG_TIMEOUT);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OnlyMonkes/1.0; +https://onlymonkes.app)',
        Accept: 'text/html',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) return null;

    // Only read first 16KB to find OG tags (don't download entire page)
    const reader = res.body?.getReader();
    if (!reader) return null;

    let html = '';
    const decoder = new TextDecoder();
    while (html.length < 16384) {
      const { value, done } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      // Stop early once we've passed </head>
      if (html.includes('</head>')) break;
    }
    reader.cancel().catch(() => {});

    return _parseOgTags(url, html);
  } catch {
    return null;
  }
}

function _parseOgTags(url: string, html: string): LinkPreviewData | null {
  const getMetaContent = (property: string): string | undefined => {
    // Match both property="og:..." and name="og:..."
    const regex = new RegExp(
      `<meta[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']` +
      `|<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
      'i',
    );
    const match = html.match(regex);
    return match?.[1] || match?.[2] || undefined;
  };

  const title = getMetaContent('og:title') ?? _extractTitle(html);
  const description = getMetaContent('og:description') ?? getMetaContent('description');
  const image = getMetaContent('og:image');
  const siteName = getMetaContent('og:site_name');

  // Need at least a title to be useful
  if (!title) return null;

  // Resolve relative image URLs
  let resolvedImage = image;
  if (image && !image.startsWith('http')) {
    try {
      resolvedImage = new URL(image, url).href;
    } catch { /* leave as-is */ }
  }

  return { url, title, description, image: resolvedImage, siteName };
}

function _extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1]?.trim() || undefined;
}
