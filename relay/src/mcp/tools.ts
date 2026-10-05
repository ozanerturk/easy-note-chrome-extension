import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { CallResult } from "../bridge/calls.js";
import { hashSub, log } from "../log.js";

export type Bridge = { call(sub: string, tool: string, args: unknown): Promise<CallResult> };

function toToolResult(r: CallResult): CallToolResult {
  if (r.ok) return { content: [{ type: "text", text: JSON.stringify(r.data) }] };
  return { content: [{ type: "text", text: r.error.message }], isError: true };
}

export function registerTools(server: McpServer, bridge: Bridge): void {
  const run =
    (tool: string) =>
    async (args: unknown, extra: { authInfo?: { extra?: Record<string, unknown> } }): Promise<CallToolResult> => {
      const sub = extra.authInfo?.extra?.sub;
      if (typeof sub !== "string") {
        return { content: [{ type: "text", text: "Not signed in." }], isError: true };
      }
      const started = Date.now();
      const result = await bridge.call(sub, tool, args);
      log.info(
        { tool, sub: hashSub(sub), ms: Date.now() - started, ok: result.ok, code: result.ok ? undefined : result.error.code },
        "tool call",
      );
      return toToolResult(result);
    };

  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description:
        "Search the user's Easy Note notes by keywords. Returns up to `limit` matches with short snippets. Use get_note to read a full note.",
      inputSchema: {
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(20).default(10),
      },
      annotations: { readOnlyHint: true },
    },
    (args, extra) => run("search_notes")(args, extra),
  );

  server.registerTool(
    "get_note",
    {
      title: "Get note",
      description: "Read one Easy Note note as plain text, by the id returned from search_notes.",
      inputSchema: { id: z.string().min(1).max(200) },
      annotations: { readOnlyHint: true },
    },
    (args, extra) => run("get_note")(args, extra),
  );

  server.registerTool(
    "capture",
    {
      title: "Capture to Easy Note",
      description:
        "Save a piece of text into the user's Easy Note Capture Tray. This only adds; it never edits or deletes existing notes.",
      inputSchema: {
        text: z.string().min(1).max(10_000),
        sourceUrl: z
          .string()
          .url()
          .refine((u) => /^https?:\/\//i.test(u), "sourceUrl must be http or https")
          .optional(),
        title: z.string().max(120).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    (args, extra) => run("capture")(args, extra),
  );
}
