import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DeadlockClient } from "./services/deadlockClient.js";
import { registerGetItemDetailsTool } from "./tools/getItemDetailsTool.js";
import { registerGetItemStatsTool } from "./tools/getItemStatsTool.js";
import { registerGetMatchEnemyItemsTool } from "./tools/getMatchEnemyItemsTool.js";
import { registerGetItemsCatalogTool } from "./tools/getItemsCatalogTool.js";
import { registerGetMatchHistoryTool } from "./tools/getMatchHistoryTool.js";
import { registerGetMatchOverviewTool } from "./tools/getMatchOverviewTool.js";
import { registerGetMatchPlayerItemsTool } from "./tools/getMatchPlayerItemsTool.js";
import { registerGetMatchPlayerPerformanceTool } from "./tools/getMatchPlayerPerformanceTool.js";
import { registerGetPlayerHeroStatsTool } from "./tools/getPlayerHeroStatsTool.js";
import { registerPingTool } from "./tools/pingTool.js";

const server = new McpServer({
  name: "deadlock-mcp",
  version: "0.1.0"
});

const deadlockClient = new DeadlockClient();

registerPingTool(server);
registerGetMatchHistoryTool(server, deadlockClient);
registerGetPlayerHeroStatsTool(server, deadlockClient);
registerGetItemStatsTool(server, deadlockClient);
registerGetItemsCatalogTool(server, deadlockClient);
registerGetItemDetailsTool(server, deadlockClient);
registerGetMatchOverviewTool(server, deadlockClient);
registerGetMatchPlayerPerformanceTool(server, deadlockClient);
registerGetMatchPlayerItemsTool(server, deadlockClient);
registerGetMatchEnemyItemsTool(server, deadlockClient);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to start deadlock-mcp: ${message}`);
  if (globalThis.process?.exit) {
    globalThis.process.exit(1);
  }
});
