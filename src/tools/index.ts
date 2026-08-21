// src/tools/index.ts — registry of every tool this server can expose.

import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolContext, ToolDefinition } from './types.js';
import { dataQueryTool } from './data-query.js';
import { schemaDiscoveryTool } from './schema-discovery.js';
import { ticketActionsTool } from './ticket-actions.js';
import { serverInfoTool } from './server-info.js';
import { webserviceDiscoveryTool } from './webservice-discovery.js';

/** Every tool known to this server, in the order they are documented. */
export const READ_TOOLS: ToolDefinition[] = [
  serverInfoTool,
  webserviceDiscoveryTool,
  schemaDiscoveryTool,
  dataQueryTool,
];

/** Tools that modify Matrix42 data. Exposed only when writes are explicitly enabled. */
export const WRITE_TOOLS: ToolDefinition[] = [ticketActionsTool];

/** Every tool this server can expose, read tools first. */
export const ALL_TOOLS: ToolDefinition[] = [...READ_TOOLS, ...WRITE_TOOLS];

/** The tools available for the given write setting — read-only deployments never see write tools. */
export function availableTools(allowWrites: boolean): ToolDefinition[] {
  return allowWrites ? ALL_TOOLS : READ_TOOLS;
}

/** Resolves which tools to expose: an explicit allow-list, or all of them when none is given. */
export function selectTools(
  enabled: string[],
  allowWrites = false,
): { tools: ToolDefinition[]; unknown: string[] } {
  const available = availableTools(allowWrites);
  if (enabled.length === 0) return { tools: available, unknown: [] };
  const known = new Map(available.map((tool) => [tool.id, tool]));
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
