import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDefaultAccountId } from "../config/env.js";
import { type DeadlockClient } from "../services/deadlockClient.js";

export function registerGetMatchOverviewTool(server: McpServer, deadlockClient: DeadlockClient): void {
  server.registerTool(
    "get_match_overview",
    {
      title: "Get Match Overview",
      description: "Get heroes used in a match and team overview",
      inputSchema: {
        account_id: z.number().int().positive().optional(),
        match_id: z.number().int().positive().optional()
      }
    },
    async ({ account_id, match_id }) => {
      const resolvedAccountId = account_id ?? getDefaultAccountId();
      if (!resolvedAccountId) {
        throw new Error("Missing account_id. Provide account_id in the tool call or set DEADLOCK_ACCOUNT_ID.");
      }

      const result = await deadlockClient.getMatchOverview(resolvedAccountId, match_id);
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
