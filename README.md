# canvas-lms-mcp

A [Model Context Protocol](https://modelcontextprotocol.io/) server that connects AI assistants like Claude directly to your Canvas LMS — so you can ask natural language questions about your courses, assignments, grades, and files.

I built this because I was tired of switching tabs to check what's due next or hunting through Canvas's UI just to read an announcement. Now I just ask Claude.

**Read-only.** Every tool is a GET against the Canvas API and is annotated `readOnlyHint`. Nothing here can submit, post, or delete.

---

## What it does

34 tools across your whole Canvas account, all returning [structured output](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#structured-content) with declared schemas:

| Area | Group | Tools |
|------|-------|-------|
| Courses | `courses` | `list_courses`, `get_course`, `get_course_progress` |
| Assignments | `assignments` | `list_assignments`, `get_assignment_details`, `list_assignment_groups` |
| Modules | `modules` | `list_modules`, `get_module` |
| Pages | `pages` | `list_pages`, `get_page` |
| Discussions | `discussions` | `list_announcements`, `list_discussions`, `get_discussion` |
| Quizzes | `quizzes` | `list_quizzes`, `get_quiz` |
| Grades & submissions | `submissions` | `get_grades`, `get_submission`, `list_submissions` |
| Files | `files` | `list_files`, `list_folders`, `get_folder_files` |
| People | `people` | `list_course_users`, `list_enrollments`, `list_sections` |
| You | `user` | `get_user_profile`, `get_todo`, `get_activity_stream` |
| Calendar | `calendar` | `list_calendar_events` |
| Inbox | `conversations` | `list_conversations`, `get_conversation` |
| Other | `misc` | `list_rubrics`, `list_outcome_groups`, `list_outcomes`, `list_external_tools` |

Canvas HTML is reduced to plain text (entities decoded) before it reaches the model, and `get_module` / `get_page` also pull out embedded media links.

### Trimming the tool list

Set `CANVAS_TOOLS` (allowlist) or `CANVAS_DISABLED_TOOLS` (denylist) to a
comma-separated list of tool names, the group names above, or `*` globs. Filtered
tools are never registered, so they stay out of `tools/list` and out of the
client's context — unlike a client-side deny rule, which only blocks the call.

```bash
CANVAS_TOOLS=courses,assignments,modules,get_grades
CANVAS_DISABLED_TOOLS=conversations,misc,list_external_tools
```

The denylist applies after the allowlist. A pattern that matches nothing is
reported on stderr; a config leaving zero tools is a startup error.

---

## Quick start

### 1. Get a Canvas API token

In Canvas: **Account → Settings → Approved Integrations → New Access Token**

### 2. Clone, install, build

```bash
git clone https://github.com/DonutL0rd/canvas-lms-mcp.git
cd canvas-lms-mcp
pnpm install
pnpm build
```

Requires Node.js 22 or newer.

### 3. Configure

```bash
cp .env.example .env
```

Set at minimum:

```
CANVAS_API_TOKEN=your_token_here
CANVAS_BASE_URL=https://canvas.youruniversity.edu/api/v1
```

A `.env` in the project root is picked up automatically. Real environment variables always win over it.

---

## Running it

The server speaks two transports, selected with `MCP_TRANSPORT`.

### stdio (default) — local clients

The client spawns the process and talks over stdin/stdout. This is what Claude Desktop and Claude Code use.

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "node",
      "args": ["/absolute/path/to/canvas-lms-mcp/dist/index.js"],
      "env": {
        "CANVAS_API_TOKEN": "your_token_here",
        "CANVAS_BASE_URL": "https://canvas.youruniversity.edu/api/v1"
      }
    }
  }
}
```

Then restart the client. You can now ask things like:

- *"What assignments do I have due this week?"*
- *"Show me my grades for CS 301"*
- *"Any new announcements in my classes?"*
- *"What's the rubric for the final project in ENGL 200?"*

### HTTP — remote or containerised clients

[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) in stateless mode: `POST /mcp`, a fresh server instance per request, no sessions to keep alive. `GET` and `DELETE` return 405 — stateless mode has no server-initiated stream to attach to.

To run it directly, without Docker:

```bash
MCP_TRANSPORT=http MCP_AUTH_TOKEN=$(openssl rand -hex 32) pnpm start
```

The server refuses to start on HTTP without `MCP_AUTH_TOKEN` — the endpoint proxies your Canvas token and must not be left open. Every request needs `Authorization: Bearer <token>`, and its `Host` (and `Origin`, if sent) must be in `MCP_ALLOWED_HOSTS`.

Register it with Claude Code:

```bash
claude mcp add --transport http canvas-lms http://localhost:3000/mcp \
  --header "Authorization: Bearer $MCP_AUTH_TOKEN"
```

See [Docker](#docker) for the packaged version.

---

## Docker

```bash
cp .env.example .env          # fill in CANVAS_API_TOKEN and CANVAS_BASE_URL
openssl rand -hex 32          # put the result in MCP_AUTH_TOKEN
docker compose up -d --build
curl localhost:3111/health
```

Then point an MCP client at it:

```json
{
  "mcpServers": {
    "canvas-lms": {
      "type": "http",
      "url": "http://localhost:3111/mcp",
      "headers": {
        "Authorization": "Bearer <your MCP_AUTH_TOKEN>"
      }
    }
  }
}
```

What the compose file does for you:

- Publishes on **127.0.0.1 only** — the port is never exposed off-machine.
- Requires a **bearer token** on `/mcp`. This is not optional: the endpoint proxies your Canvas token, so the server refuses to start on HTTP without `MCP_AUTH_TOKEN`.
- Validates the `Host` and `Origin` headers against an allow-list, which is what blocks DNS-rebinding attacks from a browser on your machine.
- Runs as a non-root user, read-only root filesystem, all capabilities dropped, `no-new-privileges`.
- `GET /health` is unauthenticated so the healthcheck needs no secret.

> If you change the published port, change `MCP_ALLOWED_HOSTS` to match. Clients send the port they dialled, so `3111:3000` needs `MCP_ALLOWED_HOSTS=localhost:3111,127.0.0.1:3111`. A mismatch shows up as `403 Host or Origin header is not allowed`.

`.env` is in `.dockerignore` — your token is never baked into an image layer, it arrives at runtime via `env_file`.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `CANVAS_API_TOKEN` | — | **Required.** Canvas access token. |
| `CANVAS_BASE_URL` | `https://canvas.instructure.com/api/v1` | Your institution's API root. |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http`. |
| `MCP_AUTH_TOKEN` | — | Bearer token for `/mcp`. Required when `MCP_TRANSPORT=http`. |
| `MCP_HTTP_PORT` | `3000` | Listen port. |
| `MCP_HTTP_HOST` | `0.0.0.0` | Bind address. |
| `MCP_ALLOWED_HOSTS` | `localhost:PORT,127.0.0.1:PORT` | Accepted `Host` header values. |
| `CANVAS_TOOLS` | — | Allowlist of tool or group names to register. Unset means all. |
| `CANVAS_DISABLED_TOOLS` | — | Tool or group names to skip, applied after `CANVAS_TOOLS`. |
| `CANVAS_PER_PAGE` | `100` | Canvas page size. |
| `CANVAS_TIMEOUT_MS` | `30000` | Per-request timeout. |
| `CANVAS_MAX_PAGES` | `20` | Pagination safety stop (20 × 100 = 2000 records per call). |
| `CANVAS_MAX_CONCURRENCY` | `5` | Concurrent Canvas requests when a tool fans out. |

---

## How it talks to Canvas

- **Follows pagination.** Collection endpoints walk `Link: rel="next"` until exhausted, up to `CANVAS_MAX_PAGES`. Courses and assignments are not silently cut off at the first page.
- **Retries.** 429 and 5xx are retried with exponential backoff, honouring `Retry-After` when Canvas sends it.
- **Bounded fan-out.** Tools that need many requests (`get_module` fetches content for every item) cap concurrency rather than firing everything at once.
- **Canvas errors are tool errors, not protocol errors.** A 404 or 403 comes back as `isError` with a hint about what to try instead, so the model can correct itself — per the [2025-11-25 guidance](https://modelcontextprotocol.io/specification/2025-11-25/changelog).

---

## Project layout

```
src/
  index.ts     entry point and transport selection
  config.ts    environment parsing and validation
  canvas.ts    Canvas HTTP client: pagination, retry, concurrency
  html.ts      HTML to text, entity decoding, media link extraction
  http.ts      Streamable HTTP transport, auth, host validation
  server.ts    McpServer construction and tool registration order
  tools/       one module per Canvas area
```

---

## Development

```bash
pnpm dev        # tsc --watch
pnpm build      # production build
pnpm typecheck  # no emit
pnpm start      # run the built server
```

---

## Protocol support

Targets MCP **2025-11-25**, the newest revision the TypeScript SDK implements. Tools carry `title`, `outputSchema`, and read-only `annotations`; `tools/list` order is deterministic. Spec `2026-07-28` (stateless requests, `server/discover`) lands when the SDK ships it.

---

## License

MIT
