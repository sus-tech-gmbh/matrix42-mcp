// src/tools/data-query.ts — reads records from the connected Matrix42 instance.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { ASQL_GUIDE } from '../asql-guide.js';
import {
  DEFAULT_PAGE_SIZE,
  getFragment,
  getObject,
  queryFragments,
  validateAsql,
} from '../data.js';
import { type ToolContext, type ToolDefinition, textResult, errorResult } from './types.js';

/**
 * Data access tool. Kept separate from schema_discovery so that exploring the model and reading
 * actual records are independently grantable via M42_TOOLS.
 */
export const dataQueryTool: ToolDefinition = {
  id: 'data_query',
  summary: 'Read records: query data definitions with ASQL filters, fetch fragments and objects.',

  register(server: McpServer, { client }: ToolContext): void {
    server.registerTool(
      'data_query',
      {
        title: 'Matrix42 data query',
        description:
          "Read records from the connected Matrix42 instance (read-only). " +
          "action='asql_guide' explains the ASQL expression language used by 'where' and 'columns' — read it before writing a filter. " +
          "action='validate_asql' checks an expression against a class and reports the exact error; validating is cheaper than a failed query. " +
          "action='query' returns rows of one data definition, with typed column metadata, an ASQL 'where' filter, 'columns' projection, 'sort', and paging. " +
          "action='get_fragment' returns one complete fragment by id; action='get_object' returns a whole object by configuration-item name and object id. " +
          "Find class names and attributes with schema_discovery first, and get_pickup_values for the valid values of any pickup you filter on.",
        annotations: { readOnlyHint: true, openWorldHint: true },
        inputSchema: z.object({
          action: z
            .enum(['asql_guide', 'validate_asql', 'query', 'get_fragment', 'get_object'])
            .describe('Which data operation to perform.'),
          class: z
            .string()
            .optional()
            .describe(
              "Internal name of the data definition to read, e.g. 'SPSActivityClassBase'. Required by query, get_fragment and validate_asql.",
            ),
          columns: z
            .string()
            .optional()
            .describe(
              "Comma-separated ASQL column expressions, e.g. 'ID,Subject,[Expression-ObjectID]'. Aliases are supported ('expr AS Name'). Omit for Matrix42's default columns.",
            ),
          where: z
            .string()
            .optional()
            .describe(
              "ASQL filter expression, e.g. \"Subject LIKE '%printer%' AND T(SPSCommonClassBase).State.Value = 710\".",
            ),
          sort: z
            .string()
            .optional()
            .describe(
              "Sort expression, e.g. 'CreatedDate DESC'. Pass one whenever you page — without it, page boundaries are not stable.",
            ),
          page_size: z
            .number()
            .int()
            .optional()
            .describe(`Rows per page (default ${DEFAULT_PAGE_SIZE}).`),
          page: z.number().int().optional().describe('1-based page number (default 1).'),
          expression: z
            .string()
            .optional()
            .describe("The ASQL expression to check. Required for action='validate_asql'."),
          fragment_id: z
            .string()
            .optional()
            .describe("Fragment id. Required for action='get_fragment'."),
          ci_name: z
            .string()
            .optional()
            .describe(
              "Configuration item internal name, e.g. 'SPSActivityTypeIncident'. Required for action='get_object'.",
            ),
          object_id: z
            .string()
            .optional()
            .describe(
              "Object id — the value of [Expression-ObjectID] on a row. Required for action='get_object'.",
            ),
        }),
      },
      async ({
        action,
        class: className,
        columns,
        where,
        sort,
        page_size,
        page,
        expression,
        fragment_id,
        ci_name,
        object_id,
      }) => {
        try {
          switch (action) {
            case 'asql_guide':
              return textResult(ASQL_GUIDE);

            case 'validate_asql': {
              if (!className || !expression) {
                return errorResult(
                  "validate_asql needs both 'class' and 'expression'.",
                );
              }
              const result = await validateAsql(client, className, expression);
              return textResult(JSON.stringify(result));
            }

            case 'query': {
              if (!className) {
                return errorResult(
                  "class is required for action='query'. Find one with schema_discovery(action='list_data_definitions').",
                );
              }
              const result = await queryFragments(client, className, {
                columns,
                where,
                sort,
                pageSize: page_size,
                page,
              });
              return textResult(JSON.stringify(result));
            }

            case 'get_fragment': {
              if (!className || !fragment_id) {
                return errorResult("get_fragment needs both 'class' and 'fragment_id'.");
              }
              const row = await getFragment(client, className, fragment_id);
              return textResult(JSON.stringify(row, null, 2));
            }

            case 'get_object': {
              if (!ci_name || !object_id) {
                return errorResult("get_object needs both 'ci_name' and 'object_id'.");
              }
              const object = await getObject(client, ci_name, object_id);
              if (object === null) {
                return errorResult(
                  `No object ${object_id} of configuration item '${ci_name}'. The object id may belong to a different configuration item — check [Expression-ObjectID] and the class's usedInConfigurationItems.`,
                );
              }
              return textResult(JSON.stringify(object, null, 2));
            }
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return errorResult(
            `Query failed: ${reason}\nTip: validate the expression with action='validate_asql', and confirm attribute names with schema_discovery(action='describe_data_definition').`,
          );
        }
      },
    );
  },
};
