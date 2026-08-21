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
import { listAttachments, listJournal, listViews, runView } from '../objects.js';
import { buildDeepLink } from '../deep-links.js';
import { type ToolContext, type ToolDefinition, textResult, errorResult } from './types.js';

/**
 * Data access tool. Kept separate from schema_discovery so that exploring the model and reading
 * actual records are independently grantable via M42_TOOLS.
 */
export const dataQueryTool: ToolDefinition = {
  id: 'data_query',
  summary: 'Read records: query data definitions with ASQL filters, fetch fragments and objects.',

  register(server: McpServer, { client, config }: ToolContext): void {
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
          "action='list_views' lists the instance's saved data queries — curated, named views that already carry a predefined filter — and action='run_view' runs one; prefer a matching view over hand-written ASQL. " +
          "action='list_journal' returns an object's comment timeline and action='list_attachments' its files. " +
          "NEVER guess attribute names: read them with schema_discovery(describe_data_definition) before writing 'columns' or 'where', and use get_pickup_values for the valid values of any pickup you filter on.",
        annotations: { readOnlyHint: true, openWorldHint: true },
        inputSchema: z.object({
          action: z
            .enum([
              'asql_guide',
              'validate_asql',
              'query',
              'get_fragment',
              'get_object',
              'deep_link',
              'list_views',
              'run_view',
              'list_journal',
              'list_attachments',
            ])
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
              "Comma-separated ASQL column expressions, e.g. 'ID,Subject,[Expression-ObjectID]'. Use only attribute names reported by schema_discovery(describe_data_definition) — guessed names fail. Aliases are supported ('expr AS Name'). ID is added for you; do NOT request DisplayString (it is returned automatically and cannot be selected explicitly). Omit entirely for Matrix42's default columns.",
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
          link_kind: z
            .enum(['object', 'create'])
            .optional()
            .describe(
              "For action='deep_link': 'object' opens an existing record (default), 'create' opens a pre-filled creation form.",
            ),
          link_view_id: z
            .string()
            .optional()
            .describe("Optional view to open the object in, for action='deep_link'."),
          application: z
            .string()
            .optional()
            .describe(
              "UUX application hosting the creation form, e.g. 'ServiceDesk'. Used by link_kind='create'.",
            ),
          preset_params: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              'Values to pre-fill a creation form, keyed by data definition then attribute, e.g. {"SPSActivityClassBase":{"Initiator":"<user fragment id>"}}.',
            ),
          object_id: z
            .string()
            .optional()
            .describe(
              "Object id — the value of [Expression-ObjectID] on a row. Required for get_object, list_journal and list_attachments.",
            ),
          view_id: z
            .string()
            .optional()
            .describe("Id of a saved data query. Required for action='run_view'."),
          search: z
            .string()
            .optional()
            .describe('Filter saved views by name, description or class (list_views), or free-text search within a view (run_view).'),
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
        view_id,
        search,
        expression,
        fragment_id,
        ci_name,
        object_id,
        link_kind,
        link_view_id,
        application,
        preset_params,
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

            case 'list_views': {
              const views = await listViews(client, search);
              return textResult(JSON.stringify({ count: views.length, views }));
            }

            case 'run_view': {
              if (!view_id) {
                return errorResult(
                  "view_id is required for action='run_view'. Find one with action='list_views'.",
                );
              }
              const result = await runView(client, view_id, {
                pageSize: page_size,
                page,
                search,
              });
              return textResult(JSON.stringify(result));
            }

            case 'list_journal': {
              if (!object_id) return errorResult("object_id is required for action='list_journal'.");
              const journal = await listJournal(client, object_id, { count: page_size });
              return textResult(JSON.stringify(journal));
            }

            case 'list_attachments': {
              if (!object_id) {
                return errorResult("object_id is required for action='list_attachments'.");
              }
              const files = await listAttachments(client, object_id);
              return textResult(JSON.stringify(files));
            }

            case 'deep_link': {
              if (!ci_name) {
                return errorResult(
                  "deep_link needs 'ci_name' — the configuration item, e.g. SPSActivityTypeIncident.",
                );
              }
              try {
                const link = buildDeepLink({
                  kind: link_kind ?? 'object',
                  baseUrl: config.baseUrl,
                  typeName: ci_name,
                  objectId: object_id,
                  viewId: link_view_id,
                  application,
                  presetParams: preset_params,
                });
                return textResult(JSON.stringify(link, null, 2));
              } catch (error) {
                return errorResult(error instanceof Error ? error.message : String(error));
              }
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
