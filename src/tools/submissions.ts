import { stripHtmlOrNull } from "../html.js";
import {
  assignmentId,
  count,
  courseInput,
  fileSchema,
  flag,
  id,
  points,
  registerReadOnlyTool,
  text,
  timestamp,
  z,
  type ToolGroup,
} from "./common.js";

const submissionFields = {
  id,
  assignment_id: z.number().nullish(),
  score: points,
  grade: text,
  submitted_at: timestamp,
  workflow_state: text,
  late: flag,
  missing: flag,
  excused: flag,
  attempt: count,
};

export const submissionTools: ToolGroup = (server, canvas) => {
  registerReadOnlyTool(
    server,
    "get_grades",
    {
      title: "Get Grades",
      description: "Get current grades and scores for a course",
      inputSchema: courseInput,
      outputSchema: {
        enrollments: z.array(
          z.object({
            id,
            type: text,
            enrollment_state: text,
            course_id: z.number().nullish(),
            current_grade: text,
            current_score: points,
            final_grade: text,
            final_score: points,
          }),
        ),
      },
    },
    async ({ course_id }) => {
      const enrollments = await canvas.list<{
        id: number;
        type: string;
        enrollment_state: string;
        course_id: number;
        grades: {
          current_grade: string | null;
          current_score: number | null;
          final_grade: string | null;
          final_score: number | null;
        } | null;
      }>(`/courses/${course_id}/enrollments?user_id=self`);

      return {
        enrollments: enrollments.map((e) => ({
          id: e.id,
          type: e.type,
          enrollment_state: e.enrollment_state,
          course_id: e.course_id,
          current_grade: e.grades?.current_grade ?? null,
          current_score: e.grades?.current_score ?? null,
          final_grade: e.grades?.final_grade ?? null,
          final_score: e.grades?.final_score ?? null,
        })),
      };
    },
  );

  registerReadOnlyTool(
    server,
    "get_submission",
    {
      title: "Get Submission",
      description:
        "Get the current user's submission for an assignment, including grade, feedback, and attachments",
      inputSchema: { ...courseInput, assignment_id: assignmentId },
      outputSchema: {
        ...submissionFields,
        body: text,
        url: text,
        attachments: z.array(fileSchema),
        comments: z.array(
          z.object({
            id,
            author: text,
            comment: text,
            created_at: timestamp,
          }),
        ),
        rubric_assessment: z
          .record(
            z.string(),
            z.object({ points: points, comments: text }).loose(),
          )
          .nullish(),
      },
    },
    async ({ course_id, assignment_id }) => {
      const sub = await canvas.get<{
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
        attachments?: Array<{
          id: number;
          display_name: string;
          url: string;
          "content-type": string;
          size: number;
        }>;
        submission_comments?: Array<{
          id: number;
          author_name: string;
          comment: string;
          created_at: string;
        }>;
        rubric_assessment?: Record<
          string,
          { points: number | null; comments: string | null }
        >;
      }>(
        `/courses/${course_id}/assignments/${assignment_id}/submissions/self?include[]=submission_comments&include[]=rubric_assessment`,
      );

      return {
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
        body: stripHtmlOrNull(sub.body),
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
      };
    },
  );

  registerReadOnlyTool(
    server,
    "list_submissions",
    {
      title: "List Submissions",
      description:
        "List all of the current user's submissions for a course with grades and submission states",
      inputSchema: courseInput,
      outputSchema: { submissions: z.array(z.object(submissionFields)) },
    },
    async ({ course_id }) => {
      const subs = await canvas.list<{
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
      }>(`/courses/${course_id}/students/submissions?student_ids[]=self`);

      return {
        submissions: subs.map((s) => ({
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
        })),
      };
    },
  );
};
