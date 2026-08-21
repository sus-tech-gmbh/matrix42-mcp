// src/tools/ticket-actions.ts — write operations, exposed only when M42_ALLOW_WRITES is set.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  KNOWN_ACCEPTED_ACTIVITY_TYPES,
  addJournalEntry,
  classifyTicket,
  closeTickets,
  createTicket,
  planAddJournalEntry,
  planCloseTickets,
  planCreateTicket,
} from '../tickets.js';
import { previewPlan, type WritePlan } from '../write-plan.js';
import {
  WORK_ACTIVITY_TYPES,
  planForward,
  planPause,
  planReopen,
  planReturnToRole,
  planSetDeadline,
  planTakeOverOrAccept,
  planTrackWorkingTime,
  planTransform,
  transformTickets,
  forwardTickets,
  pauseTickets,
  reopenTickets,
  returnToRole,
  setDeadline,
  takeOverOrAccept,
  trackWorkingTime,
  type WorkActivityType,
} from '../ticket-verbs.js';
import { type ToolContext, type ToolDefinition, textResult, errorResult } from './types.js';

/**
 * The only tool that changes Matrix42 data. Registered exclusively when writes are enabled, so a
 * default deployment cannot modify anything even if a model asks it to.
 */
/** Arguments the planner reads. Kept loose so it can run before the switch narrows the action. */
interface PlannableArgs {
  action: string;
  activity_type?: number;
  subject?: string;
  description?: string;
  description_html?: string;
  initiator?: string;
  category?: string;
  service?: string;
  priority?: number;
  impact?: number;
  urgency?: number;
  state?: number;
  object_ids?: string[];
  object_id?: string;
  comments?: string;
  reason?: number;
  notify_initiator?: boolean;
  notify_users?: boolean;
  notify_responsible?: boolean;
  close_related_incidents?: boolean;
  visible_in_portal?: boolean;
  entry_type?: number;
  parameters?: { name: string; value: unknown; format?: string }[];
  file_ids?: string[];
  type_name?: string;
  role_id?: string;
  user_id?: string;
  ola_id?: string;
  reminder_date?: string;
  not_escalate_while_paused?: boolean;
  reason_text?: string;
  deadline?: string;
  minutes?: number;
  work_activity_type?: WorkActivityType;
  source_type_name?: string;
  target_type_name?: string;
  init_default_values?: boolean;
  sla?: string;
  ola?: string;
  recipient_role?: string;
  begin?: string;
  end?: string;
  extra_fields?: Record<string, unknown>;
}

/**
 * Builds the plan an action would execute, or null when required arguments are missing.
 *
 * This calls the same plan builders the execute path calls, so a preview is the request — not a
 * description of it that could fall out of step.
 */
function planFor(args: PlannableArgs): WritePlan | null {
  switch (args.action) {
    case 'create_ticket':
      if (args.activity_type === undefined || !args.subject) return null;
      return planCreateTicket({
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

    case 'close_ticket':
      if (!args.object_ids?.length) return null;
      return planCloseTickets({
        objectIds: args.object_ids,
        comments: args.comments,
        reason: args.reason,
        notifyInitiator: args.notify_initiator,
        notifyUsers: args.notify_users,
        notifyResponsible: args.notify_responsible,
        closeRelatedIncidents: args.close_related_incidents,
        extraFields: args.extra_fields,
      });

    case 'add_journal_entry':
      if (!args.object_id || !args.comments) return null;
      return planAddJournalEntry({
        objectId: args.object_id,
        comments: args.comments,
        visibleInPortal: args.visible_in_portal,
        entryType: args.entry_type,
        parameters: args.parameters,
        fileIds: args.file_ids,
      });

    case 'take_over':
    case 'accept':
      if (!args.object_ids?.length || !args.type_name) return null;
      return planTakeOverOrAccept(
        args.action === 'take_over' ? 'TakeOver' : 'Accept',
        args.object_ids,
        args.type_name,
      );

    case 'forward': {
      if (!args.object_ids?.length || !args.type_name) return null;
      if (!args.role_id && !args.user_id) return null;
      const typeName = args.type_name;
      return planForward({
        tickets: args.object_ids.map((objectId) => ({ typeName, objectId })),
        roleId: args.role_id,
        userId: args.user_id,
        olaId: args.ola_id,
        comments: args.comments,
      });
    }

    case 'pause':
      if (!args.object_ids?.length || !args.reminder_date) return null;
      return planPause({
        objectIds: args.object_ids,
        reminderDate: args.reminder_date,
        comments: args.comments,
        reason: args.reason,
        notEscalateWhilePaused: args.not_escalate_while_paused,
      });

    case 'reopen':
      if (!args.object_ids?.length) return null;
      return planReopen(args.object_ids, args.reason_text);

    case 'return_to_role':
      if (!args.object_id) return null;
      return planReturnToRole(args.object_id, args.comments);

    case 'set_deadline':
      if (!args.object_ids?.length || !args.deadline) return null;
      return planSetDeadline(args.object_ids, args.deadline);

    case 'transform':
      if (!args.object_ids?.length || !args.source_type_name || !args.target_type_name) return null;
      return planTransform({
        objectIds: args.object_ids,
        sourceTypeName: args.source_type_name,
        targetTypeName: args.target_type_name,
        initDefaultValues: args.init_default_values,
        category: args.category,
        sla: args.sla,
        ola: args.ola,
        recipientRole: args.recipient_role,
      });

    case 'track_working_time':
      if (
        !args.object_ids?.length ||
        args.minutes === undefined ||
        !args.work_activity_type ||
        !args.begin ||
        !args.end
      ) {
        return null;
      }
      return planTrackWorkingTime({
        objectIds: args.object_ids,
        minutes: args.minutes,
        description: args.description,
        activityType: args.work_activity_type,
        begin: args.begin,
        end: args.end,
      });

    default:
      return null;
  }
}

export const ticketActionsTool: ToolDefinition = {
  id: 'ticket_actions',
  summary: 'Run the ticket lifecycle: create, close, take over, forward, pause, reopen (requires writes).',

  register(server: McpServer, { client, config }: ToolContext): void {
    server.registerTool(
      'ticket_actions',
      {
        title: 'Matrix42 ticket actions',
        description:
          "MODIFIES Matrix42 data. Every action here previews first: called WITHOUT confirm:true it returns the exact request it would send and changes nothing, so show that preview to the user and only then call again with confirm:true. " +
          "action='create_ticket' creates a ticket, incident or service request and returns its OBJECT id, which close_ticket and add_journal_entry take directly. " +
          "action='close_ticket' closes one or more tickets by OBJECT id (the [Expression-ObjectID] value, not the fragment id) with an optional solution text and closing reason. " +
          "action='add_journal_entry' adds a comment to any object; it is INTERNAL unless visible_in_portal is set, which publishes it to the requester's self-service portal. " +
          "action='classify_ticket' only calculates a suggested ticket type from a subject and description and changes nothing. " +
          'A created ticket also gets an internal journal note recording that it was raised through this server, since creating through the API otherwise leaves no trace of where the ticket came from; pass audit_note:false to skip it. ' + +
"The lifecycle verbs work on OBJECT ids: take_over and accept claim tickets, forward hands them to a role or user, pause holds one (optionally stopping the escalation clock), reopen reverses a close, return_to_role gives it back, set_deadline sets the handling date, and track_working_time books effort. " +
          "action='transform' turns tickets into another type — an incident into a service request, say — which rewrites what the record IS and drops fields the target type does not have. " +
          'Notification e-mails are never sent unless you explicitly ask for them. Resolve pickup values with schema_discovery(get_pickup_values) and user, role or category ids with service_desk or data_query before calling.',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        inputSchema: z.object({
          action: z
            .enum([
              'create_ticket',
              'close_ticket',
              'add_journal_entry',
              'classify_ticket',
              'take_over',
              'accept',
              'forward',
              'pause',
              'reopen',
              'return_to_role',
              'set_deadline',
              'track_working_time',
              'transform',
            ])
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

          source_type_name: z
            .string()
            .optional()
            .describe(
              "Configuration item the tickets are today, for action='transform'. Read it back from a row rather than assuming it.",
            ),
          target_type_name: z
            .string()
            .optional()
            .describe("Configuration item to turn them into, for action='transform'."),
          init_default_values: z
            .boolean()
            .optional()
            .describe(
              'Re-initialise category, responsible role and service levels for the new type. Defaults to false, which keeps the current ones.',
            ),
          sla: z.string().optional().describe('SLA fragment id for the transformed ticket.'),
          ola: z.string().optional().describe('OLA fragment id for the transformed ticket.'),
          recipient_role: z
            .string()
            .optional()
            .describe('Responsible role fragment id for the transformed ticket.'),
          type_name: z
            .string()
            .optional()
            .describe(
              "Configuration item name of the tickets, e.g. 'SPSActivityTypeIncident'. Required by take_over and accept; a row's usedInConfigurationItems reports it.",
            ),
          role_id: z
            .string()
            .optional()
            .describe(
              'Target role id, for forward. It must be the SPSScRoleClassBase fragment id — the same role has a different id on SPSSecurityClassRole, and passing that one fails on a foreign key. Read it with data_query on SPSScRoleClassBase, pivoting for the name via T(SPSSecurityClassRole).Name.',
            ),
          user_id: z.string().optional().describe('Target user fragment id, for forward.'),
          ola_id: z.string().optional().describe('OLA id to apply when forwarding.'),
          reminder_date: z
            .string()
            .optional()
            .describe(
              'ISO date to be reminded. REQUIRED by pause: Matrix42 rejects a reminder date that is not in the future.',
            ),
          not_escalate_while_paused: z
            .boolean()
            .optional()
            .describe('Hold the escalation clock while paused. Defaults to false.'),
          reason_text: z.string().optional().describe('Free-text reason, for reopen.'),
          deadline: z.string().optional().describe('ISO date the ticket must be handled by, for set_deadline.'),
          minutes: z
            .number()
            .int()
            .optional()
            .describe('Minutes of work to book. REQUIRED by track_working_time.'),
          work_activity_type: z
            .enum(Object.keys(WORK_ACTIVITY_TYPES) as [WorkActivityType, ...WorkActivityType[]])
            .optional()
            .describe('What kind of work the tracked time was. REQUIRED by track_working_time.'),
          begin: z
            .string()
            .optional()
            .describe('ISO start of the tracked period. REQUIRED by track_working_time.'),
          end: z
            .string()
            .optional()
            .describe(
              'ISO end of the tracked period. REQUIRED by track_working_time, and must be after begin.',
            ),
          confirm: z
            .boolean()
            .optional()
            .describe(
              'Apply the change. Without it the call only previews the request and nothing is modified. Never set this on the user\'s behalf — show them the preview and let them decide.',
            ),
          dry_run: z
            .boolean()
            .optional()
            .describe('Force a preview even when confirm is set. Useful to re-check a payload.'),
          audit_note: z
            .boolean()
            .optional()
            .describe(
              'Write the internal "raised through the API" note on a created ticket. Defaults to the server setting (on unless M42_AUDIT_NOTE=0). Never portal-visible.',
            ),
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
          // classify_ticket only calculates a suggestion, so it is exempt from the confirm gate.
          const isWrite = args.action !== 'classify_ticket';
          const applying = args.confirm === true && args.dry_run !== true;

          if (isWrite && !applying) {
            const plan = planFor(args);
            if (!plan) {
              return errorResult(
                `Cannot preview '${args.action}': required arguments are missing. ` +
                  'Supply them and call again.',
              );
            }
            return textResult(JSON.stringify(previewPlan(plan), null, 2));
          }

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
              }, { enabled: args.audit_note ?? config.auditNote, label: config.agentLabel });
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

            case 'take_over':
            case 'accept': {
              if (!args.object_ids?.length || !args.type_name) {
                return errorResult(
                  `${args.action} needs 'object_ids' and 'type_name' (the configuration item of those tickets).`,
                );
              }
              const verb = args.action === 'take_over' ? 'TakeOver' : 'Accept';
              return textResult(
                JSON.stringify(await takeOverOrAccept(client, verb, args.object_ids, args.type_name)),
              );
            }

            case 'forward': {
              if (!args.object_ids?.length || !args.type_name) {
                return errorResult("forward needs 'object_ids' and 'type_name'.");
              }
              if (!args.role_id && !args.user_id) {
                return errorResult("forward needs a target: 'role_id' or 'user_id'.");
              }
              const tickets = args.object_ids.map((objectId) => ({
                typeName: args.type_name as string,
                objectId,
              }));
              return textResult(
                JSON.stringify(
                  await forwardTickets(client, {
                    tickets,
                    roleId: args.role_id,
                    userId: args.user_id,
                    olaId: args.ola_id,
                    comments: args.comments,
                  }),
                ),
              );
            }

            case 'pause': {
              if (!args.object_ids?.length || !args.reminder_date) {
                return errorResult(
                  "pause needs 'object_ids' and 'reminder_date'. Matrix42 rejects a pause whose " +
                    'reminder date is not in the future, so it cannot be left out.',
                );
              }
              return textResult(
                JSON.stringify(
                  await pauseTickets(client, {
                    objectIds: args.object_ids,
                    reminderDate: args.reminder_date,
                    comments: args.comments,
                    reason: args.reason,
                    notEscalateWhilePaused: args.not_escalate_while_paused,
                  }),
                ),
              );
            }

            case 'reopen': {
              if (!args.object_ids?.length) return errorResult("reopen needs 'object_ids'.");
              return textResult(
                JSON.stringify(await reopenTickets(client, args.object_ids, args.reason_text)),
              );
            }

            case 'return_to_role': {
              if (!args.object_id) {
                return errorResult("return_to_role needs 'object_id' (a single ticket).");
              }
              return textResult(
                JSON.stringify(await returnToRole(client, args.object_id, args.comments)),
              );
            }

            case 'set_deadline': {
              if (!args.object_ids?.length || !args.deadline) {
                return errorResult("set_deadline needs 'object_ids' and 'deadline'.");
              }
              return textResult(
                JSON.stringify(await setDeadline(client, args.object_ids, args.deadline)),
              );
            }

            case 'transform': {
              if (!args.object_ids?.length || !args.source_type_name || !args.target_type_name) {
                return errorResult(
                  "transform needs 'object_ids', 'source_type_name' and 'target_type_name'. Read the " +
                    "source type back from the ticket rather than assuming it — a row's usedInConfigurationItems reports it.",
                );
              }
              return textResult(
                JSON.stringify(
                  await transformTickets(client, {
                    objectIds: args.object_ids,
                    sourceTypeName: args.source_type_name,
                    targetTypeName: args.target_type_name,
                    initDefaultValues: args.init_default_values,
                    category: args.category,
                    sla: args.sla,
                    ola: args.ola,
                    recipientRole: args.recipient_role,
                  }),
                ),
              );
            }

            case 'track_working_time': {
              if (
                !args.object_ids?.length ||
                args.minutes === undefined ||
                !args.work_activity_type ||
                !args.begin ||
                !args.end
              ) {
                return errorResult(
                  "track_working_time needs 'object_ids', 'minutes', 'work_activity_type', 'begin' " +
                    "and 'end' — the contract marks all four of those mandatory, and 'end' must be " +
                    "after 'begin'.",
                );
              }
              return textResult(
                JSON.stringify(
                  await trackWorkingTime(client, {
                    objectIds: args.object_ids,
                    minutes: args.minutes,
                    description: args.description,
                    activityType: args.work_activity_type,
                    begin: args.begin,
                    end: args.end,
                  }),
                ),
              );
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
