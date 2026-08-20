import { extractMediaUrls, stripHtmlOrNull } from "../html.js";
import {
  count,
  courseInput,
  id,
  moduleId,
  registerReadOnlyTool,
  text,
  timestamp,
  z,
  type ToolGroup,
} from "./common.js";

export const moduleTools: ToolGroup = (server, canvas) => {
  registerReadOnlyTool(
    server,
    "list_modules",
    {
      title: "List Modules",
      description: "List all modules for a course with id, name, and position",
      inputSchema: courseInput,
      outputSchema: {
        modules: z.array(
          z.object({
            id,
            name: text,
            position: count,
            items_count: count,
            state: text,
            completed_at: timestamp,
            prerequisite_module_ids: z.array(z.number()).nullish(),
          }),
        ),
      },
    },
    async ({ course_id }) => {
      const modules = await canvas.list<{
        id: number;
        name: string;
        position: number;
        items_count: number;
        state: string | null;
        completed_at: string | null;
        prerequisite_module_ids: number[];
      }>(`/courses/${course_id}/modules`);

      return {
        modules: modules.map((m) => ({
          id: m.id,
          name: m.name,
          position: m.position,
          items_count: m.items_count,
          state: m.state,
          completed_at: m.completed_at,
          prerequisite_module_ids: m.prerequisite_module_ids,
        })),
      };
    },
  );

  registerReadOnlyTool(
    server,
    "get_module",
    {
      title: "Get Module Contents",
      description:
        "Get all items in a module and fetch full content for page-type items (body text, assignments, etc.)",
      inputSchema: { ...courseInput, module_id: moduleId },
      outputSchema: {
        items: z.array(
          z.object({
            id,
            title: text,
            type: text,
            position: count,
            indent: count,
            html_url: text,
            content_id: z.number().nullish(),
            completion_requirement: z
              .object({ type: text, completed: z.boolean().nullish() })
              .nullish(),
            content: text,
            media_urls: z.array(z.string()),
          }),
        ),
      },
    },
    async ({ course_id, module_id }) => {
      const items = await canvas.list<{
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
      }>(`/courses/${course_id}/modules/${module_id}/items`);

      // Each item needs its own Canvas request; mapLimited keeps the fan-out
      // bounded so a large module cannot trip Canvas rate limiting.
      const enriched = await canvas.mapLimited(items, async (item) => {
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
            const page = await canvas.get<{ body: string | null; title: string }>(
              `/courses/${course_id}/pages/${item.page_url}`,
            );
            base.content = stripHtmlOrNull(page.body);
            base.media_urls = page.body ? extractMediaUrls(page.body) : [];
          } else if (item.type === "Assignment" && item.content_id) {
            const assignment = await canvas.get<{ description: string | null }>(
              `/courses/${course_id}/assignments/${item.content_id}`,
            );
            base.content = stripHtmlOrNull(assignment.description);
          } else if (item.type === "Discussion" && item.content_id) {
            const topic = await canvas.get<{ message: string | null }>(
              `/courses/${course_id}/discussion_topics/${item.content_id}`,
            );
            base.content = stripHtmlOrNull(topic.message);
          } else if (item.type === "Quiz" && item.content_id) {
            const quiz = await canvas.get<{ description: string | null }>(
              `/courses/${course_id}/quizzes/${item.content_id}`,
            );
            base.content = stripHtmlOrNull(quiz.description);
          } else if (item.url) {
            const data = await canvas.get<Record<string, unknown>>(
              item.url.replace(/^.*\/api\/v1/, ""),
            );
            for (const field of ["body", "message", "description"]) {
              const value = data[field];
              if (typeof value === "string") {
                base.content = stripHtmlOrNull(value);
                break;
              }
            }
          }
        } catch {
          // Content for an individual item may be locked or unavailable; the
          // item itself is still worth returning.
        }

        return base;
      });

      return { items: enriched };
    },
  );
};
