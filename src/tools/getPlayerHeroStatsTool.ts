import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDefaultAccountId } from "../config/env.js";
import { type DeadlockClient } from "../services/deadlockClient.js";

export function registerGetPlayerHeroStatsTool(server: McpServer, deadlockClient: DeadlockClient): void {
  server.registerTool(
    "get_player_hero_stats",
    {
      title: "Get Player Hero Stats",
      description: "Get aggregated hero performance stats for an account",
      inputSchema: {
        account_id: z.number().int().positive().optional(),
        hero_ids: z.array(z.number().int().positive()).optional(),
        limit: z.number().int().min(1).max(100).default(20)
      }
    },
    async ({ account_id, hero_ids, limit }) => {
      const resolvedAccountId = account_id ?? getDefaultAccountId();
      if (!resolvedAccountId) {
        throw new Error("Missing account_id. Provide account_id in the tool call or set DEADLOCK_ACCOUNT_ID.");
      }

      const heroIdsCsv = hero_ids && hero_ids.length > 0 ? hero_ids.join(",") : undefined;
      const options: { heroIdsCsv?: string; limit: number } = { limit };
      if (heroIdsCsv) {
        options.heroIdsCsv = heroIdsCsv;
      }

      const result = await deadlockClient.getPlayerHeroStats(resolvedAccountId, options);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ account_id: resolvedAccountId, heroes: result }, null, 2)
          }
        ]
      };
    }
  );
}
