import { stripHtmlOrNull } from "../html.js";
import {
  count,
  courseInput,
  id,
  registerReadOnlyTool,
  text,
  timestamp,
  z,
  type ToolGroup,
} from "./common.js";

export const courseTools: ToolGroup = (server, canvas) => {
  registerReadOnlyTool(
    server,
    "list_courses",
    {
      title: "List Courses",
      description:
        "List all active enrolled courses with id, name, and course_code",
      outputSchema: {
        courses: z.array(
          z.object({ id, name: text, course_code: text }),
        ),
      },
    },
    async () => {
      const courses = await canvas.list<{
        id: number;
        name: string;
        course_code: string;
      }>("/courses?enrollment_state=active");

      return {
        courses: courses.map((c) => ({
          id: c.id,
          name: c.name,
          course_code: c.course_code,
        })),
      };
    },
  );

  registerReadOnlyTool(
    server,
    "get_course",
    {
      title: "Get Course",
      description:
        "Get full details for a course including syllabus body, start/end dates, and settings",
      inputSchema: courseInput,
      outputSchema: {
        id,
        name: text,
        course_code: text,
        start_at: timestamp,
        end_at: timestamp,
        time_zone: text,
        default_view: text,
        term: z
          .object({
            id: z.number().nullish(),
            name: text,
            start_at: timestamp,
            end_at: timestamp,
          })
          .nullish(),
        syllabus: text,
      },
    },
    async ({ course_id }) => {
      const course = await canvas.get<{
        id: number;
        name: string;
        course_code: string;
        start_at: string | null;
        end_at: string | null;
        time_zone: string | null;
        syllabus_body: string | null;
        default_view: string | null;
        term: {
          id: number;
          name: string;
          start_at: string | null;
          end_at: string | null;
        } | null;
      }>(
        `/courses/${course_id}?include[]=syllabus_body&include[]=total_scores&include[]=term`,
      );

      return {
        id: course.id,
        name: course.name,
        course_code: course.course_code,
        start_at: course.start_at,
        end_at: course.end_at,
        time_zone: course.time_zone,
        default_view: course.default_view,
        term: course.term
          ? {
              id: course.term.id,
              name: course.term.name,
              start_at: course.term.start_at,
              end_at: course.term.end_at,
            }
          : null,
        syllabus: stripHtmlOrNull(course.syllabus_body),
      };
    },
  );

  registerReadOnlyTool(
    server,
    "get_course_progress",
    {
      title: "Get Course Progress",
      description:
        "Get the current user's progress through a course (module completion)",
      inputSchema: courseInput,
      outputSchema: {
        requirement_count: count,
        requirement_completed_count: count,
        next_requirement_url: text,
        completed_at: timestamp,
      },
    },
    async ({ course_id }) => {
      const progress = await canvas.get<{
        requirement_count: number;
        requirement_completed_count: number;
        next_requirement_url: string | null;
        completed_at: string | null;
      }>(`/courses/${course_id}/progress`);

      return {
        requirement_count: progress.requirement_count,
        requirement_completed_count: progress.requirement_completed_count,
        next_requirement_url: progress.next_requirement_url,
        completed_at: progress.completed_at,
      };
    },
  );
};
