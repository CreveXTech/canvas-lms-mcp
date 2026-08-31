import { existsSync } from "node:fs";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { startHttpTransport } from "./http.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

/**
 * Loads a project-root `.env` when one exists, so a locally spawned server needs
 * no wrapper script. Uses Node's built-in loader rather than a dependency, and
 * never overrides variables the environment already set — which is what lets the
 * container ignore it entirely.
 */
function loadDotEnv(): void {
  const envPath = join(import.meta.dirname, "..", ".env");
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    console.error(
      `Warning: could not read ${envPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();

  if (config.transport === "http") {
    await startHttpTransport(config);
    return;
  }

  const server = createServer(config);
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol; all logging goes to stderr.
  console.error(`${SERVER_NAME} ${SERVER_VERSION} running on stdio`);
}

main().catch((err: unknown) => {
  console.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
