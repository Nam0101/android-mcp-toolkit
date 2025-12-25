#!/usr/bin/env node
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { registerSvgTool, svgToolInstructions } = require('./tools/svgTool');
const { registerLogcatTool, logcatToolInstructions } = require('./tools/logcatTool');
const { registerTextLengthTool, textLengthToolInstructions } = require('./tools/textLengthTool');
const { registerDeviceTool, deviceToolInstructions } = require('./tools/deviceTool');

const serverInstructions = [
  svgToolInstructions,
  logcatToolInstructions,
  textLengthToolInstructions,
  deviceToolInstructions
].join('\n');

const server = new McpServer(
  {
    name: 'android-mcp-toolkit',
    version: '1.3.0'
  },
  {
    capabilities: { logging: {} },
    instructions: serverInstructions
  }
);

registerSvgTool(server);
registerLogcatTool(server);
registerTextLengthTool(server);
registerDeviceTool(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stdin.resume();
}

main().catch(error => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
