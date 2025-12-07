#!/usr/bin/env node
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { registerSvgTool, svgToolInstructions } = require('./tools/svgTool');
const { registerLogcatTool, logcatToolInstructions } = require('./tools/logcatTool');

const serverInstructions = [svgToolInstructions, logcatToolInstructions].join('\n');

const server = new McpServer(
  {
    name: 'svg-to-android-drawable',
    version: '1.1.0'
  },
  {
    capabilities: { logging: {} },
    instructions: serverInstructions
  }
);

registerSvgTool(server);
registerLogcatTool(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stdin.resume();
}

main().catch(error => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
