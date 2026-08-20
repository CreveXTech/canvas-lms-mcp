import type { Config } from "./config.js";

export class CanvasError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly path: string,
  ) {
    super(message);
    this.name = "CanvasError";
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses the `next` link out of a Canvas `Link` header.
 * Canvas paginates every collection endpoint and only advertises the next page here.
 */
function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match?.[1]) return match[1];
  }
  return null;
}

function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 8_000);
}

/** Retry delay honouring `Retry-After` when Canvas sends it, else exponential backoff. */
function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 30_000);
    }
  }
  return backoffMs(attempt);
}

export class CanvasClient {
  constructor(private readonly config: Config) {}

  /** Absolute URL for a path relative to the Canvas API root. */
  private url(pathOrUrl: string): string {
    return pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `${this.config.canvasBaseUrl}${pathOrUrl}`;
  }

  private async request(pathOrUrl: string): Promise<Response> {
    const url = this.url(pathOrUrl);

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.config.canvasApiToken}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        });
      } catch (err) {
        // Timeouts and network failures are worth one more try.
        if (attempt + 1 >= MAX_ATTEMPTS) {
          const reason = err instanceof Error ? err.message : String(err);
          throw new CanvasError(
            `Canvas API request failed: ${reason}`,
            undefined,
            pathOrUrl,
          );
        }
        await sleep(backoffMs(attempt));
        continue;
      }

      if (response.ok) return response;

      if (RETRYABLE_STATUSES.has(response.status) && attempt + 1 < MAX_ATTEMPTS) {
        await sleep(retryDelayMs(response, attempt));
        continue;
      }

      const body = await response.text().catch(() => "");
      throw new CanvasError(
        `Canvas API returned ${response.status} ${response.statusText} for ${pathOrUrl}` +
          (body ? ` — ${body.slice(0, 500)}` : ""),
        response.status,
        pathOrUrl,
      );
    }
  }

  private async json<T>(response: Response, pathOrUrl: string): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch {
      throw new CanvasError(
        "Canvas API returned a response that is not valid JSON",
        response.status,
        pathOrUrl,
      );
    }
  }

  /** Fetches a single Canvas object. */
  async get<T>(path: string): Promise<T> {
    const response = await this.request(path);
    return this.json<T>(response, path);
  }

  /**
   * Fetches a collection, following `Link: rel="next"` until exhausted.
   * `per_page` is injected unless the caller already set it.
   */
  async list<T>(path: string): Promise<T[]> {
    const [base, query = ""] = path.split("?", 2);
    const params = new URLSearchParams(query);
    if (!params.has("per_page")) {
      params.set("per_page", String(this.config.perPage));
    }

    let url: string | null = `${base}?${params}`;
    const items: T[] = [];

    for (let page = 0; url && page < this.config.maxPages; page++) {
      const response = await this.request(url);
      const batch = await this.json<T[]>(response, url);
      if (!Array.isArray(batch)) {
        throw new CanvasError(
          "Expected a JSON array from a Canvas collection endpoint",
          response.status,
          url,
        );
      }
      items.push(...batch);
      url = nextLink(response.headers.get("link"));
    }

    return items;
  }

  /**
   * Maps over items with a bounded number of in-flight Canvas requests, so a
   * large module or file listing cannot fan out into a rate-limit storm.
   */
  async mapLimited<T, R>(
    items: readonly T[],
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;

    const workers = Array.from(
      { length: Math.min(this.config.maxConcurrency, items.length) },
      async () => {
        while (true) {
          const index = cursor++;
          if (index >= items.length) return;
          results[index] = await fn(items[index] as T, index);
        }
      },
    );

    await Promise.all(workers);
    return results;
  }
}
