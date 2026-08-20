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
// stable list to cache and improves prompt-cache hit rates.
const TOOL_GROUPS: ToolGroup[] = [
  courseTools,
  assignmentTools,
  moduleTools,
  pageTools,
  discussionTools,
  quizTools,
  submissionTools,
  fileTools,
  peopleTools,
  userTools,
  calendarTools,
  conversationTools,
  miscTools,
];

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
  for (const group of TOOL_GROUPS) group(server, canvas);

  return server;
}
