// src/tools/schema-discovery.ts — lets a model explore the Matrix42 data model.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { SCHEMA_OVERVIEW } from '../schema-overview.js';
import {
  SchemaCache,
  describeConfigurationItem,
  describeDataDefinition,
  findPickupClass,
  getPickupValues,
  listConfigurationItems,
  listDataDefinitions,
  type DetailInclude,
} from '../schema.js';
import { type ToolContext, type ToolDefinition, textResult, errorResult } from './types.js';

/** Default number of listing entries returned when the caller does not specify a limit. */
export const DEFAULT_SCHEMA_LIMIT = 100;

/** Caps a listing, reporting the true total so the model knows when it is seeing a subset. */
export function limitList<T>(
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

/** Wraps a capped listing in the envelope the tool returns. */
function listingResult<T>(key: string, items: T[], limit: number, searched: boolean): string {
  const { returned, total, truncated } = limitList(items, limit);
  return JSON.stringify({
    count: returned.length,
    total,
    ...(truncated
      ? {
          truncated: true,
          hint: searched
            ? `Showing ${returned.length} of ${total} matches. Narrow the search or raise 'limit' (0 = no limit).`
            : `Showing ${returned.length} of ${total}. Pass a 'search' term or raise 'limit' (0 = no limit).`,
        }
      : {}),
    [key]: returned,
  });
}

/** Schema exploration tool: data definitions, configuration items, and pickup values. */
export const schemaDiscoveryTool: ToolDefinition = {
  id: 'schema_discovery',
  summary: 'Explore the data model: data definitions, configuration items, attributes, pickups.',

  register(server: McpServer, { client }: ToolContext): void {
    const cache = new SchemaCache();

    server.registerTool(
      'schema_discovery',
      {
        title: 'Matrix42 schema discovery',
        description:
          "Explore the Matrix42 data model of the connected instance (read-only metadata). " +
          "action='schema_overview' explains how the model fits together (data definitions vs configuration items, fragments, cardinality, pickups) — read this first. " +
          "action='list_data_definitions' and action='list_configuration_items' find schema objects by 'search' term. " +
          "action='describe_data_definition' returns a definition's attributes (add include='relations' or 'both' for its relations). " +
          "action='describe_configuration_item' returns the data definitions an object is composed of, with cardinality and multi-fragment flags. " +
          "action='get_pickup_values' returns the selectable values of a pickup — either pass 'pickup_class', or 'name' plus 'attribute' to resolve it. " +
          'Typical flow: schema_overview → list_* (search) → describe_* → get_pickup_values before filtering on a pickup.',
        annotations: { readOnlyHint: true, openWorldHint: true },
        inputSchema: z.object({
          action: z
            .enum([
              'schema_overview',
              'list_data_definitions',
              'list_configuration_items',
              'describe_data_definition',
              'describe_configuration_item',
              'get_pickup_values',
            ])
            .describe('Which schema question to answer.'),
          search: z
            .string()
            .optional()
            .describe(
              'Case-insensitive filter over internal name, display name, and description. Used by the list_* actions.',
            ),
          name: z
            .string()
            .optional()
            .describe(
              "Internal name of the data definition or configuration item to describe (e.g. 'SPSUserClassBase'). Required by the describe_* actions, and usable with get_pickup_values together with 'attribute'.",
            ),
          include: z
            .enum(['attributes', 'relations', 'both'])
            .optional()
            .describe(
              "For describe_data_definition: which parts to return. Defaults to 'attributes' because a central definition can have well over a hundred relations.",
            ),
          include_pickups: z
            .boolean()
            .optional()
            .describe(
              'For list_data_definitions: include pickup classes, which are excluded by default because they are numerous and rarely browsed directly.',
            ),
          attribute: z
            .string()
            .optional()
            .describe(
              "For get_pickup_values: the pickup attribute on 'name' whose values you want (e.g. name='SPSUserClassBase', attribute='UserType').",
            ),
          pickup_class: z
            .string()
            .optional()
            .describe(
              "For get_pickup_values: the pickup class directly, when you already know it from describe_data_definition.",
            ),
          limit: z
            .number()
            .int()
            .optional()
            .describe(
              `Maximum number of listing entries to return (default ${DEFAULT_SCHEMA_LIMIT}, 0 = no limit). Used by the list_* actions.`,
            ),
        }),
      },
      async ({ action, search, name, include, include_pickups, attribute, pickup_class, limit }) => {
        try {
          switch (action) {
            case 'schema_overview':
              return textResult(SCHEMA_OVERVIEW);

            case 'list_data_definitions': {
              const entries = await listDataDefinitions(client, cache, {
                search,
                includePickups: include_pickups,
              });
              return textResult(
                listingResult('dataDefinitions', entries, limit ?? DEFAULT_SCHEMA_LIMIT, Boolean(search)),
              );
            }

            case 'list_configuration_items': {
              const entries = await listConfigurationItems(client, cache, { search });
              return textResult(
                listingResult(
                  'configurationItems',
                  entries,
                  limit ?? DEFAULT_SCHEMA_LIMIT,
                  Boolean(search),
                ),
              );
            }

            case 'describe_data_definition': {
              if (!name) {
                return errorResult(
                  "name is required for action='describe_data_definition'. Find one with action='list_data_definitions'.",
                );
              }
              const detail = await describeDataDefinition(
                client,
                name,
                (include ?? 'attributes') as DetailInclude,
              );
              return textResult(JSON.stringify(detail, null, 2));
            }

            case 'describe_configuration_item': {
              if (!name) {
                return errorResult(
                  "name is required for action='describe_configuration_item'. Find one with action='list_configuration_items'.",
                );
              }
              const detail = await describeConfigurationItem(client, name);
              return textResult(JSON.stringify(detail, null, 2));
            }

            case 'get_pickup_values': {
              let target = pickup_class;
              if (!target) {
                if (!name || !attribute) {
                  return errorResult(
                    "get_pickup_values needs either 'pickup_class', or both 'name' and 'attribute' to resolve it.",
                  );
                }
                target = await findPickupClass(client, name, attribute);
              }
              const values = await getPickupValues(client, target);
              return textResult(JSON.stringify(values));
            }
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return errorResult(`Schema lookup failed: ${reason}`);
        }
      },
    );
  },
};
