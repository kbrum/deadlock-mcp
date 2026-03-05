import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPingTool(server: McpServer): void {
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Check if the MCP server is responding",
      inputSchema: {
        message: z.string().min(1).max(200).default("hello")
      }
    },
    async ({ message }) => ({
      content: [
        {
          type: "text",
          text: `pong: ${message}`
        }
      ]
    })
  );
}
