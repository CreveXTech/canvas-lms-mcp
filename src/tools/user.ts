import { stripHtmlOrNull } from "../html.js";
import {
  count,
  flag,
  id,
  points,
  registerReadOnlyTool,
  text,
  timestamp,
  z,
  type ToolGroup,
} from "./common.js";

export const userTools: ToolGroup = (server, canvas) => {
  registerReadOnlyTool(
    server,
    "get_user_profile",
    {
      title: "Get User Profile",
      description: "Get the current user's profile (name, email, bio, avatar)",
      outputSchema: {
        id,
        name: text,
        short_name: text,
        login_id: text,
        primary_email: text,
        bio: text,
        avatar_url: text,
        time_zone: text,
      },
    },
    async () => {
      const profile = await canvas.get<{
        id: number;
        name: string;
        short_name: string;
        login_id: string;
        primary_email: string | null;
        bio: string | null;
        avatar_url: string | null;
        time_zone: string | null;
      }>("/users/self/profile");

      return {
        id: profile.id,
        name: profile.name,
        short_name: profile.short_name,
        login_id: profile.login_id,
        primary_email: profile.primary_email,
        bio: profile.bio,
        avatar_url: profile.avatar_url,
        time_zone: profile.time_zone,
      };
    },
  );

  registerReadOnlyTool(
    server,
    "get_todo",
    {
      title: "Get To-Do List",
      description:
        "Get the current user's upcoming to-do items (assignments to submit, quizzes to take, etc.)",
      outputSchema: {
        items: z.array(
          z.object({
            type: text,
            context_type: text,
            course_id: z.number().nullish(),
            html_url: text,
            needs_grading_count: count,
            assignment: z
              .object({
                id,
                name: text,
                due_at: timestamp,
                points_possible: points,
                submission_types: z.array(z.string()).nullish(),
              })
              .nullish(),
          }),
        ),
      },
    },
    async () => {
      const items = await canvas.list<{
        type: string;
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
      }>("/users/self/todo");

      return {
        items: items.map((i) => ({
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
        })),
      };
    },
  );

  registerReadOnlyTool(
    server,
    "get_activity_stream",
    {
      title: "Get Activity Stream",
      description:
        "Get the current user's recent activity stream (submissions, announcements, discussions, etc.)",
      outputSchema: {
        items: z.array(
          z.object({
            id,
            type: text,
            title: text,
            message: text,
            read_state: flag,
            created_at: timestamp,
            updated_at: timestamp,
            course_id: z.number().nullish(),
            html_url: text,
          }),
        ),
      },
    },
    async () => {
      const items = await canvas.list<{
        id: number;
        title: string | null;
        message: string | null;
        type: string;
        read_state: boolean;
        created_at: string;
        updated_at: string;
        course_id: number | null;
        html_url: string | null;
      }>("/users/self/activity_stream");

      return {
        items: items.map((i) => ({
          id: i.id,
          type: i.type,
          title: i.title,
          message: stripHtmlOrNull(i.message),
          read_state: i.read_state,
          created_at: i.created_at,
          updated_at: i.updated_at,
          course_id: i.course_id,
          html_url: i.html_url,
        })),
      };
    },
  );
};
