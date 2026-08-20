// src/tools/index.ts — registry of every tool this server can expose.

import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolContext, ToolDefinition } from './types.js';
import { schemaDiscoveryTool } from './schema-discovery.js';
import { serverInfoTool } from './server-info.js';
import { webserviceDiscoveryTool } from './webservice-discovery.js';

/** Every tool known to this server, in the order they are documented. */
export const ALL_TOOLS: ToolDefinition[] = [serverInfoTool, webserviceDiscoveryTool, schemaDiscoveryTool];

/** Resolves which tools to expose: an explicit allow-list, or all of them when none is given. */
export function selectTools(enabled: string[]): { tools: ToolDefinition[]; unknown: string[] } {
  if (enabled.length === 0) return { tools: ALL_TOOLS, unknown: [] };
  const known = new Map(ALL_TOOLS.map((tool) => [tool.id, tool]));
  const tools: ToolDefinition[] = [];
  const unknown: string[] = [];
  for (const id of enabled) {
    const tool = known.get(id);
    if (tool) tools.push(tool);
    else unknown.push(id);
  }
  return { tools, unknown };
}

/** Registers the selected tools on the server. */
export function registerTools(
  server: McpServer,
  context: ToolContext,
  tools: ToolDefinition[],
): void {
  for (const tool of tools) tool.register(server, context);
}

export type { ToolContext, ToolDefinition } from './types.js';
