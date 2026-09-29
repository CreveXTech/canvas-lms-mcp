import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Canvas always emits UTC as `2026-09-29T06:59:59Z`, optionally with millis.
const CANVAS_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Formats a UTC instant as local ISO 8601 with an explicit offset, e.g.
 * `2026-09-28T23:59:59-07:00`. The offset keeps it unambiguous across DST.
 */
function toTimeZone(iso: string, formatter: Intl.DateTimeFormat): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;

  // longOffset yields "GMT-07:00", or bare "GMT" at zero offset.
  const offset = (parts["timeZoneName"] ?? "GMT").replace("GMT", "") || "+00:00";
  return (
    `${parts["year"]}-${parts["month"]}-${parts["day"]}` +
    `T${parts["hour"]}:${parts["minute"]}:${parts["second"]}${offset}`
  );
}

function localFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "longOffset",
  });
}

/** Throws a RangeError for a name that is not an IANA time zone. */
export function assertTimeZone(timeZone: string): void {
  localFormatter(timeZone);
}

/**
 * Builds the pass every tool result goes through: null fields are dropped —
 * output schemas mark them all nullish, so absence and null mean the same and
 * the nulls only cost tokens — and Canvas UTC timestamps are shifted into
 * `timeZone` when one is configured.
 */
export function createOutputFormatter(timeZone: string | undefined) {
  const formatter = timeZone ? localFormatter(timeZone) : undefined;

  const format = (value: unknown): unknown => {
    if (typeof value === "string") {
      return formatter && CANVAS_UTC_TIMESTAMP.test(value)
        ? toTimeZone(value, formatter)
        : value;
    }
    if (Array.isArray(value)) return value.map(format);
    if (value && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(value)) {
        if (field !== null && field !== undefined) result[key] = format(field);
      }
      return result;
    }
    return value;
  };

  return format;
}

interface ToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * A view of the server whose tool callbacks run their result through `format`,
 * keeping the JSON text block in step with `structuredContent`. Error results
 * pass through untouched.
 */
export function formattedServer(
  server: McpServer,
  format: (value: unknown) => unknown,
): McpServer {
  return new Proxy(server, {
    get(target, prop) {
      if (prop === "registerTool") {
        return (name: string, config: unknown, callback: (...a: unknown[]) => unknown) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (target.registerTool as any)(name, config, async (...args: unknown[]) => {
            const result = (await callback(...args)) as ToolResult;
            if (result.isError || !result.structuredContent) return result;
            const structured = format(result.structuredContent) as Record<string, unknown>;
            return {
              ...result,
              content: [{ type: "text", text: JSON.stringify(structured) }],
              structuredContent: structured,
            };
          });
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value.bind(target) as unknown) : value;
    },
  });
}
