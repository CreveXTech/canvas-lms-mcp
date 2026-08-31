const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  deg: "°",
  times: "×",
  copy: "©",
  reg: "®",
  trade: "™",
};

/** Decodes the HTML entities Canvas's rich-content editor actually emits. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const codePoint = entity[1]?.toLowerCase() === "x"
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      if (Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * Reduces Canvas HTML to readable plain text: drops script/style content,
 * turns block boundaries into spaces, strips tags, then decodes entities.
 */
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Convenience for the many `field ? stripHtml(field) : null` sites. */
export function stripHtmlOrNull(html: string | null | undefined): string | null {
  return html ? stripHtml(html) : null;
}

const MEDIA_HOST_PATTERN =
  /(youtube\.com|youtu\.be|vimeo\.com|kaltura|panopto|instructuremedia|echo360|mediasite|zoom\.us|loom\.com|wistia|brightcove|soundcloud|spotify)/i;

const MEDIA_EXTENSION_PATTERN =
  /\.(mp4|m4v|mov|webm|avi|mkv|mp3|m4a|wav|ogg|flac|aac)(\?|#|$)/i;

/**
 * Collects embedded media links from Canvas HTML: every `<iframe>` (which is how
 * Kaltura, Panopto and YouTube embeds arrive) plus anchors that point at a known
 * media host or a media file extension. Ordinary document and page links are
 * excluded — they are not media and only add noise.
 */
export function extractMediaUrls(html: string): string[] {
  const urls: string[] = [];

  for (const match of html.matchAll(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    if (match[1]) urls.push(match[1]);
  }

  for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) {
    const href = match[1];
    if (!href) continue;
    if (MEDIA_HOST_PATTERN.test(href) || MEDIA_EXTENSION_PATTERN.test(href)) {
      urls.push(href);
    }
  }

  for (const match of html.matchAll(/<(?:video|audio|source)\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    if (match[1]) urls.push(match[1]);
  }

  return [...new Set(urls.map(decodeEntities))];
}
