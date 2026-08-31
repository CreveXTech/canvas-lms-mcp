import { timingSafeEqual } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "./config.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

const MCP_PATH = "/mcp";
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function jsonRpcError(res: ServerResponse, status: number, code: number, message: string) {
  if (res.headersSent) return;
  const body = JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null });
  res.writeHead(status, { "Content-Type": "application/json" }).end(body);
}

function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so compare lengths separately.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Rejects requests whose Host or Origin header is not allow-listed, which is
 * what stops a DNS-rebinding attack from a browser reaching a locally bound
 * server. Done here rather than through the transport's own options, which the
 * SDK deprecated in favour of external middleware.
 */
function hasAllowedHost(req: IncomingMessage, allowedHosts: string[]): boolean {
  const host = req.headers.host;
  if (!host || !allowedHosts.includes(host)) return false;

  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!allowedHosts.includes(new URL(origin).host)) return false;
    } catch {
      return false;
    }
  }

  return true;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function createHttpListener(config: Config): Server {
  return createHttpServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];

    // Health check stays outside auth so container probes need no secret.
    if (path === "/health") {
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION }));
      return;
    }

    if (path !== MCP_PATH) {
      jsonRpcError(res, 404, -32601, `Not found. The MCP endpoint is ${MCP_PATH}.`);
      return;
    }

    if (!hasAllowedHost(req, config.allowedHosts)) {
      jsonRpcError(res, 403, -32600, "Host or Origin header is not allowed.");
      return;
    }

    const header = req.headers.authorization ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!config.authToken || !tokensMatch(provided, config.authToken)) {
      if (!res.headersSent) {
        res
          .writeHead(401, {
            "Content-Type": "application/json",
            "WWW-Authenticate": 'Bearer realm="canvas-lms-mcp"',
          })
          .end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32600, message: "Missing or invalid bearer token." },
              id: null,
            }),
          );
      }
      return;
    }

    if (req.method !== "POST") {
      // Stateless mode has no server-initiated stream to attach to, so the
      // GET and DELETE halves of Streamable HTTP do not apply.
      jsonRpcError(res, 405, -32000, "Method not allowed. Use POST.");
      return;
    }

    let body: unknown;
    try {
      body = await readBody(req);
    } catch (err) {
      jsonRpcError(res, 400, -32700, err instanceof Error ? err.message : "Bad request");
      return;
    }

    // Stateless: a fresh server and transport per request, so concurrent
    // clients cannot collide on request ids.
    const server = createServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error("Error handling MCP request:", err);
      jsonRpcError(res, 500, -32603, "Internal server error");
    }
  });
}

export async function startHttpTransport(config: Config): Promise<void> {
  const listener = createHttpListener(config);

  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(config.httpPort, config.httpHost, () => {
      listener.removeListener("error", reject);
      resolve();
    });
  });

  console.error(
    `${SERVER_NAME} ${SERVER_VERSION} listening on http://${config.httpHost}:${config.httpPort}${MCP_PATH}`,
  );
  console.error(`Allowed Host headers: ${config.allowedHosts.join(", ")}`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.error(`Received ${signal}, shutting down.`);
      listener.close(() => process.exit(0));
      // Do not wait forever for lingering keep-alive sockets.
      setTimeout(() => process.exit(0), 5_000).unref();
    });
  }
}
