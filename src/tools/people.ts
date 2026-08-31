import {
  count,
  courseInput,
  id,
  points,
  registerReadOnlyTool,
  text,
  timestamp,
  z,
  type ToolGroup,
} from "./common.js";

const userSummary = z.object({
  id,
  name: text,
  short_name: text,
  login_id: text,
});

export const peopleTools: ToolGroup = (server, canvas) => {
  registerReadOnlyTool(
    server,
    "list_course_users",
    {
      title: "List Course Users",
      description: "List enrolled users in a course (roster)",
      inputSchema: {
        ...courseInput,
        enrollment_type: z
          .enum(["student", "teacher", "ta", "observer", "designer"])
          .optional()
          .describe("Filter by enrollment type"),
      },
      outputSchema: {
        users: z.array(
          userSummary.extend({
            email: text,
            enrollments: z
              .array(z.object({ type: text, enrollment_state: text }))
              .nullish(),
          }),
        ),
      },
    },
    async ({ course_id, enrollment_type }) => {
      const params = new URLSearchParams({ "include[]": "enrollments" });
      if (enrollment_type) params.set("enrollment_type[]", enrollment_type);

      const users = await canvas.list<{
        id: number;
        name: string;
        short_name: string;
        login_id: string | null;
        email: string | null;
        enrollments?: Array<{ type: string; enrollment_state: string }>;
      }>(`/courses/${course_id}/users?${params}`);

      return {
        users: users.map((u) => ({
          id: u.id,
          name: u.name,
          short_name: u.short_name,
          login_id: u.login_id,
          email: u.email ?? null,
          enrollments:
            u.enrollments?.map((e) => ({
              type: e.type,
              enrollment_state: e.enrollment_state,
            })) ?? null,
        })),
      };
    },
  );

  registerReadOnlyTool(
    server,
    "list_enrollments",
    {
      title: "List Enrollments",
      description:
        "List enrollments for a course (students, teachers, etc.) with grade data",
      inputSchema: {
        ...courseInput,
        enrollment_type: z
          .enum([
            "StudentEnrollment",
            "TeacherEnrollment",
            "TaEnrollment",
            "DesignerEnrollment",
            "ObserverEnrollment",
          ])
          .optional()
          .describe("Filter by enrollment type"),
      },
      outputSchema: {
        enrollments: z.array(
          z.object({
            id,
            user_id: z.number().nullish(),
            type: text,
            enrollment_state: text,
            course_section_id: z.number().nullish(),
            user: userSummary.partial().nullish(),
            grades: z
              .object({
                current_score: points,
                final_score: points,
                current_grade: text,
                final_grade: text,
              })
              .loose()
              .nullish(),
          }),
        ),
      },
    },
    async ({ course_id, enrollment_type }) => {
      const params = new URLSearchParams();
      if (enrollment_type) params.set("type[]", enrollment_type);

      const enrollments = await canvas.list<{
        id: number;
        user_id: number;
        type: string;
        enrollment_state: string;
        user?: {
          id: number;
          name: string;
          short_name: string;
          login_id: string | null;
        };
        grades?: {
          current_score: number | null;
          final_score: number | null;
          current_grade: string | null;
          final_grade: string | null;
        };
        course_section_id: number | null;
      }>(`/courses/${course_id}/enrollments?${params}`);

      return {
        enrollments: enrollments.map((e) => ({
          id: e.id,
          user_id: e.user_id,
          type: e.type,
          enrollment_state: e.enrollment_state,
          course_section_id: e.course_section_id,
          user: e.user
            ? { id: e.user.id, name: e.user.name, login_id: e.user.login_id }
            : null,
          grades: e.grades ?? null,
        })),
      };
    },
  );

  registerReadOnlyTool(
    server,
    "list_sections",
    {
      title: "List Sections",
      description: "List sections in a course",
      inputSchema: courseInput,
      outputSchema: {
        sections: z.array(
          z.object({
            id,
            name: text,
            course_id: z.number().nullish(),
            start_at: timestamp,
            end_at: timestamp,
            students_count: count,
          }),
        ),
      },
    },
    async ({ course_id }) => {
      const sections = await canvas.list<{
        id: number;
        name: string;
        course_id: number;
        start_at: string | null;
        end_at: string | null;
        students_count?: number;
      }>(`/courses/${course_id}/sections?include[]=total_students`);

      return {
        sections: sections.map((s) => ({
          id: s.id,
          name: s.name,
          course_id: s.course_id,
          start_at: s.start_at,
          end_at: s.end_at,
          students_count: s.students_count ?? null,
        })),
      };
    },
  );

};
