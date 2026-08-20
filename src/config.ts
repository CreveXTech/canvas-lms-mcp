export type TransportMode = "stdio" | "http";

export interface Config {
  canvasBaseUrl: string;
  canvasApiToken: string;
  transport: TransportMode;
  httpPort: number;
  httpHost: string;
  /** Bearer token required on HTTP requests. Required when transport is "http". */
  authToken: string | undefined;
  /** Host header values accepted by the HTTP transport (DNS rebinding protection). */
  allowedHosts: string[];
  perPage: number;
  requestTimeoutMs: number;
  maxPages: number;
  maxConcurrency: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is not set.`);
  return value;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`);
  }
  return parsed;
}

export function loadConfig(): Config {
  const transport = (process.env["MCP_TRANSPORT"] ?? "stdio").toLowerCase();
  if (transport !== "stdio" && transport !== "http") {
    throw new Error(`MCP_TRANSPORT must be "stdio" or "http", got: ${transport}`);
  }

  const authToken = process.env["MCP_AUTH_TOKEN"];
  if (transport === "http" && !authToken) {
    throw new Error(
      "MCP_AUTH_TOKEN must be set when MCP_TRANSPORT=http. The HTTP endpoint " +
        "proxies your Canvas token and must not be left unauthenticated.",
    );
  }

  const httpPort = intEnv("MCP_HTTP_PORT", 3000);

  return {
    canvasBaseUrl: (
      process.env["CANVAS_BASE_URL"] ?? "https://canvas.instructure.com/api/v1"
    ).replace(/\/+$/, ""),
    canvasApiToken: required("CANVAS_API_TOKEN"),
    transport,
    httpPort,
    httpHost: process.env["MCP_HTTP_HOST"] ?? "0.0.0.0",
    authToken,
    allowedHosts: (
      process.env["MCP_ALLOWED_HOSTS"] ??
      `localhost:${httpPort},127.0.0.1:${httpPort}`
    )
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
    perPage: intEnv("CANVAS_PER_PAGE", 100),
    requestTimeoutMs: intEnv("CANVAS_TIMEOUT_MS", 30_000),
    maxPages: intEnv("CANVAS_MAX_PAGES", 20),
    maxConcurrency: intEnv("CANVAS_MAX_CONCURRENCY", 5),
  };
}
