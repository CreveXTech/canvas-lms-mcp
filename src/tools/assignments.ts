import { stripHtml, stripHtmlOrNull } from "../html.js";
import {
  assignmentId,
  count,
  courseInput,
  flag,
  id,
  points,
  registerReadOnlyTool,
  rubricCriterionSchema,
  text,
  timestamp,
  z,
  type ToolGroup,
} from "./common.js";

export const assignmentTools: ToolGroup = (server, canvas) => {
  registerReadOnlyTool(
    server,
    "list_assignments",
    {
      title: "List Assignments",
      description:
        "List assignments for a course with id, name, due_at, points_possible, and description",
      inputSchema: courseInput,
      outputSchema: {
        assignments: z.array(
          z.object({
            id,
            name: text,
            due_at: timestamp,
            points_possible: points,
            description: text,
          }),
        ),
      },
    },
    async ({ course_id }) => {
      const assignments = await canvas.list<{
        id: number;
        name: string;
        due_at: string | null;
        points_possible: number | null;
        description: string | null;
      }>(`/courses/${course_id}/assignments`);

      return {
        assignments: assignments.map((a) => ({
          id: a.id,
          name: a.name,
          due_at: a.due_at,
          points_possible: a.points_possible,
          description: stripHtmlOrNull(a.description),
        })),
      };
    },
  );

  registerReadOnlyTool(
    server,
    "get_assignment_details",
    {
      title: "Get Assignment Details",
      description: "Get full details and rubric for a specific assignment",
      inputSchema: { ...courseInput, assignment_id: assignmentId },
      outputSchema: {
        id,
        name: text,
        description: text,
        due_at: timestamp,
        points_possible: points,
        submission_types: z.array(z.string()).nullish(),
        allowed_attempts: count,
        grading_type: text,
        html_url: text,
        rubric: z.array(rubricCriterionSchema).nullish(),
        rubric_settings: z
          .object({
            id: z.number().nullish(),
            title: text,
            points_possible: points,
            free_form_criterion_comments: flag,
          })
          .nullish(),
      },
    },
    async ({ course_id, assignment_id }) => {
      const assignment = await canvas.get<{
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
      }>(`/courses/${course_id}/assignments/${assignment_id}`);

      return {
        id: assignment.id,
        name: assignment.name,
        description: stripHtmlOrNull(assignment.description),
        due_at: assignment.due_at,
        points_possible: assignment.points_possible,
        submission_types: assignment.submission_types,
        allowed_attempts: assignment.allowed_attempts,
        grading_type: assignment.grading_type,
        html_url: assignment.html_url,
        rubric:
          assignment.rubric?.map((criterion) => ({
            ...criterion,
            description: stripHtml(criterion.description),
            long_description: stripHtmlOrNull(criterion.long_description),
          })) ?? null,
        rubric_settings: assignment.rubric_settings ?? null,
      };
    },
  );

  registerReadOnlyTool(
    server,
    "list_assignment_groups",
    {
      title: "List Assignment Groups",
      description:
        "List assignment groups for a course with weights and assignments",
      inputSchema: courseInput,
      outputSchema: {
        groups: z.array(
          z.object({
            id,
            name: text,
            position: count,
            weight: points,
            assignments: z.array(
              z.object({
                id,
                name: text,
                due_at: timestamp,
                points_possible: points,
                omit_from_final_grade: flag,
              }),
            ),
          }),
        ),
      },
    },
    async ({ course_id }) => {
      const groups = await canvas.list<{
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
      }>(`/courses/${course_id}/assignment_groups?include[]=assignments`);

      return {
        groups: groups.map((g) => ({
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
        })),
      };
    },
  );
};
