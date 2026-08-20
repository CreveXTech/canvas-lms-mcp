import { stripHtmlOrNull } from "../html.js";
import {
  conversationId,
  count,
  flag,
  id,
  registerReadOnlyTool,
  text,
  timestamp,
  z,
  type ToolGroup,
} from "./common.js";

const participant = z.object({ id, name: text });

export const conversationTools: ToolGroup = (server, canvas) => {
  registerReadOnlyTool(
    server,
    "list_conversations",
    {
      title: "List Conversations",
      description: "List conversations (inbox messages) for the current user",
      inputSchema: {
        scope: z
          .enum(["inbox", "unread", "starred", "sent", "archived"])
          .optional()
          .describe("Filter conversations by scope (default: inbox)"),
      },
      outputSchema: {
        conversations: z.array(
          z.object({
            id,
            subject: text,
            workflow_state: text,
            last_message: text,
            last_message_at: timestamp,
            message_count: count,
            subscribed: flag,
            starred: flag,
            participants: z.array(participant),
            context_name: text,
          }),
        ),
      },
    },
    async ({ scope }) => {
      const params = new URLSearchParams();
      if (scope) params.set("scope", scope);

      const convos = await canvas.list<{
        id: number;
        subject: string | null;
        workflow_state: string;
        last_message: string | null;
        last_message_at: string | null;
        message_count: number;
        subscribed: boolean;
        starred: boolean;
        participants: Array<{ id: number; name: string }>;
        context_name: string | null;
      }>(`/conversations?${params}`);

      return {
        conversations: convos.map((c) => ({
          id: c.id,
          subject: c.subject,
          workflow_state: c.workflow_state,
          last_message: c.last_message,
          last_message_at: c.last_message_at,
          message_count: c.message_count,
          subscribed: c.subscribed,
          starred: c.starred,
          participants: (c.participants ?? []).map((p) => ({
            id: p.id,
            name: p.name,
          })),
          context_name: c.context_name,
        })),
      };
    },
  );

  registerReadOnlyTool(
    server,
    "get_conversation",
    {
      title: "Get Conversation",
      description: "Get a conversation thread with all messages",
      inputSchema: { conversation_id: conversationId },
      outputSchema: {
        id,
        subject: text,
        workflow_state: text,
        context_name: text,
        participants: z.array(participant),
        messages: z.array(
          z.object({
            id,
            created_at: timestamp,
            author_id: z.number().nullish(),
            body: text,
            attachments: z.array(z.object({ id, name: text, url: text })),
          }),
        ),
      },
    },
    async ({ conversation_id }) => {
      const convo = await canvas.get<{
        id: number;
        subject: string | null;
        workflow_state: string;
        participants: Array<{ id: number; name: string }>;
        context_name: string | null;
        messages: Array<{
          id: number;
          created_at: string;
          body: string;
          author_id: number;
          attachments?: Array<{ id: number; display_name: string; url: string }>;
        }>;
      }>(`/conversations/${conversation_id}`);

      return {
        id: convo.id,
        subject: convo.subject,
        workflow_state: convo.workflow_state,
        context_name: convo.context_name,
        participants: (convo.participants ?? []).map((p) => ({
          id: p.id,
          name: p.name,
        })),
        messages: (convo.messages ?? []).map((m) => ({
          id: m.id,
          created_at: m.created_at,
          author_id: m.author_id,
          body: stripHtmlOrNull(m.body),
          attachments: (m.attachments ?? []).map((a) => ({
            id: a.id,
            name: a.display_name,
            url: a.url,
          })),
        })),
      };
    },
  );
};
