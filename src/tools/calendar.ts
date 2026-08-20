import { stripHtmlOrNull } from "../html.js";
import {
  id,
  registerReadOnlyTool,
  text,
  timestamp,
  z,
  type ToolGroup,
} from "./common.js";

interface CanvasCalendarEvent {
  id: number;
  title: string;
  start_at: string | null;
  end_at: string | null;
  description: string | null;
  html_url: string | null;
  context_code: string;
  assignment?: { id: number; points_possible: number | null };
}

export const calendarTools: ToolGroup = (server, canvas) => {
  registerReadOnlyTool(
    server,
    "list_calendar_events",
    {
      title: "List Calendar Events",
      description:
        "List upcoming calendar events and assignment due dates for the current user",
      inputSchema: {
        start_date: z
          .string()
          .optional()
          .describe("ISO 8601 start date filter (e.g. 2026-01-01)"),
        end_date: z
          .string()
          .optional()
          .describe("ISO 8601 end date filter (e.g. 2026-12-31)"),
        context_codes: z
          .string()
          .optional()
          .describe(
            "Comma-separated context codes to filter by (e.g. course_123,course_456)",
          ),
      },
      outputSchema: {
        events: z.array(
          z.object({
            id,
            type: z.enum(["event", "assignment"]),
            title: text,
            start_at: timestamp,
            end_at: timestamp,
            description: text,
            html_url: text,
            context_code: text,
            assignment_id: z.number().nullish(),
          }),
        ),
      },
    },
    async ({ start_date, end_date, context_codes }) => {
      const shared = new URLSearchParams();
      if (start_date) shared.set("start_date", start_date);
      if (end_date) shared.set("end_date", end_date);
      if (context_codes) {
        for (const code of context_codes.split(",")) {
          const trimmed = code.trim();
          if (trimmed) shared.append("context_codes[]", trimmed);
        }
      }

      const withType = (type: string) => {
        const params = new URLSearchParams(shared);
        params.set("type", type);
        return `/calendar_events?${params}`;
      };

      const [events, assignments] = await Promise.all([
        canvas.list<CanvasCalendarEvent>(withType("event")),
        canvas.list<CanvasCalendarEvent>(withType("assignment")),
      ]);

      const map = (e: CanvasCalendarEvent, type: "event" | "assignment") => ({
        id: e.id,
        type,
        title: e.title,
        start_at: e.start_at,
        end_at: e.end_at,
        description: stripHtmlOrNull(e.description),
        html_url: e.html_url,
        context_code: e.context_code,
        assignment_id: e.assignment?.id ?? null,
      });

      return {
        events: [
          ...events.map((e) => map(e, "event")),
          ...assignments.map((e) => map(e, "assignment")),
        ].sort((a, b) => (a.start_at ?? "").localeCompare(b.start_at ?? "")),
      };
    },
  );
};
