import { stripHtmlOrNull } from "../html.js";
import {
  count,
  courseInput,
  flag,
  id,
  outcomeGroupId,
  points,
  registerReadOnlyTool,
  rubricCriterionSchema,
  text,
  z,
  type ToolGroup,
} from "./common.js";

export const miscTools: ToolGroup = (server, canvas) => {
  registerReadOnlyTool(
    server,
    "list_rubrics",
    {
      title: "List Rubrics",
      description: "List rubrics available in a course",
      inputSchema: courseInput,
      outputSchema: {
        rubrics: z.array(
          z.object({
            id,
            title: text,
            points_possible: points,
            reusable: flag,
            criteria: z.array(rubricCriterionSchema),
          }),
        ),
      },
    },
    async ({ course_id }) => {
      const rubrics = await canvas.list<{
        id: number;
        title: string;
        points_possible: number;
        reusable: boolean;
        free_form_criterion_comments: boolean;
        data?: Array<{
          id: string;
          description: string;
          long_description: string | null;
          points: number;
          ratings: Array<{ id: string; description: string; points: number }>;
        }>;
      }>(`/courses/${course_id}/rubrics`);

      return {
        rubrics: rubrics.map((r) => ({
          id: r.id,
          title: r.title,
          points_possible: r.points_possible,
          reusable: r.reusable,
          criteria: (r.data ?? []).map((c) => ({
            id: c.id,
            description: c.description,
            long_description: c.long_description,
            points: c.points,
            ratings: (c.ratings ?? []).map((rt) => ({
              id: rt.id,
              description: rt.description,
              points: rt.points,
            })),
          })),
        })),
      };
    },
  );

  registerReadOnlyTool(
    server,
    "list_outcome_groups",
    {
      title: "List Outcome Groups",
      description: "List learning outcome groups for a course",
      inputSchema: courseInput,
      outputSchema: {
        groups: z.array(
          z.object({
            id,
            title: text,
            description: text,
            subgroups_count: count,
            outcomes_count: count,
          }),
        ),
      },
    },
    async ({ course_id }) => {
      const groups = await canvas.list<{
        id: number;
        title: string;
        description: string | null;
        subgroups_count: number;
        outcomes_count: number;
      }>(`/courses/${course_id}/outcome_groups`);

      return {
        groups: groups.map((g) => ({
          id: g.id,
          title: g.title,
          description: stripHtmlOrNull(g.description),
          subgroups_count: g.subgroups_count,
          outcomes_count: g.outcomes_count,
        })),
      };
    },
  );

  registerReadOnlyTool(
    server,
    "list_outcomes",
    {
      title: "List Outcomes",
      description: "List learning outcomes in a specific outcome group",
      inputSchema: { ...courseInput, outcome_group_id: outcomeGroupId },
      outputSchema: {
        outcomes: z.array(
          z.object({
            id,
            title: text,
            description: text,
            points_possible: points,
            mastery_points: points,
            ratings: z.array(
              z.object({ description: text, points }).loose(),
            ),
          }),
        ),
      },
    },
    async ({ course_id, outcome_group_id }) => {
      const links = await canvas.list<{
        outcome: {
          id: number;
          title: string;
          description: string | null;
          points_possible: number | null;
          mastery_points: number | null;
          ratings?: Array<{ description: string; points: number }>;
        };
      }>(`/courses/${course_id}/outcome_groups/${outcome_group_id}/outcomes`);

      return {
        outcomes: links.map((l) => ({
          id: l.outcome.id,
          title: l.outcome.title,
          description: stripHtmlOrNull(l.outcome.description),
          points_possible: l.outcome.points_possible,
          mastery_points: l.outcome.mastery_points,
          ratings: l.outcome.ratings ?? [],
        })),
      };
    },
  );

  registerReadOnlyTool(
    server,
    "list_external_tools",
    {
      title: "List External Tools",
      description: "List external (LTI) tools configured for a course",
      inputSchema: courseInput,
      outputSchema: {
        tools: z.array(
          z.object({
            id,
            name: text,
            description: text,
            url: text,
            domain: text,
          }),
        ),
      },
    },
    async ({ course_id }) => {
      const tools = await canvas.list<{
        id: number;
        name: string;
        description: string | null;
        url: string | null;
        domain: string | null;
      }>(`/courses/${course_id}/external_tools`);

      return {
        tools: tools.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          url: t.url,
          domain: t.domain,
        })),
      };
    },
  );
};
