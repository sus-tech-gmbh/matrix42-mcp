// src/tools/webservice-discovery.ts — lets a model discover the Matrix42 web service API.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { API_OVERVIEW } from '../api-overview.js';
import { describeOperation, listOperations, listServices } from '../discovery.js';
import { type ToolContext, type ToolDefinition, textResult, errorResult } from './types.js';

/** Default number of operations returned when the caller does not specify a limit. */
export const DEFAULT_OPERATION_LIMIT = 200;

/** Applies a limit, reporting how many matched in total so the model knows what it is missing. */
export function limitResults<T>(
  items: T[],
  limit: number,
): { returned: T[]; total: number; truncated: boolean } {
  const effective = limit > 0 ? limit : items.length;
  return {
    returned: items.slice(0, effective),
    total: items.length,
    truncated: items.length > effective,
  };
}

/** Discovery tool: API conventions, service/operation listings, and per-operation contracts. */
export const webserviceDiscoveryTool: ToolDefinition = {
  id: 'webservice_discovery',
  summary: 'Discover Matrix42 web services, operations, and their parameter/return contracts.',

  register(server: McpServer, { client }: ToolContext): void {
    server.registerTool(
      'webservice_discovery',
      {
        title: 'Matrix42 web service discovery',
        description:
          "Discover the Matrix42 REST API of the connected instance (read-only metadata). " +
          "action='api_overview' returns general Matrix42 API conventions (token exchange, the Explicit-Language header, Public vs Product API) — useful for reasoning about the API or writing standalone integration code. " +
          "action='list_operations' returns operations as {id,name,method,path,service,documentation}; pass 'search' to filter by name/documentation/service or 'service_id' to limit to one service. " +
          "action='list_services' lists every web service with its documentation. " +
          "action='describe_operation' with 'operation_id' returns that operation's full contract: HTTP method, path, parameters with types, and return type. " +
          'Typical flow: api_overview (once) → list_operations(search) → describe_operation(id).',
        annotations: { readOnlyHint: true, openWorldHint: true },
        inputSchema: z.object({
          action: z
            .enum(['api_overview', 'list_services', 'list_operations', 'describe_operation'])
            .describe('Which discovery step to perform.'),
          search: z
            .string()
            .optional()
            .describe(
              "Case-insensitive filter over operation name, documentation, and service name. Only used with action='list_operations'.",
            ),
          service_id: z
            .string()
            .optional()
            .describe(
              "Limit results to a single web service (id from action='list_services'). Only used with action='list_operations'.",
            ),
          operation_id: z
            .string()
            .optional()
            .describe("Operation id to describe. Required for action='describe_operation'."),
          limit: z
            .number()
            .int()
            .optional()
            .describe(
              `Maximum number of operations to return (default ${DEFAULT_OPERATION_LIMIT}, 0 = no limit). Only used with action='list_operations'.`,
            ),
        }),
      },
      async ({ action, search, service_id, operation_id, limit }) => {
        try {
          switch (action) {
            case 'api_overview':
              return textResult(API_OVERVIEW);

            case 'list_services': {
              const services = await listServices(client);
              return textResult(JSON.stringify({ count: services.length, services }));
            }

            case 'list_operations': {
              const operations = await listOperations(client, { serviceId: service_id, search });
              const { returned, total, truncated } = limitResults(
                operations,
                limit ?? DEFAULT_OPERATION_LIMIT,
              );
              return textResult(
                JSON.stringify({
                  count: returned.length,
                  total,
                  ...(truncated
                    ? {
                        truncated: true,
                        hint: `Showing ${returned.length} of ${total} matching operations. Narrow with 'search'/'service_id', or raise 'limit' (0 = no limit).`,
                      }
                    : {}),
                  operations: returned,
                }),
              );
            }

            case 'describe_operation': {
              if (!operation_id) {
                return errorResult(
                  "operation_id is required for action='describe_operation'. Find one with action='list_operations'.",
                );
              }
              const spec = await describeOperation(client, operation_id);
              return textResult(JSON.stringify(spec, null, 2));
            }
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return errorResult(`Discovery failed: ${reason}`);
        }
      },
    );
  },
};
