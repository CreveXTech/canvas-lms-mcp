import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env") });
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3";

const CANVAS_BASE_URL =
  process.env.CANVAS_BASE_URL ?? "https://canvas.instructure.com/api/v1";
const CANVAS_API_TOKEN = process.env.CANVAS_API_TOKEN;

if (!CANVAS_API_TOKEN) {
  console.error("Error: CANVAS_API_TOKEN environment variable is not set.");
  process.exit(1);
}

const PER_PAGE_DEFAULT = 50;
const PER_PAGE_ANNOUNCEMENTS = 20;
const FETCH_TIMEOUT_MS = 10000;

async function canvasFetch(path: string): Promise<unknown> {
  const url = `${CANVAS_BASE_URL}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${CANVAS_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      // ignore
    }
    throw new Error(
      `Canvas API request failed: ${response.status} ${response.statusText} for ${url}${body ? ` — ${body}` : ""}`,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`Canvas API returned invalid JSON for path: ${path}`);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMediaUrls(html: string): string[] {
  const urls: string[] = [];
  // iframes (Kaltura, Panopto, YouTube, etc.)
  const iframeSrc = html.matchAll(/\biframe\b[^>]*\bsrc=["']([^"']+)["']/gi);
  for (const m of iframeSrc) urls.push(m[1]);
  // <a> href links to media
  const anchors = html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi);
  for (const m of anchors) urls.push(m[1]);
  return [...new Set(urls)];
}

function mcpText(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data),
      },
    ],
  };
}

const courseIdSchema = z.string().regex(/^\d+$/, "course_id must be numeric").describe("The Canvas course ID");
const assignmentIdSchema = z.string().regex(/^\d+$/, "assignment_id must be numeric").describe("The Canvas assignment ID");

const server = new McpServer({
  name: "canvas-lms-mcp",
  version: "1.0.0",
});

server.registerTool(
  "list_courses",
  {
    description:
      "List all active enrolled courses with id, name, and course_code",
  },
  async () => {
    const courses = (await canvasFetch(
      `/courses?enrollment_state=active&per_page=${PER_PAGE_DEFAULT}`
    )) as Array<{
      id: number;
      name: string;
      course_code: string;
    }>;

    const result = courses.map((c) => ({
      id: c.id,
      name: c.name,
      course_code: c.course_code,
    }));

    return mcpText(result);
  }
);

server.registerTool(
  "list_assignments",
  {
    description:
      "List assignments for a course with id, name, due_at, points_possible, and description",
    inputSchema: {
      course_id: courseIdSchema,
    },
  },
  async ({ course_id }) => {
    const assignments = (await canvasFetch(
      `/courses/${course_id}/assignments?per_page=${PER_PAGE_DEFAULT}`
    )) as Array<{
      id: number;
      name: string;
      due_at: string | null;
      points_possible: number | null;
      description: string | null;
    }>;

    const result = assignments.map((a) => ({
      id: a.id,
      name: a.name,
      due_at: a.due_at,
      points_possible: a.points_possible,
      description: a.description ? stripHtml(a.description) : a.description,
    }));

    return mcpText(result);
  }
);

server.registerTool(
  "list_announcements",
  {
    description: "List recent announcements for a course",
    inputSchema: {
      course_id: courseIdSchema,
    },
  },
  async ({ course_id }) => {
    const announcements = (await canvasFetch(
      `/courses/${course_id}/discussion_topics?only_announcements=true&per_page=${PER_PAGE_ANNOUNCEMENTS}`
    )) as Array<{
      id: number;
      title: string;
      message: string | null;
      posted_at: string | null;
      author: { display_name?: string } | null;
    }>;

    const result = announcements.map((a) => ({
      id: a.id,
      title: a.title,
      message: a.message ? stripHtml(a.message) : a.message,
      posted_at: a.posted_at,
      author: a.author?.display_name ?? null,
    }));

    return mcpText(result);
  }
);

server.registerTool(
  "get_grades",
  {
    description: "Get current grades and scores for a course",
    inputSchema: {
      course_id: courseIdSchema,
    },
  },
  async ({ course_id }) => {
    const enrollments = (await canvasFetch(
      `/courses/${course_id}/enrollments?user_id=self`,
    )) as Array<{
      id: number;
      type: string;
      enrollment_state: string;
      grades: {
        current_grade: string | null;
        current_score: number | null;
        final_grade: string | null;
        final_score: number | null;
      } | null;
      course_id: number;
    }>;

    const result = enrollments.map((e) => ({
      id: e.id,
      type: e.type,
      enrollment_state: e.enrollment_state,
      course_id: e.course_id,
      current_grade: e.grades?.current_grade ?? null,
      current_score: e.grades?.current_score ?? null,
      final_grade: e.grades?.final_grade ?? null,
      final_score: e.grades?.final_score ?? null,
    }));

    return mcpText(result);
  }
);

server.registerTool(
  "list_files",
  {
    description: "List course files with name, url, and content-type",
    inputSchema: {
      course_id: courseIdSchema,
    },
  },
  async ({ course_id }) => {
    const files = (await canvasFetch(
      `/courses/${course_id}/files?per_page=${PER_PAGE_DEFAULT}`
    )) as Array<{
      id: number;
      display_name: string;
      filename: string;
      url: string;
      "content-type": string;
      size: number;
      updated_at: string | null;
    }>;

    const result = files.map((f) => ({
      id: f.id,
      name: f.display_name,
      filename: f.filename,
      url: f.url,
      content_type: f["content-type"],
      size: f.size,
      updated_at: f.updated_at,
    }));

    return mcpText(result);
  }
);

server.registerTool(
  "get_assignment_details",
  {
    description: "Get full details and rubric for a specific assignment",
    inputSchema: {
      course_id: courseIdSchema,
      assignment_id: assignmentIdSchema,
    },
  },
  async ({ course_id, assignment_id }) => {
    const assignment = (await canvasFetch(
      `/courses/${course_id}/assignments/${assignment_id}`,
    )) as {
      id: number;
      name: string;
      description: string | null;
      due_at: string | null;
      points_possible: number | null;
      submission_types: string[];
      allowed_attempts: number | null;
      grading_type: string;
      html_url: string;
      rubric?: Array<{
        id: string;
        description: string;
        long_description: string | null;
        points: number;
        ratings: Array<{
          id: string;
          description: string;
          long_description: string | null;
          points: number;
        }>;
      }>;
      rubric_settings?: {
        id: number;
        title: string;
        points_possible: number;
        free_form_criterion_comments: boolean;
      };
    };

    const result = {
      id: assignment.id,
      name: assignment.name,
      description: assignment.description
        ? stripHtml(assignment.description)
        : assignment.description,
      due_at: assignment.due_at,
      points_possible: assignment.points_possible,
      submission_types: assignment.submission_types,
      allowed_attempts: assignment.allowed_attempts,
      grading_type: assignment.grading_type,
      html_url: assignment.html_url,
      rubric: assignment.rubric
        ? assignment.rubric.map((criterion) => ({
            ...criterion,
            description: stripHtml(criterion.description),
            long_description: criterion.long_description
              ? stripHtml(criterion.long_description)
              : criterion.long_description,
          }))
        : null,
      rubric_settings: assignment.rubric_settings ?? null,
    };

    return mcpText(result);
  }
);

server.registerTool(
  "list_modules",
  {
    description: "List all modules for a course with id, name, and position",
    inputSchema: {
      course_id: courseIdSchema,
    },
  },
  async ({ course_id }) => {
    const modules = (await canvasFetch(
      `/courses/${course_id}/modules?per_page=${PER_PAGE_DEFAULT}`,
    )) as Array<{
      id: number;
      name: string;
      position: number;
      items_count: number;
      state: string | null;
      completed_at: string | null;
      prerequisite_module_ids: number[];
    }>;

    const result = modules.map((m) => ({
      id: m.id,
      name: m.name,
      position: m.position,
      items_count: m.items_count,
      state: m.state,
      completed_at: m.completed_at,
      prerequisite_module_ids: m.prerequisite_module_ids,
    }));

    return mcpText(result);
  },
);

server.registerTool(
  "get_module",
  {
    description:
      "Get all items in a module and fetch full content for page-type items (body text, assignments, etc.)",
    inputSchema: {
      course_id: courseIdSchema,
      module_id: z.string().regex(/^\d+$/, "module_id must be numeric").describe("The Canvas module ID"),
    },
  },
  async ({ course_id, module_id }) => {
    const items = (await canvasFetch(
      `/courses/${course_id}/modules/${module_id}/items?per_page=100`,
    )) as Array<{
      id: number;
      title: string;
      type: string;
      position: number;
      indent: number;
      html_url: string | null;
      url: string | null;
      page_url: string | null;
      content_id: number | null;
      completion_requirement: { type: string; completed: boolean } | null;
    }>;

    const enriched = await Promise.all(
      items.map(async (item) => {
        const base = {
          id: item.id,
          title: item.title,
          type: item.type,
          position: item.position,
          indent: item.indent,
          html_url: item.html_url,
          content_id: item.content_id,
          completion_requirement: item.completion_requirement,
          content: null as string | null,
          media_urls: [] as string[],
        };

        try {
          if (item.type === "Page" && item.page_url) {
            const page = (await canvasFetch(
              `/courses/${course_id}/pages/${item.page_url}`,
            )) as { body: string | null; title: string };
            base.content = page.body ? stripHtml(page.body) : null;
            base.media_urls = page.body ? extractMediaUrls(page.body) : [];
          } else if (item.type === "Assignment" && item.content_id) {
            const assignment = (await canvasFetch(
              `/courses/${course_id}/assignments/${item.content_id}`,
            )) as {
              description: string | null;
              due_at: string | null;
              points_possible: number | null;
            };
            base.content = assignment.description
              ? stripHtml(assignment.description)
              : null;
          } else if (item.type === "Discussion" && item.content_id) {
            const topic = (await canvasFetch(
              `/courses/${course_id}/discussion_topics/${item.content_id}`,
            )) as { message: string | null };
            base.content = topic.message ? stripHtml(topic.message) : null;
          } else if (item.type === "Quiz" && item.content_id) {
            const quiz = (await canvasFetch(
              `/courses/${course_id}/quizzes/${item.content_id}`,
            )) as { description: string | null };
            base.content = quiz.description
              ? stripHtml(quiz.description)
              : null;
          } else if (item.url) {
            const data = (await canvasFetch(
              item.url.replace(/^.*\/api\/v1/, ""),
            )) as Record<string, unknown>;
            if (typeof data["body"] === "string")
              base.content = stripHtml(data["body"]);
            else if (typeof data["message"] === "string")
              base.content = stripHtml(data["message"]);
            else if (typeof data["description"] === "string")
              base.content = stripHtml(data["description"] as string);
          }
        } catch {
          // If content fetch fails, leave content null
        }

        return base;
      }),
    );

    return mcpText(enriched);
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Canvas LMS MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
