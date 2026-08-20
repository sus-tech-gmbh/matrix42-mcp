// src/tools/types.ts — shared contract every tool module implements.

import type { McpServer } from '@modelcontextprotocol/server';
import type { Config } from '../config.js';
import type { M42Client } from '../m42-client.js';

/** Everything a tool needs to serve a request. */
export interface ToolContext {
  client: M42Client;
  config: Config;
}

/** A tool the server can expose, identified by the id used in M42_TOOLS. */
export interface ToolDefinition {
  id: string;
  /** One-line summary used by --list-tools and the README. */
  summary: string;
  register(server: McpServer, context: ToolContext): void;
}

/** Wraps text in the MCP tool result shape. */
export function textResult(text: string): {
  content: { type: 'text'; text: string }[];
} {
  return { content: [{ type: 'text', text }] };
}

/** Wraps an error message in the MCP tool result shape, flagged as an error. */
export function errorResult(message: string): {
  content: { type: 'text'; text: string }[];
  isError: true;
} {
  return { content: [{ type: 'text', text: message }], isError: true };
}
