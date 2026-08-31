import {
  count,
  courseInput,
  fileSchema,
  folderId,
  id,
  registerReadOnlyTool,
  text,
  z,
  type ToolGroup,
} from "./common.js";

interface CanvasFile {
  id: number;
  display_name: string;
  filename: string;
  url: string;
  "content-type": string;
  size: number;
  updated_at: string | null;
  folder_id?: number;
}

function mapFile(f: CanvasFile) {
  return {
    id: f.id,
    name: f.display_name,
    filename: f.filename,
    url: f.url,
    content_type: f["content-type"],
    size: f.size,
    updated_at: f.updated_at,
  };
}

export const fileTools: ToolGroup = (server, canvas) => {
  registerReadOnlyTool(
    server,
    "list_files",
    {
      title: "List Course Files",
      description: "List course files with name, url, and content-type",
      inputSchema: courseInput,
      outputSchema: { files: z.array(fileSchema) },
    },
    async ({ course_id }) => {
      const files = await canvas.list<CanvasFile>(`/courses/${course_id}/files`);
      return { files: files.map(mapFile) };
    },
  );

  registerReadOnlyTool(
    server,
    "list_folders",
    {
      title: "List Folders",
      description: "List folders in a course's file system",
      inputSchema: courseInput,
      outputSchema: {
        folders: z.array(
          z.object({
            id,
            name: text,
            full_name: text,
            files_count: count,
            folders_count: count,
            parent_folder_id: z.number().nullish(),
          }),
        ),
      },
    },
    async ({ course_id }) => {
      const folders = await canvas.list<{
        id: number;
        name: string;
        full_name: string;
        files_count: number;
        folders_count: number;
        parent_folder_id: number | null;
      }>(`/courses/${course_id}/folders`);

      return {
        folders: folders.map((f) => ({
          id: f.id,
          name: f.name,
          full_name: f.full_name,
          files_count: f.files_count,
          folders_count: f.folders_count,
          parent_folder_id: f.parent_folder_id,
        })),
      };
    },
  );

  registerReadOnlyTool(
    server,
    "get_folder_files",
    {
      title: "Get Folder Files",
      description: "List files inside a specific folder",
      inputSchema: { folder_id: folderId },
      outputSchema: {
        files: z.array(
          fileSchema.extend({ folder_id: z.number().nullish() }),
        ),
      },
    },
    async ({ folder_id }) => {
      const files = await canvas.list<CanvasFile>(`/folders/${folder_id}/files`);
      return {
        files: files.map((f) => ({ ...mapFile(f), folder_id: f.folder_id ?? null })),
      };
    },
  );
};
