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
const moduleIdSchema = z.string().regex(/^\d+$/, "module_id must be numeric").describe("The Canvas module ID");
const discussionIdSchema = z.string().regex(/^\d+$/, "topic_id must be numeric").describe("The Canvas discussion topic ID");
const quizIdSchema = z.string().regex(/^\d+$/, "quiz_id must be numeric").describe("The Canvas quiz ID");
const folderIdSchema = z.string().regex(/^\d+$/, "folder_id must be numeric").describe("The Canvas folder ID");
const conversationIdSchema = z.string().regex(/^\d+$/, "conversation_id must be numeric").describe("The Canvas conversation ID");
const userIdSchema = z.string().describe("The Canvas user ID or 'self'");

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

// --- Course ---

server.registerTool(
  "get_course",
  {
    description: "Get full details for a course including syllabus body, start/end dates, and settings",
    inputSchema: { course_id: courseIdSchema },
  },
  async ({ course_id }) => {
    const course = (await canvasFetch(
      `/courses/${course_id}?include[]=syllabus_body&include[]=total_scores&include[]=term`,
    )) as {
      id: number;
      name: string;
      course_code: string;
      start_at: string | null;
      end_at: string | null;
      time_zone: string | null;
      syllabus_body: string | null;
      default_view: string | null;
      term: { id: number; name: string; start_at: string | null; end_at: string | null } | null;
    };

    return mcpText({
      id: course.id,
      name: course.name,
      course_code: course.course_code,
      start_at: course.start_at,
      end_at: course.end_at,
      time_zone: course.time_zone,
      default_view: course.default_view,
      term: course.term,
      syllabus: course.syllabus_body ? stripHtml(course.syllabus_body) : null,
    });
  },
);

// --- User ---

server.registerTool(
  "get_user_profile",
  {
    description: "Get the current user's profile (name, email, bio, avatar)",
  },
  async () => {
    const profile = (await canvasFetch("/users/self/profile")) as {
      id: number;
      name: string;
      short_name: string;
      login_id: string;
      primary_email: string | null;
      bio: string | null;
      avatar_url: string | null;
      time_zone: string | null;
    };
    return mcpText(profile);
  },
);

server.registerTool(
  "get_todo",
  {
    description: "Get the current user's upcoming to-do items (assignments to submit, quizzes to take, etc.)",
  },
  async () => {
    const items = (await canvasFetch(
      `/users/self/todo?per_page=${PER_PAGE_DEFAULT}`,
    )) as Array<{
      type: string;
      ignore: string;
      ignore_permanently: string;
      html_url: string | null;
      needs_grading_count?: number;
      context_type: string;
      course_id: number | null;
      assignment?: {
        id: number;
        name: string;
        due_at: string | null;
        points_possible: number | null;
        submission_types: string[];
      };
    }>;

    const result = items.map((i) => ({
      type: i.type,
      context_type: i.context_type,
      course_id: i.course_id,
      html_url: i.html_url,
      needs_grading_count: i.needs_grading_count ?? null,
      assignment: i.assignment
        ? {
            id: i.assignment.id,
            name: i.assignment.name,
            due_at: i.assignment.due_at,
            points_possible: i.assignment.points_possible,
            submission_types: i.assignment.submission_types,
          }
        : null,
    }));

    return mcpText(result);
  },
);

server.registerTool(
  "get_activity_stream",
  {
    description: "Get the current user's recent activity stream (submissions, announcements, discussions, etc.)",
  },
  async () => {
    const items = (await canvasFetch(
      `/users/self/activity_stream?per_page=${PER_PAGE_DEFAULT}`,
    )) as Array<{
      id: number;
      title: string | null;
      message: string | null;
      type: string;
      read_state: boolean;
      created_at: string;
      updated_at: string;
      course_id: number | null;
      html_url: string | null;
    }>;

    const result = items.map((i) => ({
      id: i.id,
      type: i.type,
      title: i.title,
      message: i.message ? stripHtml(i.message) : null,
      read_state: i.read_state,
      created_at: i.created_at,
      updated_at: i.updated_at,
      course_id: i.course_id,
      html_url: i.html_url,
    }));

    return mcpText(result);
  },
);

// --- Calendar ---

server.registerTool(
  "list_calendar_events",
  {
    description: "List upcoming calendar events and assignment due dates for the current user",
    inputSchema: {
      start_date: z.string().optional().describe("ISO 8601 start date filter (e.g. 2024-01-01)"),
      end_date: z.string().optional().describe("ISO 8601 end date filter (e.g. 2024-12-31)"),
      context_codes: z.string().optional().describe("Comma-separated context codes to filter by (e.g. course_123,course_456)"),
    },
  },
  async ({ start_date, end_date, context_codes }) => {
    const params = new URLSearchParams({ per_page: String(PER_PAGE_DEFAULT), type: "event" });
    if (start_date) params.set("start_date", start_date);
    if (end_date) params.set("end_date", end_date);
    if (context_codes) {
      for (const code of context_codes.split(",")) params.append("context_codes[]", code.trim());
    }

    // Fetch both events and assignment due-dates
    const eventsParams = new URLSearchParams(params);
    eventsParams.set("type", "event");
    const assignmentParams = new URLSearchParams(params);
    assignmentParams.set("type", "assignment");

    const [events, assignments] = await Promise.all([
      canvasFetch(`/calendar_events?${eventsParams}`) as Promise<Array<{
        id: number; title: string; start_at: string | null; end_at: string | null;
        description: string | null; html_url: string | null; context_code: string;
      }>>,
      canvasFetch(`/calendar_events?${assignmentParams}`) as Promise<Array<{
        id: number; title: string; start_at: string | null; end_at: string | null;
        description: string | null; html_url: string | null; context_code: string;
        assignment?: { id: number; points_possible: number | null };
      }>>,
    ]);

    const mapEvent = (e: typeof events[0], type: string) => ({
      id: e.id,
      type,
      title: e.title,
      start_at: e.start_at,
      end_at: e.end_at,
      description: e.description ? stripHtml(e.description) : null,
      html_url: e.html_url,
      context_code: e.context_code,
    });

    return mcpText([
      ...events.map((e) => mapEvent(e, "event")),
      ...assignments.map((e) => ({ ...mapEvent(e, "assignment"), assignment_id: (e as typeof assignments[0]).assignment?.id ?? null })),
    ].sort((a, b) => (a.start_at ?? "").localeCompare(b.start_at ?? "")));
  },
);

// --- Pages ---

server.registerTool(
  "list_pages",
  {
    description: "List pages (wiki pages) in a course",
    inputSchema: { course_id: courseIdSchema },
  },
  async ({ course_id }) => {
    const pages = (await canvasFetch(
      `/courses/${course_id}/pages?per_page=${PER_PAGE_DEFAULT}&sort=title`,
    )) as Array<{
      page_id: number;
      url: string;
      title: string;
      updated_at: string | null;
      published: boolean;
      front_page: boolean;
    }>;

    return mcpText(pages.map((p) => ({
      id: p.page_id,
      url: p.url,
      title: p.title,
      updated_at: p.updated_at,
      published: p.published,
      front_page: p.front_page,
    })));
  },
);

server.registerTool(
  "get_page",
  {
    description: "Get the full content of a course page by its URL slug",
    inputSchema: {
      course_id: courseIdSchema,
      page_url: z.string().describe("The page URL slug (from list_pages)"),
    },
  },
  async ({ course_id, page_url }) => {
    const page = (await canvasFetch(`/courses/${course_id}/pages/${page_url}`)) as {
      page_id: number;
      url: string;
      title: string;
      updated_at: string | null;
      body: string | null;
      published: boolean;
      front_page: boolean;
    };

    return mcpText({
      id: page.page_id,
      url: page.url,
      title: page.title,
      updated_at: page.updated_at,
      published: page.published,
      front_page: page.front_page,
      content: page.body ? stripHtml(page.body) : null,
      media_urls: page.body ? extractMediaUrls(page.body) : [],
    });
  },
);

// --- Discussions ---

server.registerTool(
  "list_discussions",
  {
    description: "List discussion topics for a course (excludes announcements)",
    inputSchema: { course_id: courseIdSchema },
  },
  async ({ course_id }) => {
    const topics = (await canvasFetch(
      `/courses/${course_id}/discussion_topics?per_page=${PER_PAGE_DEFAULT}&exclude_announcements=true`,
    )) as Array<{
      id: number;
      title: string;
      message: string | null;
      posted_at: string | null;
      author: { display_name?: string } | null;
      discussion_type: string;
      assignment_id: number | null;
      due_at: string | null;
      replies_count: number;
      unread_count: number;
    }>;

    return mcpText(topics.map((t) => ({
      id: t.id,
      title: t.title,
      message: t.message ? stripHtml(t.message) : null,
      posted_at: t.posted_at,
      author: t.author?.display_name ?? null,
      discussion_type: t.discussion_type,
      assignment_id: t.assignment_id,
      due_at: t.due_at,
      replies_count: t.replies_count,
      unread_count: t.unread_count,
    })));
  },
);

server.registerTool(
  "get_discussion",
  {
    description: "Get a discussion topic with its top-level entries and replies",
    inputSchema: {
      course_id: courseIdSchema,
      topic_id: discussionIdSchema,
    },
  },
  async ({ course_id, topic_id }) => {
    const [topic, entries] = await Promise.all([
      canvasFetch(`/courses/${course_id}/discussion_topics/${topic_id}`) as Promise<{
        id: number; title: string; message: string | null; posted_at: string | null;
        author: { display_name?: string } | null; assignment_id: number | null;
        due_at: string | null; replies_count: number;
      }>,
      canvasFetch(`/courses/${course_id}/discussion_topics/${topic_id}/entries?per_page=50`) as Promise<Array<{
        id: number; user_id: number; user_name: string; message: string | null;
        created_at: string; recent_replies?: Array<{
          id: number; user_id: number; user_name: string; message: string | null; created_at: string;
        }>;
      }>>,
    ]);

    return mcpText({
      id: topic.id,
      title: topic.title,
      message: topic.message ? stripHtml(topic.message) : null,
      posted_at: topic.posted_at,
      author: topic.author?.display_name ?? null,
      assignment_id: topic.assignment_id,
      due_at: topic.due_at,
      replies_count: topic.replies_count,
      entries: entries.map((e) => ({
        id: e.id,
        user_name: e.user_name,
        message: e.message ? stripHtml(e.message) : null,
        created_at: e.created_at,
        replies: (e.recent_replies ?? []).map((r) => ({
          id: r.id,
          user_name: r.user_name,
          message: r.message ? stripHtml(r.message) : null,
          created_at: r.created_at,
        })),
      })),
    });
  },
);

// --- Quizzes ---

server.registerTool(
  "list_quizzes",
  {
    description: "List quizzes for a course",
    inputSchema: { course_id: courseIdSchema },
  },
  async ({ course_id }) => {
    const quizzes = (await canvasFetch(
      `/courses/${course_id}/quizzes?per_page=${PER_PAGE_DEFAULT}`,
    )) as Array<{
      id: number;
      title: string;
      due_at: string | null;
      lock_at: string | null;
      unlock_at: string | null;
      points_possible: number | null;
      quiz_type: string;
      time_limit: number | null;
      allowed_attempts: number | null;
      question_count: number;
      published: boolean;
      html_url: string;
    }>;

    return mcpText(quizzes.map((q) => ({
      id: q.id,
      title: q.title,
      due_at: q.due_at,
      lock_at: q.lock_at,
      unlock_at: q.unlock_at,
      points_possible: q.points_possible,
      quiz_type: q.quiz_type,
      time_limit: q.time_limit,
      allowed_attempts: q.allowed_attempts,
      question_count: q.question_count,
      published: q.published,
      html_url: q.html_url,
    })));
  },
);

server.registerTool(
  "get_quiz",
  {
    description: "Get full details for a quiz including description and questions (if available)",
    inputSchema: {
      course_id: courseIdSchema,
      quiz_id: quizIdSchema,
    },
  },
  async ({ course_id, quiz_id }) => {
    const quiz = (await canvasFetch(`/courses/${course_id}/quizzes/${quiz_id}`)) as {
      id: number;
      title: string;
      description: string | null;
      due_at: string | null;
      lock_at: string | null;
      unlock_at: string | null;
      points_possible: number | null;
      quiz_type: string;
      time_limit: number | null;
      allowed_attempts: number | null;
      question_count: number;
      show_correct_answers: boolean;
      published: boolean;
      html_url: string;
    };

    // Attempt to fetch questions (may be restricted before unlock)
    let questions: Array<{ id: number; question_name: string; question_type: string; points_possible: number; question_text: string | null }> = [];
    try {
      questions = (await canvasFetch(
        `/courses/${course_id}/quizzes/${quiz_id}/questions?per_page=100`,
      )) as typeof questions;
    } catch {
      // questions unavailable (locked or insufficient permissions)
    }

    return mcpText({
      id: quiz.id,
      title: quiz.title,
      description: quiz.description ? stripHtml(quiz.description) : null,
      due_at: quiz.due_at,
      lock_at: quiz.lock_at,
      unlock_at: quiz.unlock_at,
      points_possible: quiz.points_possible,
      quiz_type: quiz.quiz_type,
      time_limit: quiz.time_limit,
      allowed_attempts: quiz.allowed_attempts,
      question_count: quiz.question_count,
      show_correct_answers: quiz.show_correct_answers,
      published: quiz.published,
      html_url: quiz.html_url,
      questions: questions.map((q) => ({
        id: q.id,
        name: q.question_name,
        type: q.question_type,
        points: q.points_possible,
        text: q.question_text ? stripHtml(q.question_text) : null,
      })),
    });
  },
);

// --- Submissions ---

server.registerTool(
  "get_submission",
  {
    description: "Get the current user's submission for an assignment, including grade, feedback, and attachments",
    inputSchema: {
      course_id: courseIdSchema,
      assignment_id: assignmentIdSchema,
    },
  },
  async ({ course_id, assignment_id }) => {
    const sub = (await canvasFetch(
      `/courses/${course_id}/assignments/${assignment_id}/submissions/self?include[]=comments&include[]=rubric_assessment`,
    )) as {
      id: number;
      assignment_id: number;
      user_id: number;
      score: number | null;
      grade: string | null;
      submitted_at: string | null;
      workflow_state: string;
      late: boolean;
      missing: boolean;
      excused: boolean | null;
      attempt: number | null;
      body: string | null;
      url: string | null;
      attachments?: Array<{ id: number; display_name: string; url: string; "content-type": string; size: number }>;
      submission_comments?: Array<{ id: number; author_name: string; comment: string; created_at: string }>;
      rubric_assessment?: Record<string, { points: number | null; comments: string | null }>;
    };

    return mcpText({
      id: sub.id,
      assignment_id: sub.assignment_id,
      score: sub.score,
      grade: sub.grade,
      submitted_at: sub.submitted_at,
      workflow_state: sub.workflow_state,
      late: sub.late,
      missing: sub.missing,
      excused: sub.excused,
      attempt: sub.attempt,
      body: sub.body ? stripHtml(sub.body) : null,
      url: sub.url,
      attachments: (sub.attachments ?? []).map((a) => ({
        id: a.id,
        name: a.display_name,
        url: a.url,
        content_type: a["content-type"],
        size: a.size,
      })),
      comments: (sub.submission_comments ?? []).map((c) => ({
        id: c.id,
        author: c.author_name,
        comment: c.comment,
        created_at: c.created_at,
      })),
      rubric_assessment: sub.rubric_assessment ?? null,
    });
  },
);

server.registerTool(
  "list_submissions",
  {
    description: "List all of the current user's submissions for a course with grades and submission states",
    inputSchema: { course_id: courseIdSchema },
  },
  async ({ course_id }) => {
    const subs = (await canvasFetch(
      `/courses/${course_id}/students/submissions?student_ids[]=self&per_page=${PER_PAGE_DEFAULT}`,
    )) as Array<{
      id: number;
      assignment_id: number;
      score: number | null;
      grade: string | null;
      submitted_at: string | null;
      workflow_state: string;
      late: boolean;
      missing: boolean;
      excused: boolean | null;
      attempt: number | null;
    }>;

    return mcpText(subs.map((s) => ({
      id: s.id,
      assignment_id: s.assignment_id,
      score: s.score,
      grade: s.grade,
      submitted_at: s.submitted_at,
      workflow_state: s.workflow_state,
      late: s.late,
      missing: s.missing,
      excused: s.excused,
      attempt: s.attempt,
    })));
  },
);

// --- Assignment Groups ---

server.registerTool(
  "list_assignment_groups",
  {
    description: "List assignment groups for a course with weights and assignments",
    inputSchema: { course_id: courseIdSchema },
  },
  async ({ course_id }) => {
    const groups = (await canvasFetch(
      `/courses/${course_id}/assignment_groups?include[]=assignments&per_page=${PER_PAGE_DEFAULT}`,
    )) as Array<{
      id: number;
      name: string;
      position: number;
      group_weight: number | null;
      assignments?: Array<{
        id: number;
        name: string;
        due_at: string | null;
        points_possible: number | null;
        omit_from_final_grade: boolean;
      }>;
    }>;

    return mcpText(groups.map((g) => ({
      id: g.id,
      name: g.name,
      position: g.position,
      weight: g.group_weight,
      assignments: (g.assignments ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        due_at: a.due_at,
        points_possible: a.points_possible,
        omit_from_final_grade: a.omit_from_final_grade,
      })),
    })));
  },
);

// --- Users/Roster ---

server.registerTool(
  "list_course_users",
  {
    description: "List enrolled users in a course (roster)",
    inputSchema: {
      course_id: courseIdSchema,
      enrollment_type: z.enum(["student", "teacher", "ta", "observer", "designer"]).optional().describe("Filter by enrollment type"),
    },
  },
  async ({ course_id, enrollment_type }) => {
    const params = new URLSearchParams({ per_page: String(PER_PAGE_DEFAULT) });
    if (enrollment_type) params.set("enrollment_type[]", enrollment_type);

    const users = (await canvasFetch(`/courses/${course_id}/users?${params}`)) as Array<{
      id: number;
      name: string;
      short_name: string;
      login_id: string | null;
      email: string | null;
      avatar_url: string | null;
      enrollments?: Array<{ type: string; enrollment_state: string }>;
    }>;

    return mcpText(users.map((u) => ({
      id: u.id,
      name: u.name,
      short_name: u.short_name,
      login_id: u.login_id,
    })));
  },
);

// --- Files & Folders ---

server.registerTool(
  "list_folders",
  {
    description: "List folders in a course's file system",
    inputSchema: { course_id: courseIdSchema },
  },
  async ({ course_id }) => {
    const folders = (await canvasFetch(
      `/courses/${course_id}/folders?per_page=${PER_PAGE_DEFAULT}`,
    )) as Array<{
      id: number;
      name: string;
      full_name: string;
      files_count: number;
      folders_count: number;
      parent_folder_id: number | null;
      created_at: string;
      updated_at: string;
    }>;

    return mcpText(folders.map((f) => ({
      id: f.id,
      name: f.name,
      full_name: f.full_name,
      files_count: f.files_count,
      folders_count: f.folders_count,
      parent_folder_id: f.parent_folder_id,
    })));
  },
);

server.registerTool(
  "get_folder_files",
  {
    description: "List files inside a specific folder",
    inputSchema: { folder_id: folderIdSchema },
  },
  async ({ folder_id }) => {
    const files = (await canvasFetch(
      `/folders/${folder_id}/files?per_page=${PER_PAGE_DEFAULT}`,
    )) as Array<{
      id: number;
      display_name: string;
      filename: string;
      url: string;
      "content-type": string;
      size: number;
      updated_at: string | null;
      folder_id: number;
    }>;

    return mcpText(files.map((f) => ({
      id: f.id,
      name: f.display_name,
      filename: f.filename,
      url: f.url,
      content_type: f["content-type"],
      size: f.size,
      updated_at: f.updated_at,
      folder_id: f.folder_id,
    })));
  },
);

// --- Conversations (Inbox) ---

server.registerTool(
  "list_conversations",
  {
    description: "List conversations (inbox messages) for the current user",
    inputSchema: {
      scope: z.enum(["inbox", "unread", "starred", "sent", "archived"]).optional().describe("Filter conversations by scope (default: inbox)"),
    },
  },
  async ({ scope }) => {
    const params = new URLSearchParams({ per_page: String(PER_PAGE_DEFAULT) });
    if (scope) params.set("scope", scope);

    const convos = (await canvasFetch(`/conversations?${params}`)) as Array<{
      id: number;
      subject: string | null;
      workflow_state: string;
      last_message: string | null;
      last_message_at: string | null;
      message_count: number;
      subscribed: boolean;
      starred: boolean;
      participants: Array<{ id: number; name: string }>;
      context_name: string | null;
    }>;

    return mcpText(convos.map((c) => ({
      id: c.id,
      subject: c.subject,
      workflow_state: c.workflow_state,
      last_message: c.last_message,
      last_message_at: c.last_message_at,
      message_count: c.message_count,
      subscribed: c.subscribed,
      starred: c.starred,
      participants: c.participants.map((p) => ({ id: p.id, name: p.name })),
      context_name: c.context_name,
    })));
  },
);

server.registerTool(
  "get_conversation",
  {
    description: "Get a conversation thread with all messages",
    inputSchema: { conversation_id: conversationIdSchema },
  },
  async ({ conversation_id }) => {
    const convo = (await canvasFetch(`/conversations/${conversation_id}`)) as {
      id: number;
      subject: string | null;
      workflow_state: string;
      participants: Array<{ id: number; name: string }>;
      context_name: string | null;
      messages: Array<{
        id: number;
        created_at: string;
        body: string;
        author_id: number;
        forwarded_messages?: unknown[];
        attachments?: Array<{ id: number; display_name: string; url: string }>;
      }>;
    };

    return mcpText({
      id: convo.id,
      subject: convo.subject,
      workflow_state: convo.workflow_state,
      context_name: convo.context_name,
      participants: convo.participants,
      messages: convo.messages.map((m) => ({
        id: m.id,
        created_at: m.created_at,
        author_id: m.author_id,
        body: m.body,
        attachments: (m.attachments ?? []).map((a) => ({
          id: a.id,
          name: a.display_name,
          url: a.url,
        })),
      })),
    });
  },
);

// --- Rubrics ---

server.registerTool(
  "list_rubrics",
  {
    description: "List rubrics available in a course",
    inputSchema: { course_id: courseIdSchema },
  },
  async ({ course_id }) => {
    const rubrics = (await canvasFetch(
      `/courses/${course_id}/rubrics?per_page=${PER_PAGE_DEFAULT}`,
    )) as Array<{
      id: number;
      title: string;
      points_possible: number;
      reusable: boolean;
      free_form_criterion_comments: boolean;
      data: Array<{
        id: string;
        description: string;
        long_description: string | null;
        points: number;
        ratings: Array<{ id: string; description: string; points: number }>;
      }>;
    }>;

    return mcpText(rubrics.map((r) => ({
      id: r.id,
      title: r.title,
      points_possible: r.points_possible,
      reusable: r.reusable,
      criteria: (r.data ?? []).map((c) => ({
        id: c.id,
        description: c.description,
        long_description: c.long_description,
        points: c.points,
        ratings: c.ratings.map((rt) => ({ id: rt.id, description: rt.description, points: rt.points })),
      })),
    })));
  },
);

// --- Enrollments ---

server.registerTool(
  "list_enrollments",
  {
    description: "List enrollments for a course (students, teachers, etc.) with grade data",
    inputSchema: {
      course_id: courseIdSchema,
      enrollment_type: z.enum(["StudentEnrollment", "TeacherEnrollment", "TaEnrollment", "DesignerEnrollment", "ObserverEnrollment"]).optional().describe("Filter by enrollment type"),
    },
  },
  async ({ course_id, enrollment_type }) => {
    const params = new URLSearchParams({ per_page: String(PER_PAGE_DEFAULT), include: "avatar_url" });
    if (enrollment_type) params.set("type[]", enrollment_type);

    const enrollments = (await canvasFetch(`/courses/${course_id}/enrollments?${params}`)) as Array<{
      id: number;
      user_id: number;
      type: string;
      enrollment_state: string;
      user: { id: number; name: string; short_name: string; login_id: string | null };
      grades?: { current_score: number | null; final_score: number | null; current_grade: string | null; final_grade: string | null };
      course_section_id: number | null;
    }>;

    return mcpText(enrollments.map((e) => ({
      id: e.id,
      user_id: e.user_id,
      type: e.type,
      enrollment_state: e.enrollment_state,
      course_section_id: e.course_section_id,
      user: { id: e.user.id, name: e.user.name, login_id: e.user.login_id },
      grades: e.grades ?? null,
    })));
  },
);

// --- Sections ---

server.registerTool(
  "list_sections",
  {
    description: "List sections in a course",
    inputSchema: { course_id: courseIdSchema },
  },
  async ({ course_id }) => {
    const sections = (await canvasFetch(
      `/courses/${course_id}/sections?per_page=${PER_PAGE_DEFAULT}`,
    )) as Array<{
      id: number;
      name: string;
      course_id: number;
      start_at: string | null;
      end_at: string | null;
      students_count?: number;
    }>;

    return mcpText(sections.map((s) => ({
      id: s.id,
      name: s.name,
      course_id: s.course_id,
      start_at: s.start_at,
      end_at: s.end_at,
      students_count: s.students_count ?? null,
    })));
  },
);

// --- External Tools (LTI) ---

server.registerTool(
  "list_external_tools",
  {
    description: "List external (LTI) tools configured for a course",
    inputSchema: { course_id: courseIdSchema },
  },
  async ({ course_id }) => {
    const tools = (await canvasFetch(
      `/courses/${course_id}/external_tools?per_page=${PER_PAGE_DEFAULT}`,
    )) as Array<{
      id: number;
      name: string;
      description: string | null;
      url: string | null;
      domain: string | null;
      consumer_key: string;
    }>;

    return mcpText(tools.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      url: t.url,
      domain: t.domain,
    })));
  },
);

// --- Outcomes ---

server.registerTool(
  "list_outcome_groups",
  {
    description: "List learning outcome groups for a course",
    inputSchema: { course_id: courseIdSchema },
  },
  async ({ course_id }) => {
    const groups = (await canvasFetch(
      `/courses/${course_id}/outcome_groups?per_page=${PER_PAGE_DEFAULT}`,
    )) as Array<{
      id: number;
      title: string;
      description: string | null;
      vendor_guid: string | null;
      subgroups_count: number;
      outcomes_count: number;
    }>;

    return mcpText(groups.map((g) => ({
      id: g.id,
      title: g.title,
      description: g.description ? stripHtml(g.description) : null,
      subgroups_count: g.subgroups_count,
      outcomes_count: g.outcomes_count,
    })));
  },
);

server.registerTool(
  "list_outcomes",
  {
    description: "List learning outcomes in a specific outcome group",
    inputSchema: {
      course_id: courseIdSchema,
      outcome_group_id: z.string().regex(/^\d+$/, "outcome_group_id must be numeric").describe("The outcome group ID (from list_outcome_groups)"),
    },
  },
  async ({ course_id, outcome_group_id }) => {
    const links = (await canvasFetch(
      `/courses/${course_id}/outcome_groups/${outcome_group_id}/outcomes?per_page=${PER_PAGE_DEFAULT}`,
    )) as Array<{
      outcome: {
        id: number;
        title: string;
        description: string | null;
        points_possible: number | null;
        mastery_points: number | null;
        ratings?: Array<{ description: string; points: number }>;
      };
    }>;

    return mcpText(links.map((l) => ({
      id: l.outcome.id,
      title: l.outcome.title,
      description: l.outcome.description ? stripHtml(l.outcome.description) : null,
      points_possible: l.outcome.points_possible,
      mastery_points: l.outcome.mastery_points,
      ratings: l.outcome.ratings ?? [],
    })));
  },
);

// --- Course Progress ---

server.registerTool(
  "get_course_progress",
  {
    description: "Get the current user's progress through a course (module completion)",
    inputSchema: { course_id: courseIdSchema },
  },
  async ({ course_id }) => {
    const progress = (await canvasFetch(`/courses/${course_id}/progress`)) as {
      requirement_count: number;
      requirement_completed_count: number;
      next_requirement_url: string | null;
      completed_at: string | null;
    };

    return mcpText(progress);
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
