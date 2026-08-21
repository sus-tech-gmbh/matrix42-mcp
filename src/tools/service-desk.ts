// src/tools/service-desk.ts — ticket search, service levels, and the curated domain browser.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { ColumnCache } from '../columns.js';
import { DOMAINS, DOMAIN_NAMES, listDomain, searchEverywhere } from '../domains.js';
import { DOMAIN_GUIDE } from '../domain-guide.js';
import {
  TICKET_KINDS,
  getTicketInfo,
  searchTickets,
  slaTimeDuration,
  suitableSlasForTicket,
  type TicketKind,
} from '../service-desk.js';
import { type ToolContext, type ToolDefinition, textResult, errorResult } from './types.js';

const KIND_NAMES = Object.keys(TICKET_KINDS) as [TicketKind, ...TicketKind[]];

/** A one-line catalogue of the browsable domains, for the tool description. */
const DOMAIN_SUMMARY = Object.entries(DOMAINS)
  .map(([name, spec]) => `${name} (${spec.class})`)
  .join(', ');

/**
 * The service-desk read surface: ticket search across every kind, service-level answers, and a
 * curated browser over the base classes that carry Matrix42's functional areas.
 */
export const serviceDeskTool: ToolDefinition = {
  id: 'service_desk',
  summary: 'Search tickets of any kind, read service levels, and browse assets, contracts and more.',

  register(server: McpServer, { client }: ToolContext): void {
    const cache = new ColumnCache();

    server.registerTool(
      'service_desk',
      {
        title: 'Matrix42 service desk',
        description:
          "Read the service desk and the business objects around it. " +
          "action='data_model' explains how Matrix42's modules map onto a handful of base classes — read it first if you are unsure where something lives. " +
          "action='search_tickets' searches ANY ticket kind (incident, problem, change, task, service request, generic ticket, knowledge article) through one uniform filter that accepts PERSON AND CATEGORY NAMES directly, so no id lookups are needed; set only_mine with a user's fragment id for \"my tickets\". " +
          "action='get_ticket' returns one ticket's summary (it takes the OBJECT id — a fragment id answers null), action='sla_for_ticket' the service levels that apply to it, and action='sla_times' applies a service-level duration between two points in time. " +
          `action='browse' lists a curated domain: ${DOMAIN_SUMMARY}. ` +
          "action='find' searches ALL of those domains at once for a name — reach for it when you do not know where something lives. It does not cover tickets; search those with search_tickets. " +
          'Columns are resolved against this instance every time, so fields a module does not install are reported as unavailable rather than failing the call.',
        annotations: { readOnlyHint: true, openWorldHint: true },
        inputSchema: z.object({
          action: z
            .enum([
              'data_model',
              'search_tickets',
              'get_ticket',
              'sla_for_ticket',
              'sla_times',
              'browse',
              'find',
            ])
            .describe('What to do.'),

          kind: z
            .enum(KIND_NAMES)
            .optional()
            .describe("Ticket kind to search. Required for action='search_tickets'."),
          ticket_number: z.string().optional().describe('Filter by ticket number.'),
          subject: z.string().optional().describe('Filter by subject text.'),
          states: z
            .string()
            .optional()
            .describe('Comma-separated state ids to include. Read valid ids with schema_discovery(get_pickup_values).'),
          category_name: z.string().optional().describe('Filter by category NAME (no id needed).'),
          initiator_name: z.string().optional().describe('Filter by the initiating person NAME.'),
          recipient_name: z.string().optional().describe('Filter by the assigned person NAME.'),
          recipient_role_name: z.string().optional().describe('Filter by the responsible role NAME.'),
          asset_id: z.string().optional().describe('Filter by related asset id.'),
          service_id: z.string().optional().describe('Filter by related service id.'),
          only_mine: z
            .boolean()
            .optional()
            .describe('Restrict to items related to the user given in user_id.'),
          user_id: z
            .string()
            .optional()
            .describe("User fragment id for only_mine — server_info reports the authenticated account's."),

          ticket_object_id: z
            .string()
            .optional()
            .describe('Ticket OBJECT id, for get_ticket, sla_for_ticket and sla_times.'),

          domain: z
            .enum(DOMAIN_NAMES)
            .optional()
            .describe("Which curated domain to list. Required for action='browse'."),
          search: z
            .string()
            .optional()
            .describe(
              "Free-text filter, matched against a domain's searchable fields. Required for action='find'.",
            ),
          domains: z
            .array(z.enum(DOMAIN_NAMES))
            .optional()
            .describe("Restrict action='find' to these domains. Defaults to all of them."),
          where: z
            .string()
            .optional()
            .describe('Additional ASQL filter for browse. Use attribute names from schema_discovery(describe_data_definition).'),
          duration: z
            .number()
            .int()
            .optional()
            .describe("Duration in minutes to apply. Required by action='sla_times'."),
          begin: z.string().optional().describe("ISO start of the window, for action='sla_times'."),
          end: z.string().optional().describe("ISO end of the window, for action='sla_times'."),
          limit: z.number().int().optional().describe('Maximum rows to return (default 25).'),
        }),
      },
      async (args) => {
        try {
          switch (args.action) {
            case 'data_model':
              return textResult(DOMAIN_GUIDE);

            case 'search_tickets': {
              if (!args.kind) {
                return errorResult(
                  `kind is required for action='search_tickets'. One of: ${KIND_NAMES.join(', ')}.`,
                );
              }
              if (args.only_mine && !args.user_id) {
                return errorResult(
                  "only_mine needs 'user_id' — call server_info to get the authenticated account's fragment id.",
                );
              }
              const result = await searchTickets(client, {
                kind: args.kind,
                ticketNumber: args.ticket_number,
                subject: args.subject,
                states: args.states,
                categoryName: args.category_name,
                initiatorName: args.initiator_name,
                recipientName: args.recipient_name,
                recipientRoleName: args.recipient_role_name,
                assetId: args.asset_id,
                serviceId: args.service_id,
                onlyRelatedToCurrentUser: args.only_mine,
                currentUserId: args.user_id,
              });
              return textResult(JSON.stringify(result));
            }

            case 'get_ticket': {
              if (!args.ticket_object_id) return errorResult("get_ticket needs 'ticket_object_id'.");
              return textResult(JSON.stringify(await getTicketInfo(client, args.ticket_object_id), null, 2));
            }

            case 'sla_for_ticket': {
              if (!args.ticket_object_id) return errorResult("sla_for_ticket needs 'ticket_object_id'.");
              return textResult(JSON.stringify(await suitableSlasForTicket(client, args.ticket_object_id)));
            }

            case 'sla_times': {
              if (!args.ticket_object_id || args.duration === undefined) {
                return errorResult(
                  "sla_times needs 'ticket_object_id' and 'duration' (minutes). It applies a " +
                    'service-level duration to the activity rather than reporting a stored clock.',
                );
              }
              return textResult(
                JSON.stringify(
                  await slaTimeDuration(client, {
                    activityId: args.ticket_object_id,
                    duration: args.duration,
                    begin: args.begin,
                    end: args.end,
                  }),
                ),
              );
            }

            case 'find': {
              if (!args.search?.trim()) {
                return errorResult("find needs 'search' — the name, or part of a name, to look for.");
              }
              const found = await searchEverywhere(client, cache, args.search.trim(), {
                domains: args.domains,
                limit: args.limit,
              });
              return textResult(JSON.stringify(found));
            }

            case 'browse': {
              if (!args.domain) {
                return errorResult(
                  `domain is required for action='browse'. One of: ${DOMAIN_NAMES.join(', ')}.`,
                );
              }
              const result = await listDomain(client, cache, args.domain, {
                search: args.search,
                where: args.where,
                limit: args.limit,
              });
              return textResult(JSON.stringify(result));
            }
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return errorResult(
            `Service desk request failed: ${reason}\nTip: attribute names differ per instance — confirm them with schema_discovery(describe_data_definition).`,
          );
        }
      },
    );
  },
};
