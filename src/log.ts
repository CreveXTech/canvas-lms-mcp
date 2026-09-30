import { format } from "node:util";

// Colour regardless of TTY: under Docker stderr is not a terminal, yet
// `docker logs` renders the escapes. NO_COLOR (no-color.org) turns it off.
const useColor = !process.env["NO_COLOR"];

/** Writes to stderr in red, for failures worth spotting in a scrolling log. */
export function logError(...args: unknown[]): void {
  const text = format(...args);
  console.error(useColor ? `\x1b[31m${text}\x1b[0m` : text);
}
