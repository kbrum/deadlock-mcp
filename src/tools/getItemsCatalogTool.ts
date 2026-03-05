import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type DeadlockClient } from "../services/deadlockClient.js";

export function registerGetItemsCatalogTool(server: McpServer, deadlockClient: DeadlockClient): void {
  server.registerTool(
    "get_items_catalog",
    {
      title: "Get Items Catalog",
      description: "List game items with optional filters",
      inputSchema: {
        hero_id: z.number().int().positive().optional(),
        type: z.string().min(1).optional(),
        slot_type: z.string().min(1).optional(),
        language: z.string().min(2).max(8).optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(25)
      }
    },
    async ({ hero_id, type, slot_type, language, offset, limit }) => {
      const options: {
        heroId?: number;
        type?: string;
        slotType?: string;
        language?: string;
        offset: number;
        limit: number;
      } = {
        offset,
        limit
      };

      if (typeof hero_id === "number") {
        options.heroId = hero_id;
      }
      if (type) {
        options.type = type;
      }
      if (slot_type) {
        options.slotType = slot_type;
      }
      if (language) {
        options.language = language;
      }

      const result = await deadlockClient.getItemsCatalog(options);

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
