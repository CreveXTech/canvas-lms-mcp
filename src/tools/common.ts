import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { CanvasError, type CanvasClient } from "../canvas.js";

export { z };

/** Every tool group is registered through a function of this shape. */
export type ToolGroup = (server: McpServer, canvas: CanvasClient) => void;

type Shape = Record<string, z.ZodTypeAny>;

/**
 * Registers a read-only Canvas tool.
 *
 * Handlers return a plain object matching `outputSchema`; it is sent as
 * `structuredContent` (spec 2025-06-18) with a JSON text block alongside it for
 * clients that do not read structured output. Canvas failures come back as tool
 * execution errors rather than protocol errors, which is what spec 2025-11-25
 * calls for so the model can correct itself and retry.
 */
export function registerReadOnlyTool<Output extends Shape, Input extends Shape = Shape>(
  server: McpServer,
  name: string,
  spec: {
    title: string;
    description: string;
    inputSchema?: Input;
    outputSchema: Output;
  },
  handler: (args: z.output<z.ZodObject<Input>>) => Promise<z.input<z.ZodObject<Output>>>,
): void {
  const run = async (args: unknown) => {
    try {
      const data = await handler(args as z.output<z.ZodObject<Input>>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data) }],
        structuredContent: data as Record<string, unknown>,
      };
    } catch (err) {
      return toolError(err);
    }
  };

  const config = {
    title: spec.title,
    description: spec.description,
    ...(spec.inputSchema ? { inputSchema: spec.inputSchema } : {}),
    outputSchema: spec.outputSchema,
    annotations: {
      title: spec.title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  };

  // The SDK's callback type is conditional on whether inputSchema is present,
  // which a generic wrapper cannot express; the cast is confined to this line.
  const callback = spec.inputSchema ? (args: unknown) => run(args) : () => run({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server.registerTool(name, config as any, callback as any);
}

function toolError(err: unknown) {
  let message: string;

  if (err instanceof CanvasError) {
    message = err.message;
    if (err.status === 401) {
      message += "\n\nThe Canvas API token was rejected. It may have expired or been revoked.";
    } else if (err.status === 403) {
      message +=
        "\n\nCanvas denied access to this resource. Your enrollment may not permit it, " +
        "or the content may be locked until a later date.";
    } else if (err.status === 404) {
      message +=
        "\n\nNo such resource. Check the id — list the parent collection first to get valid ids.";
    }
  } else {
    message = err instanceof Error ? err.message : String(err);
  }

  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

// --- Shared input schemas ---

const numericId = (field: string, label: string) =>
  z
    .string()
    .regex(/^\d+$/, `${field} must be numeric`)
    .describe(`The Canvas ${label} ID`);

export const courseId = numericId("course_id", "course");
export const assignmentId = numericId("assignment_id", "assignment");
export const moduleId = numericId("module_id", "module");
export const topicId = numericId("topic_id", "discussion topic");
export const quizId = numericId("quiz_id", "quiz");
export const folderId = numericId("folder_id", "folder");
export const conversationId = numericId("conversation_id", "conversation");
export const outcomeGroupId = numericId("outcome_group_id", "outcome group");

export const courseInput = { course_id: courseId };

// --- Shared output leaves ---
// Canvas omits fields freely depending on enrollment and course settings, so
// output schemas stay permissive: a missing field must not fail validation.

export const id = z.number().describe("Canvas numeric ID");
export const text = z.string().nullish();
export const timestamp = z.string().nullish().describe("ISO 8601 timestamp");
export const points = z.number().nullish();
export const count = z.number().nullish();
export const flag = z.boolean().nullish();

export const fileSchema = z.object({
  id,
  name: text,
  filename: text,
  url: text,
  content_type: text,
  size: count,
  updated_at: timestamp,
});

export const rubricCriterionSchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  description: text,
  long_description: text,
  points,
  ratings: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]).nullish(),
        description: text,
        long_description: text.optional(),
        points,
      }),
    )
    .nullish(),
});
