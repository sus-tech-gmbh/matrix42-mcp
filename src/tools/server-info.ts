// src/tools/server-info.ts — reports which Matrix42 instance this server is connected to.

import type { McpServer } from '@modelcontextprotocol/server';
import { type ToolContext, type ToolDefinition, textResult, errorResult } from './types.js';

/** Health/identity tool: confirms connectivity and names the connected instance. */
export const serverInfoTool: ToolDefinition = {
  id: 'server_info',
  summary: 'Report the connected Matrix42 instance and verify the credentials work.',

  register(server: McpServer, { client, config }: ToolContext): void {
    server.registerTool(
      'server_info',
      {
        title: 'Matrix42 server info',
        description:
          'Report which Matrix42 instance this MCP server is connected to (base URL, authentication mode, response language) and verify that the configured credentials work. Never returns credentials.',
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => {
        const lines = [
          'Matrix42 MCP server',
          `Instance:  ${config.baseUrl}`,
          `Auth mode: ${config.authMode === 'token' ? 'API token (exchanged for an access token)' : 'basic'}`,
          `Language:  ${config.language} (sent as the Explicit-Language header)`,
        ];
        if (config.allowInsecureTls) {
          lines.push('TLS:       certificate verification is DISABLED for this instance');
        }
        try {
          await client.verifyConnection();
          lines.push('Status:    connected — credentials verified');
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return errorResult([...lines, `Status:    NOT connected — ${reason}`].join('\n'));
        }
        return textResult(lines.join('\n'));
      },
    );
  },
};
