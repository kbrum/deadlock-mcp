import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type DeadlockClient } from "../services/deadlockClient.js";

export function registerGetItemDetailsTool(server: McpServer, deadlockClient: DeadlockClient): void {
  server.registerTool(
    "get_item_details",
    {
      title: "Get Item Details",
      description: "Get a specific item details by id or class name",
      inputSchema: {
        id_or_class_name: z.string().min(1),
        language: z.string().min(2).max(8).optional()
      }
    },
    async ({ id_or_class_name, language }) => {
      const result = await deadlockClient.getItemDetails(id_or_class_name, language);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
  );
}
