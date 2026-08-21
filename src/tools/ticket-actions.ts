// src/tools/ticket-actions.ts — write operations, exposed only when M42_ALLOW_WRITES is set.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  KNOWN_ACCEPTED_ACTIVITY_TYPES,
  addJournalEntry,
  classifyTicket,
  closeTickets,
  createTicket,
} from '../tickets.js';
import { type ToolContext, type ToolDefinition, textResult, errorResult } from './types.js';

/**
 * The only tool that changes Matrix42 data. Registered exclusively when writes are enabled, so a
 * default deployment cannot modify anything even if a model asks it to.
 */
export const ticketActionsTool: ToolDefinition = {
  id: 'ticket_actions',
  summary: 'Create and close tickets, classify text, and add journal entries (requires writes).',

  register(server: McpServer, { client }: ToolContext): void {
    server.registerTool(
      'ticket_actions',
      {
        title: 'Matrix42 ticket actions',
        description:
          "MODIFIES Matrix42 data. action='create_ticket' creates a ticket, incident or service request and returns its OBJECT id, which close_ticket and add_journal_entry take directly. " +
          "action='close_ticket' closes one or more tickets by OBJECT id (the [Expression-ObjectID] value, not the fragment id) with an optional solution text and closing reason. " +
          "action='add_journal_entry' adds a comment to any object; it is INTERNAL unless visible_in_portal is set, which publishes it to the requester's self-service portal. " +
          "action='classify_ticket' only calculates a suggested ticket type from a subject and description and changes nothing. " +
          'Notification e-mails are never sent unless you explicitly ask for them. Resolve pickup values with schema_discovery(get_pickup_values) and user or category ids with data_query before calling.',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        inputSchema: z.object({
          action: z
            .enum(['create_ticket', 'close_ticket', 'add_journal_entry', 'classify_ticket'])
            .describe('Which operation to perform.'),

          activity_type: z
            .number()
            .int()
            .optional()
            .describe(
              `Matrix42 activity type id. Required for action='create_ticket'. This is an internal enum that does not match any schema pickup; ids ${KNOWN_ACCEPTED_ACTIVITY_TYPES.join(', ')} were accepted on tested instances, and Create only handles the ticket family. If an id is rejected, Matrix42 names the type it belongs to in the error.`,
            ),
          subject: z.string().optional().describe('Subject / summary line.'),
          description: z.string().optional().describe('Description in plain text.'),
          description_html: z.string().optional().describe('Description as HTML.'),
          initiator: z
            .string()
            .optional()
            .describe('Fragment id of the user the ticket is raised for (SPSUserClassBase).'),
          category: z
            .string()
            .optional()
            .describe('Fragment id of the category (SPSScCategoryClassBase).'),
          service: z
            .string()
            .optional()
            .describe('Fragment id of the affected service (SPSArticleClassBase).'),
          priority: z.number().int().optional().describe('Priority pickup value.'),
          impact: z.number().int().optional().describe('Impact pickup value.'),
          urgency: z.number().int().optional().describe('Urgency pickup value.'),
          state: z.number().int().optional().describe('State pickup value.'),

          object_ids: z
            .array(z.string())
            .optional()
            .describe(
              "OBJECT ids to close — the [Expression-ObjectID] of each ticket, not its fragment id. Required for action='close_ticket'.",
            ),
          comments: z
            .string()
            .optional()
            .describe(
              "Solution text when closing, or the entry text when adding a journal entry. HTML is accepted.",
            ),
          reason: z
            .number()
            .int()
            .optional()
            .describe('Closing reason — a value of the SPSCommonPickupObjectStateReason pickup.'),
          notify_initiator: z
            .boolean()
            .optional()
            .describe('Send a closure e-mail to the initiator. Defaults to false — this reaches a real person.'),
          notify_users: z
            .boolean()
            .optional()
            .describe('Send a closure e-mail to attached users. Defaults to false — this reaches real people.'),
          notify_responsible: z
            .boolean()
            .optional()
            .describe('Notify the responsible agent. Defaults to false.'),
          close_related_incidents: z
            .boolean()
            .optional()
            .describe('Also close related incidents. Defaults to false — this cascades to other tickets.'),

          object_id: z
            .string()
            .optional()
            .describe("Object id to attach the journal entry to. Required for action='add_journal_entry'."),
          visible_in_portal: z
            .boolean()
            .optional()
            .describe(
              'Publish the entry to the self-service portal, making it visible to the requester. Defaults to false (internal note).',
            ),
          entry_type: z
            .number()
            .int()
            .optional()
            .describe('Journal entry type — a value of the SPSJournalEntryPickupType pickup (0 = none).'),
          parameters: z
            .array(
              z.object({
                name: z.string(),
                value: z.unknown(),
                format: z.string().optional(),
              }),
            )
            .optional()
            .describe(
              'Named values substituted into the journal entry template, for entry types that expect them.',
            ),
          file_ids: z.array(z.string()).optional().describe('File ids to attach to the entry.'),

          extra_fields: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              'Additional raw contract fields passed through untouched, for anything these parameters do not cover.',
            ),
        }),
      },
      async (args) => {
        try {
          switch (args.action) {
            case 'create_ticket': {
              if (args.activity_type === undefined || !args.subject) {
                return errorResult("create_ticket needs 'activity_type' and 'subject'.");
              }
              const result = await createTicket(client, {
                activityType: args.activity_type,
                subject: args.subject,
                description: args.description,
                descriptionHtml: args.description_html,
                initiator: args.initiator,
                category: args.category,
                service: args.service,
                priority: args.priority,
                impact: args.impact,
                urgency: args.urgency,
                state: args.state,
                extraFields: args.extra_fields,
              });
              return textResult(JSON.stringify(result));
            }

            case 'close_ticket': {
              if (!args.object_ids?.length) {
                return errorResult(
                  "close_ticket needs 'object_ids' — the [Expression-ObjectID] of each ticket. Query them with data_query first.",
                );
              }
              const result = await closeTickets(client, {
                objectIds: args.object_ids,
                comments: args.comments,
                reason: args.reason,
                notifyInitiator: args.notify_initiator,
                notifyUsers: args.notify_users,
                notifyResponsible: args.notify_responsible,
                closeRelatedIncidents: args.close_related_incidents,
                extraFields: args.extra_fields,
              });
              return textResult(JSON.stringify(result));
            }

            case 'add_journal_entry': {
              if (!args.object_id || !args.comments) {
                return errorResult("add_journal_entry needs 'object_id' and 'comments'.");
              }
              const result = await addJournalEntry(client, {
                objectId: args.object_id,
                comments: args.comments,
                visibleInPortal: args.visible_in_portal,
                entryType: args.entry_type,
                parameters: args.parameters,
                fileIds: args.file_ids,
              });
              return textResult(JSON.stringify(result));
            }

            case 'classify_ticket': {
              if (!args.subject) return errorResult("classify_ticket needs 'subject'.");
              const result = await classifyTicket(client, args.subject, args.description);
              return textResult(JSON.stringify(result));
            }
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          return errorResult(`Action failed: ${reason}`);
        }
      },
    );
  },
};
