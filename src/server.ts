import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CanvasClient } from "./canvas.js";
import type { Config } from "./config.js";
import { assignmentTools } from "./tools/assignments.js";
import { calendarTools } from "./tools/calendar.js";
import { conversationTools } from "./tools/conversations.js";
import { courseTools } from "./tools/courses.js";
import { discussionTools } from "./tools/discussions.js";
import { fileTools } from "./tools/files.js";
import { miscTools } from "./tools/misc.js";
import { moduleTools } from "./tools/modules.js";
import { pageTools } from "./tools/pages.js";
import { peopleTools } from "./tools/people.js";
import { quizTools } from "./tools/quizzes.js";
import { submissionTools } from "./tools/submissions.js";
import { userTools } from "./tools/user.js";
import type { ToolGroup } from "./tools/common.js";

export const SERVER_NAME = "canvas-lms-mcp";
export const SERVER_VERSION = "2.0.0";

// Registration order is the `tools/list` order. Keeping it fixed gives clients a
// stable list to cache and improves prompt-cache hit rates. The group name is
// what CANVAS_TOOLS / CANVAS_DISABLED_TOOLS match against alongside tool names.
const TOOL_GROUPS: { name: string; register: ToolGroup }[] = [
  { name: "courses", register: courseTools },
  { name: "assignments", register: assignmentTools },
  { name: "modules", register: moduleTools },
  { name: "pages", register: pageTools },
  { name: "discussions", register: discussionTools },
  { name: "quizzes", register: quizTools },
  { name: "submissions", register: submissionTools },
  { name: "files", register: fileTools },
  { name: "people", register: peopleTools },
  { name: "user", register: userTools },
  { name: "calendar", register: calendarTools },
  { name: "conversations", register: conversationTools },
  { name: "misc", register: miscTools },
];

export const TOOL_GROUP_NAMES = TOOL_GROUPS.map((group) => group.name);

export function createServer(config: Config): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      description: "Read-only access to a Canvas LMS account",
    },
    {
      instructions:
        "Read-only access to the authenticated user's Canvas LMS account. " +
        "Course, assignment, module, page and file ids are Canvas numeric ids — " +
        "call the corresponding list_* tool first to discover them. HTML from " +
        "Canvas is returned as plain text.",
    },
  );

  const canvas = new CanvasClient(config);
  const filter = createToolFilter(config);
  const { isEnabled } = filter;
  const registered: string[] = [];

  for (const group of TOOL_GROUPS) {
    const target = isEnabled
      ? gatedServer(server, (tool) => {
          if (!isEnabled(tool, group.name)) return false;
          registered.push(tool);
          return true;
        })
      : server;
    group.register(target, canvas);
  }

  if (isEnabled) {
    if (registered.length === 0) {
      throw new Error(
        "CANVAS_TOOLS / CANVAS_DISABLED_TOOLS leave no tools enabled. " +
          `Group names are: ${TOOL_GROUP_NAMES.join(", ")}.`,
      );
    }
    reportFilterOnce(registered, filter.unusedPatterns());
  }

  return server;
}

interface ToolFilter {
  /** Undefined when no filtering is configured, so every tool registers. */
  isEnabled: ((tool: string, group: string) => boolean) | undefined;
  /** Configured patterns that matched nothing — almost always a typo. */
  unusedPatterns: () => string[];
}

/**
 * Builds the CANVAS_TOOLS / CANVAS_DISABLED_TOOLS predicate. Patterns match a
 * tool name or its group name, and `*` is a wildcard, so `list_*`, `quizzes`
 * and `get_course_progress` are all valid.
 */
function createToolFilter(config: Config): ToolFilter {
  const compile = (patterns: string[]) =>
    patterns.map((pattern) => ({ pattern, regex: globToRegExp(pattern), used: false }));

  const allow = compile(config.enabledTools);
  const deny = compile(config.disabledTools);

  if (allow.length === 0 && deny.length === 0) {
    return { isEnabled: undefined, unusedPatterns: () => [] };
  }

  type Rule = ReturnType<typeof compile>[number];
  const matches = (rules: Rule[], tool: string, group: string): boolean => {
    let matched = false;
    for (const rule of rules) {
      if (rule.regex.test(tool) || rule.regex.test(group)) {
        rule.used = true;
        matched = true;
      }
    }
    return matched;
  };

  return {
    isEnabled: (tool, group) => {
      // Both lists are always tested so an unused pattern is reported even when
      // the other list already excluded everything it would have matched.
      const allowed = allow.length === 0 || matches(allow, tool, group);
      const denied = matches(deny, tool, group);
      return allowed && !denied;
    },
    unusedPatterns: () => [...allow, ...deny].filter((rule) => !rule.used).map((r) => r.pattern),
  };
}

function globToRegExp(pattern: string): RegExp {
  const body = pattern.replace(/[.*+?^${}()|[\]\\]/g, (char) =>
    char === "*" ? ".*" : `\\${char}`,
  );
  return new RegExp(`^${body}$`, "i");
}

/**
 * A view of the server whose `registerTool` drops tools the filter rejects.
 * Tool groups register through `registerReadOnlyTool`, which takes the server
 * itself, so gating here keeps all fourteen group modules unaware of filtering —
 * and a dropped tool never reaches `tools/list`, unlike a client-side deny rule.
 */
function gatedServer(server: McpServer, accept: (tool: string) => boolean): McpServer {
  return new Proxy(server, {
    get(target, prop) {
      if (prop === "registerTool") {
        return (name: string, ...rest: unknown[]) => {
          if (!accept(name)) return undefined;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (target.registerTool as any)(name, ...rest);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value.bind(target) as unknown) : value;
    },
  });
}

let filterReported = false;

/** HTTP transport builds a server per session; the summary is worth one line. */
function reportFilterOnce(registered: string[], unused: string[]): void {
  if (filterReported) return;
  filterReported = true;

  if (unused.length > 0) {
    console.error(`Warning: tool filter patterns matched nothing: ${unused.join(", ")}`);
  }
  console.error(`Tool filter active: ${registered.length} tools registered`);
}
