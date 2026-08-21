// src/tickets.ts — write operations: ticket lifecycle and journal entries.
//
// Every function here changes data in Matrix42. Side effects that reach people (notification
// e-mails, portal-visible comments) are never enabled implicitly — the caller must ask for them.

import type { M42Client } from './m42-client.js';
import { M42Error } from './m42-client.js';

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
 * Confirmed by creating one: id 6 produces a Ticket (number prefix TCK).
 */
export const KNOWN_ACCEPTED_ACTIVITY_TYPES = [0, 5, 6] as const;

/** One named value substituted into a journal entry template. */
export interface JournalParameter {
  name: string;
  value: unknown;
  format?: string;
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

/** Removes undefined entries so Matrix42 receives only fields the caller actually set. */
function compact(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

/** Sends a write request and fails loudly on a non-2xx response. */
async function post(
  client: M42Client,
  path: string,
  body: Record<string, unknown>,
): Promise<string> {
  const { status, body: text } = await client.request('POST', path, JSON.stringify(body));
  if (status < 200 || status >= 300) {
    throw new M42Error(`Matrix42 returned HTTP ${status} for /${path}: ${text.slice(0, 400)}`, status);
  }
  return text;
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
): Promise<{ created: true; activityType: number; objectId: string }> {
  const info = compact({
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
  });
  const rejected = REJECTED_ACTIVITY_TYPES[input.activityType];
  if (rejected) {
    throw new M42Error(
      `Ticket.Create does not handle activity type ${input.activityType} (${rejected}). ` +
        `It creates tickets, incidents and service requests; ${rejected} has its own service.`,
    );
  }
  const text = await post(
    client,
    `m42Services/api/ticket/Create?activityType=${input.activityType}`,
    info,
  );
  const objectId = text.trim().replace(/^"|"$/g, '');
  return { created: true, activityType: input.activityType, objectId };
}

/** Closes one or more tickets. Notification e-mails are sent only when explicitly requested. */
export async function closeTickets(
  client: M42Client,
  input: CloseTicketInput,
): Promise<{ closed: true; objectIds: string[]; notificationsSent: boolean }> {
  const notificationsSent = Boolean(
    input.notifyInitiator || input.notifyUsers || input.notifyResponsible,
  );
  const body = compact({
    ObjectIds: input.objectIds,
    Comments: input.comments,
    Reason: input.reason,
    SendMailToInitiator: input.notifyInitiator ?? false,
    SendMailToUsers: input.notifyUsers ?? false,
    NotifyResponsible: input.notifyResponsible ?? false,
    CloseRelatedIncidents: input.closeRelatedIncidents ?? false,
    SkipFailIfAlreadyClosed: input.skipFailIfAlreadyClosed ?? true,
    ...(input.extraFields ?? {}),
  });
  await post(client, 'm42Services/api/ticket/Close', body);
  return { closed: true, objectIds: input.objectIds, notificationsSent };
}

/** Asks Matrix42 which ticket type a subject and description suggest. Changes nothing. */
export async function classifyTicket(
  client: M42Client,
  subject: string,
  description?: string,
): Promise<unknown> {
  const text = await post(client, 'm42Services/api/ticket/Classify', {
    TicketSubject: subject,
    TicketDescription: description ?? '',
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
  const body = compact({
    ObjectId: input.objectId,
    Comments: input.comments,
    VisibleInPortal: visibleInPortal,
    Publish: visibleInPortal,
    EntryType: input.entryType ?? 0,
    FileIds: input.fileIds,
    Parameters: input.parameters?.map((p) =>
      compact({ Name: p.name, Value: p.value, Format: p.format }),
    ),
  });
  const text = await post(client, 'm42Services/api/journal/Add', body);
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
