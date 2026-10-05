import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, RequestHandler, Response } from "express";
import { log } from "../log.js";
import { registerTools, type Bridge } from "./tools.js";

export function createMcpServer(bridge: Bridge): McpServer {
  const server = new McpServer({ name: "easy-note", version: "0.1.0" });
  registerTools(server, bridge);
  return server;
}

// stateless: a fresh server + transport per request, all state lives in the bridge
export function mcpHandler(bridge: Bridge): RequestHandler {
  return async (req: Request, res: Response) => {
    const server = createMcpServer(bridge);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      log.error("mcp request failed");
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
      }
    }
  };
}

export const methodNotAllowed: RequestHandler = (_req, res) => {
  res
    .status(405)
    .set("Allow", "POST")
    .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
};
