import { extractMediaUrls, stripHtmlOrNull } from "../html.js";
import {
  courseInput,
  flag,
  id,
  registerReadOnlyTool,
  text,
  timestamp,
  z,
  type ToolGroup,
} from "./common.js";

interface CanvasPage {
  page_id: number;
  url: string;
  title: string;
  updated_at: string | null;
  body: string | null;
  published: boolean;
  front_page: boolean;
}

export const pageTools: ToolGroup = (server, canvas) => {
  registerReadOnlyTool(
    server,
    "list_pages",
    {
      title: "List Pages",
      description: "List pages (wiki pages) in a course",
      inputSchema: courseInput,
      outputSchema: {
        pages: z.array(
          z.object({
            id,
            url: text,
            title: text,
            updated_at: timestamp,
            published: flag,
            front_page: flag,
          }),
        ),
      },
    },
    async ({ course_id }) => {
      const pages = await canvas.list<Omit<CanvasPage, "body">>(
        `/courses/${course_id}/pages?sort=title`,
      );

      return {
        pages: pages.map((p) => ({
          id: p.page_id,
          url: p.url,
          title: p.title,
          updated_at: p.updated_at,
          published: p.published,
          front_page: p.front_page,
        })),
      };
    },
  );

  registerReadOnlyTool(
    server,
    "get_page",
    {
      title: "Get Page",
      description: "Get the full content of a course page by its URL slug",
      inputSchema: {
        ...courseInput,
        page_url: z.string().min(1).describe("The page URL slug (from list_pages)"),
      },
      outputSchema: {
        id,
        url: text,
        title: text,
        updated_at: timestamp,
        published: flag,
        front_page: flag,
        content: text,
        media_urls: z.array(z.string()),
      },
    },
    async ({ course_id, page_url }) => {
      const page = await canvas.get<CanvasPage>(
        `/courses/${course_id}/pages/${encodeURIComponent(page_url)}`,
      );

      return {
        id: page.page_id,
        url: page.url,
        title: page.title,
        updated_at: page.updated_at,
        published: page.published,
        front_page: page.front_page,
        content: stripHtmlOrNull(page.body),
        media_urls: page.body ? extractMediaUrls(page.body) : [],
      };
    },
  );
};
