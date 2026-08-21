// src/tickets.ts — write operations: ticket lifecycle and journal entries.
//
// Every function here changes data in Matrix42. Side effects that reach people (notification
// e-mails, portal-visible comments) are never enabled implicitly — the caller must ask for them.

import type { M42Client } from './m42-client.js';
import { M42Error } from './m42-client.js';
import { compact, executePlan, type WritePlan } from './write-plan.js';

/**
 * Activity type ids that Ticket.Create rejects, with the name Matrix42 reports for each.
 *
 * The parameter does NOT follow SPSGlobalConfigurationPickupTicketType or any other pickup found on
 * the instance — this mapping was established by probing the API. Create only handles the ticket
 * family ("Ticket, Incident or Service Request" per its own documentation); the ids below belong to
 * other activity kinds and must be created through their own services.
 */
export const REJECTED_ACTIVITY_TYPES: Record<number, string> = {
  1: 'Problem',
  2: 'Change',
  3: 'Task',
  4: 'ApprovalTask',
};

/**
 * Activity type ids observed to be accepted by Ticket.Create. Verify per instance.
 *
 * Confirmed by creating one: id 6 yields a ticket numbered TCK…, but the instance reports its
 * configuration item as SPSActivityTypeServiceRequest — the number prefix and the configuration
 * item do not have to agree. Read TypeName back from the record rather than inferring it, since
 * take_over and forward need the real one.
 */
export const KNOWN_ACCEPTED_ACTIVITY_TYPES = [0, 5, 6] as const;

/** One named value substituted into a journal entry template. */
export interface JournalParameter {
  name: string;
  value: unknown;
  format?: string;
}

/**
 * Whether and how a newly created ticket is marked as API-raised.
 *
 * Creating through the API leaves none of the trace the web interface leaves, so a human opening
 * the ticket cannot tell where it came from. The note closes that gap.
 */
export interface AuditNoteOptions {
  enabled: boolean;
  /** How the assistant is identified. */
  label: string;
}

/** Outcome of the audit note, which never affects whether the ticket itself was created. */
export interface AuditNoteResult {
  added: boolean;
  journalId?: string;
  /** Why it could not be written, when it could not. */
  error?: string;
}

/**
 * The note's text.
 *
 * Deliberately factual: it records the channel, not a claim about who the requester is. It must
 * never read as though a named person wrote it.
 */
export function buildAuditNote(label: string): string {
  return (
    `Raised through the Matrix42 API by ${label}, not through the web interface. ` +
    'This note is an automatic record of the channel; it is internal and not shown in the portal.'
  );
}

/** Fields accepted when creating a ticket. */
export interface CreateTicketInput {
  /** Matrix42 activity type id. See KNOWN_ACCEPTED_ACTIVITY_TYPES. */
  activityType: number;
  subject: string;
  description?: string;
  descriptionHtml?: string;
  /** Initiator — the user the ticket is raised for (SPSUserClassBase fragment id). */
  initiator?: string;
  /** Category (SPSScCategoryClassBase fragment id). */
  category?: string;
  /** Pickup values; read the valid ones with schema_discovery(get_pickup_values). */
  priority?: number;
  impact?: number;
  urgency?: number;
  state?: number;
  /** Service the ticket concerns (SPSArticleClassBase fragment id). */
  service?: string;
  /** Anything else from TicketCreateInfo, passed through untouched. */
  extraFields?: Record<string, unknown>;
}

/** Fields accepted when closing tickets. */
export interface CloseTicketInput {
  /** OBJECT ids (the value of [Expression-ObjectID]), not fragment ids. */
  objectIds: string[];
  /** Solution text; HTML is accepted. */
  comments?: string;
  /** Closing reason — a value of SPSCommonPickupObjectStateReason. */
  reason?: number;
  /** Send a closure e-mail to the initiator. Off unless explicitly requested. */
  notifyInitiator?: boolean;
  /** Send a closure e-mail to the attached users. Off unless explicitly requested. */
  notifyUsers?: boolean;
  /** Notify the responsible agent. Off unless explicitly requested. */
  notifyResponsible?: boolean;
  /** Also close related incidents — a cascading change. Off unless explicitly requested. */
  closeRelatedIncidents?: boolean;
  /** Do not fail when a ticket is already closed. */
  skipFailIfAlreadyClosed?: boolean;
  extraFields?: Record<string, unknown>;
}

/** Fields accepted when adding a journal entry. */
export interface JournalEntryInput {
  /** OBJECT id the entry belongs to. */
  objectId: string;
  /** The entry text; HTML is accepted. */
  comments: string;
  /** Publish to the self-service portal, i.e. make it visible to the requester. Off by default. */
  visibleInPortal?: boolean;
  /** Entry type — a value of SPSJournalEntryPickupType (0 = None). */
  entryType?: number;
  /** Named values substituted into the entry's template. */
  parameters?: JournalParameter[];
  /** File ids to attach to the entry. */
  fileIds?: string[];
}

/** Plans creating a ticket. The activity-type guard lives here so a preview rejects it too. */
export function planCreateTicket(input: CreateTicketInput): WritePlan {
  const rejected = REJECTED_ACTIVITY_TYPES[input.activityType];
  if (rejected) {
    throw new M42Error(
      `Ticket.Create does not handle activity type ${input.activityType} (${rejected}). ` +
        `It creates tickets, incidents and service requests; ${rejected} has its own service.`,
    );
  }
  return {
    method: 'POST',
    path: `m42Services/api/ticket/Create?activityType=${input.activityType}`,
    body: compact({
      Subject: input.subject,
      Description: input.description,
      DescriptionHTML: input.descriptionHtml,
      User: input.initiator,
      Category: input.category,
      Priority: input.priority,
      Impact: input.impact,
      Urgency: input.urgency,
      State: input.state,
      Service: input.service,
      ...(input.extraFields ?? {}),
    }),
    summary: `Create a ticket of activity type ${input.activityType}: "${input.subject}"`,
    effects: ['Creates a real record that enters the service desk queue and may trigger workflows.'],
  };
}

/** Plans closing tickets, naming every consequence the caller opted into. */
export function planCloseTickets(input: CloseTicketInput): WritePlan {
  const effects: string[] = [];
  if (input.notifyInitiator) effects.push('Sends a closure e-mail to the initiator — a real person.');
  if (input.notifyUsers) effects.push('Sends a closure e-mail to the attached users — real people.');
  if (input.notifyResponsible) effects.push('Notifies the responsible agent.');
  if (input.closeRelatedIncidents) {
    effects.push('Also closes related incidents, cascading to other tickets.');
  }
  if (effects.length === 0) effects.push('No notifications are sent and nothing cascades.');

  return {
    method: 'POST',
    path: 'm42Services/api/ticket/Close',
    body: compact({
      ObjectIds: input.objectIds,
      Comments: input.comments,
      Reason: input.reason,
      SendMailToInitiator: input.notifyInitiator ?? false,
      SendMailToUsers: input.notifyUsers ?? false,
      NotifyResponsible: input.notifyResponsible ?? false,
      CloseRelatedIncidents: input.closeRelatedIncidents ?? false,
      SkipFailIfAlreadyClosed: input.skipFailIfAlreadyClosed ?? true,
      ...(input.extraFields ?? {}),
    }),
    summary: `Close ${input.objectIds.length} ticket(s)`,
    effects,
  };
}

/** Plans a journal entry, calling out portal visibility because it reaches the requester. */
export function planAddJournalEntry(input: JournalEntryInput): WritePlan {
  const visibleInPortal = input.visibleInPortal ?? false;
  return {
    method: 'POST',
    path: 'm42Services/api/journal/Add',
    body: compact({
      ObjectId: input.objectId,
      Comments: input.comments,
      VisibleInPortal: visibleInPortal,
      Publish: visibleInPortal,
      EntryType: input.entryType ?? 0,
      FileIds: input.fileIds,
      Parameters: input.parameters?.map((parameter) =>
        compact({ Name: parameter.name, Value: parameter.value, Format: parameter.format }),
      ),
    }),
    summary: visibleInPortal
      ? 'Add a journal entry and PUBLISH it to the self-service portal'
      : 'Add an internal journal entry',
    effects: [
      visibleInPortal
        ? 'The requester will see this text in their self-service portal.'
        : 'Internal only — the requester does not see this.',
    ],
  };
}

/**
 * Creates a ticket, incident or service request.
 *
 * Returns the new OBJECT id — the same identifier close_ticket and add_journal_entry expect, so the
 * three chain directly. It is NOT the fragment id: to read the record back, filter on
 * [Expression-ObjectID], not ID.
 */
export async function createTicket(
  client: M42Client,
  input: CreateTicketInput,
  auditNote?: AuditNoteOptions,
): Promise<{
  created: true;
  activityType: number;
  objectId: string;
  auditNote?: AuditNoteResult;
}> {
  const text = await executePlan(client, planCreateTicket(input));
  const objectId = text.trim().replace(/^"|"$/g, '');
  const created = { created: true, activityType: input.activityType, objectId } as const;

  if (!auditNote?.enabled) return created;
  // The ticket already exists. A failed note is reported, never raised: losing the audit trail is
  // worth far less than a caller believing the create failed and retrying it.
  try {
    const entry = await addJournalEntry(client, {
      objectId,
      comments: buildAuditNote(auditNote.label),
      visibleInPortal: false,
    });
    const note: AuditNoteResult = { added: true };
    if (entry.journalId) note.journalId = entry.journalId;
    return { ...created, auditNote: note };
  } catch (error) {
    return {
      ...created,
      auditNote: { added: false, error: error instanceof Error ? error.message : String(error) },
    };
  }
}

/** Closes one or more tickets. Notification e-mails are sent only when explicitly requested. */
export async function closeTickets(
  client: M42Client,
  input: CloseTicketInput,
): Promise<{ closed: true; objectIds: string[]; notificationsSent: boolean }> {
  const notificationsSent = Boolean(
    input.notifyInitiator || input.notifyUsers || input.notifyResponsible,
  );
  await executePlan(client, planCloseTickets(input));
  return { closed: true, objectIds: input.objectIds, notificationsSent };
}

/** Asks Matrix42 which ticket type a subject and description suggest. Changes nothing. */
export async function classifyTicket(
  client: M42Client,
  subject: string,
  description?: string,
): Promise<unknown> {
  const text = await executePlan(client, {
    method: 'POST',
    path: 'm42Services/api/ticket/Classify',
    body: { TicketSubject: subject, TicketDescription: description ?? '' },
    summary: 'Ask Matrix42 to suggest a ticket type',
    effects: [],
  });
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/** Adds a journal entry (a comment) to any object. Internal unless portal visibility is requested. */
export async function addJournalEntry(
  client: M42Client,
  input: JournalEntryInput,
): Promise<{ added: true; journalId?: string; visibleInPortal: boolean }> {
  const visibleInPortal = input.visibleInPortal ?? false;
  const text = await executePlan(client, planAddJournalEntry(input));
  let journalId: string | undefined;
  try {
    const parsed = JSON.parse(text) as { JournalId?: unknown };
    if (typeof parsed?.JournalId === 'string') journalId = parsed.JournalId;
  } catch {
    // The id is a convenience; a 2xx already means the entry was written.
  }
  return compact({ added: true, journalId, visibleInPortal }) as {
    added: true;
    journalId?: string;
    visibleInPortal: boolean;
  };
}
