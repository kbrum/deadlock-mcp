import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDefaultAccountId } from "../config/env.js";
import { type DeadlockClient } from "../services/deadlockClient.js";

export function registerGetItemStatsTool(server: McpServer, deadlockClient: DeadlockClient): void {
  server.registerTool(
    "get_item_stats",
    {
      title: "Get Item Stats",
      description: "Get item usage stats for an account",
      inputSchema: {
        account_id: z.number().int().positive().optional(),
        hero_id: z.number().int().positive().optional(),
        min_matches: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).default(25)
      }
    },
    async ({ account_id, hero_id, min_matches, limit }) => {
      const resolvedAccountId = account_id ?? getDefaultAccountId();
      if (!resolvedAccountId) {
        throw new Error("Missing account_id. Provide account_id in the tool call or set DEADLOCK_ACCOUNT_ID.");
      }

      const options: { heroId?: number; minMatches?: number; limit: number } = { limit };
      if (typeof hero_id === "number") {
        options.heroId = hero_id;
      }
      if (typeof min_matches === "number") {
        options.minMatches = min_matches;
      }

      const result = await deadlockClient.getItemStatsForAccount(resolvedAccountId, options);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ account_id: resolvedAccountId, item_stats: result }, null, 2)
          }
        ]
      };
    }
  );
}
