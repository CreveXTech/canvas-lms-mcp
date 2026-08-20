import { stripHtmlOrNull } from "../html.js";
import {
  count,
  courseInput,
  id,
  registerReadOnlyTool,
  text,
  timestamp,
  topicId,
  z,
  type ToolGroup,
} from "./common.js";

interface CanvasTopic {
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
}

export const discussionTools: ToolGroup = (server, canvas) => {
  registerReadOnlyTool(
    server,
    "list_announcements",
    {
      title: "List Announcements",
      description: "List recent announcements for a course",
      inputSchema: courseInput,
      outputSchema: {
        announcements: z.array(
          z.object({
            id,
            title: text,
            message: text,
            posted_at: timestamp,
            author: text,
          }),
        ),
      },
    },
    async ({ course_id }) => {
      const announcements = await canvas.list<CanvasTopic>(
        `/courses/${course_id}/discussion_topics?only_announcements=true`,
      );

      return {
        announcements: announcements.map((a) => ({
          id: a.id,
          title: a.title,
          message: stripHtmlOrNull(a.message),
          posted_at: a.posted_at,
          author: a.author?.display_name ?? null,
        })),
      };
    },
  );

  registerReadOnlyTool(
    server,
    "list_discussions",
    {
      title: "List Discussions",
      description: "List discussion topics for a course (excludes announcements)",
      inputSchema: courseInput,
      outputSchema: {
        discussions: z.array(
          z.object({
            id,
            title: text,
            message: text,
            posted_at: timestamp,
            author: text,
            discussion_type: text,
            assignment_id: z.number().nullish(),
            due_at: timestamp,
            replies_count: count,
            unread_count: count,
          }),
        ),
      },
    },
    async ({ course_id }) => {
      const topics = await canvas.list<CanvasTopic>(
        `/courses/${course_id}/discussion_topics?exclude_announcements=true`,
      );

      return {
        discussions: topics.map((t) => ({
          id: t.id,
          title: t.title,
          message: stripHtmlOrNull(t.message),
          posted_at: t.posted_at,
          author: t.author?.display_name ?? null,
          discussion_type: t.discussion_type,
          assignment_id: t.assignment_id,
          due_at: t.due_at,
          replies_count: t.replies_count,
          unread_count: t.unread_count,
        })),
      };
    },
  );

  registerReadOnlyTool(
    server,
    "get_discussion",
    {
      title: "Get Discussion",
      description: "Get a discussion topic with its top-level entries and replies",
      inputSchema: { ...courseInput, topic_id: topicId },
      outputSchema: {
        id,
        title: text,
        message: text,
        posted_at: timestamp,
        author: text,
        assignment_id: z.number().nullish(),
        due_at: timestamp,
        replies_count: count,
        entries: z.array(
          z.object({
            id,
            user_name: text,
            message: text,
            created_at: timestamp,
            replies: z.array(
              z.object({
                id,
                user_name: text,
                message: text,
                created_at: timestamp,
              }),
            ),
          }),
        ),
      },
    },
    async ({ course_id, topic_id }) => {
      interface Entry {
        id: number;
        user_id: number;
        user_name: string;
        message: string | null;
        created_at: string;
        recent_replies?: Entry[];
      }

      const [topic, entries] = await Promise.all([
        canvas.get<CanvasTopic>(
          `/courses/${course_id}/discussion_topics/${topic_id}`,
        ),
        canvas.list<Entry>(
          `/courses/${course_id}/discussion_topics/${topic_id}/entries`,
        ),
      ]);

      return {
        id: topic.id,
        title: topic.title,
        message: stripHtmlOrNull(topic.message),
        posted_at: topic.posted_at,
        author: topic.author?.display_name ?? null,
        assignment_id: topic.assignment_id,
        due_at: topic.due_at,
        replies_count: topic.replies_count,
        entries: entries.map((e) => ({
          id: e.id,
          user_name: e.user_name,
          message: stripHtmlOrNull(e.message),
          created_at: e.created_at,
          replies: (e.recent_replies ?? []).map((r) => ({
            id: r.id,
            user_name: r.user_name,
            message: stripHtmlOrNull(r.message),
            created_at: r.created_at,
          })),
        })),
      };
    },
  );
};
