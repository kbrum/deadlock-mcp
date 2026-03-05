import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDefaultAccountId } from "../config/env.js";
import { type DeadlockClient } from "../services/deadlockClient.js";

export function registerGetMatchHistoryTool(server: McpServer, deadlockClient: DeadlockClient): void {
  server.registerTool(
    "get_match_history",
    {
      title: "Get Match History",
      description: "Get recent match history for an account",
      inputSchema: {
        account_id: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(50).default(10),
        force_refetch: z.boolean().default(true),
        only_stored_history: z.boolean().default(false)
      }
    },
    async ({ account_id, limit, force_refetch, only_stored_history }) => {
      const resolvedAccountId = account_id ?? getDefaultAccountId();
      if (!resolvedAccountId) {
        throw new Error("Missing account_id. Provide account_id in the tool call or set DEADLOCK_ACCOUNT_ID.");
      }

      const options: { limit: number; forceRefetch: boolean; onlyStoredHistory: boolean } = {
        limit,
        forceRefetch: force_refetch,
        onlyStoredHistory: only_stored_history
      };

      const result = await deadlockClient.getMatchHistory(resolvedAccountId, options);

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
