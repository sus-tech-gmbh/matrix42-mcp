// src/service-desk.ts — ticket search and service-level answers.
//
// Matrix42 exposes an identical Search contract on every ticket service, including filters by
// person NAME and an "only mine" flag. That is a better primitive than hand-written ASQL: no GUID
// lookups, no attribute guessing.

import type { M42Client } from './m42-client.js';

/** Ticket kinds that expose the uniform Search contract, mapped to their service route. */
export const TICKET_KINDS = {
  ticket: 'ticket',
  incident: 'incident',
  problem: 'problem',
  change: 'change',
  task: 'task',
  service_request: 'ServiceRequest',
  kb_article: 'kbarticle',
} as const;

export type TicketKind = keyof typeof TICKET_KINDS;

/** Filters accepted by the uniform Search contract. */
export interface TicketSearchInput {
  kind: TicketKind;
  ticketNumber?: string;
  subject?: string;
  /** Comma-separated state ids, as the contract expects. */
  states?: string;
  categoryName?: string;
  initiatorName?: string;
  recipientName?: string;
  recipientRoleName?: string;
  attachmentName?: string;
  assetId?: string;
  serviceId?: string;
  /** Restrict to items related to a specific user — pass their fragment id as currentUserId. */
  onlyRelatedToCurrentUser?: boolean;
  currentUserId?: string;
}

/** Drops undefined entries so only real filters reach the API. */
function compact(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === '') continue;
    out[key] = typeof value === 'boolean' ? String(value) : String(value);
  }
  return out;
}

/**
 * A filter that matches everything.
 *
 * Search refuses to run without criteria — with no parameters it answers 400 "advanced search
 * criterias are not valid" or a 500, depending on the ticket kind. A wildcard subject is the
 * cheapest way to say "no filter" in a language the contract accepts.
 */
export const MATCH_ALL_SUBJECT = '%';

/**
 * The parameters Matrix42 counts as actual search criteria.
 *
 * OnlyRelatedToCurrentUser and CurrentUserId are deliberately absent: they narrow a search but do
 * not constitute one, so a request carrying only those still fails the "no criteria" check.
 */
const CRITERIA_FIELDS = [
  'TicketNumber',
  'Subject',
  'States',
  'CategoryName',
  'InitiatorName',
  'RecipientName',
  'RecipientRoleName',
  'AttachmentName',
  'AssetId',
  'ServiceId',
];

/** Maps the tool's snake_case input onto the contract's field names. */
export function buildSearchQuery(input: TicketSearchInput): string {
  const query = new URLSearchParams(
    compact({
      TicketNumber: input.ticketNumber,
      Subject: input.subject,
      States: input.states,
      CategoryName: input.categoryName,
      InitiatorName: input.initiatorName,
      RecipientName: input.recipientName,
      RecipientRoleName: input.recipientRoleName,
      AttachmentName: input.attachmentName,
      AssetId: input.assetId,
      ServiceId: input.serviceId,
      OnlyRelatedToCurrentUser: input.onlyRelatedToCurrentUser,
      CurrentUserId: input.currentUserId,
    }),
  );
  if (!CRITERIA_FIELDS.some((field) => query.has(field))) {
    query.set('Subject', MATCH_ALL_SUBJECT);
  }
  return query.toString();
}

/**
 * Pulls the rows out of whichever envelope a ticket service used.
 *
 * The ticket services answer with { Tickets: [...] }; the knowledge base answers with
 * { KbArticles: [...], TicketClassName }. Reading only a generic key silently reports zero rows.
 */
export function unwrapSearchResult(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return raw;
  const envelope = raw as Record<string, unknown>;
  for (const key of ['Tickets', 'KbArticles', 'Results', 'Items']) {
    if (Array.isArray(envelope[key])) return envelope[key];
  }
  return raw;
}

/** Result rows of a ticket search, trimmed to the fields worth showing. */
export interface TicketSearchResult {
  kind: TicketKind;
  count: number;
  results: unknown;
}

/**
 * Searches one ticket kind.
 *
 * Every kind shares this contract, so the same filters work for incidents, problems, changes,
 * tasks, service requests and knowledge articles.
 */
export async function searchTickets(
  client: M42Client,
  input: TicketSearchInput,
): Promise<TicketSearchResult> {
  const route = TICKET_KINDS[input.kind];
  const query = buildSearchQuery(input);
  const raw = await client.getJson<unknown>(
    `m42Services/api/${route}/Search${query ? `?${query}` : ''}`,
  );
  const rows = unwrapSearchResult(raw);
  const count = Array.isArray(rows) ? rows.length : 0;
  return { kind: input.kind, count, results: rows };
}

// ── Service levels ──────────────────────────────────────────────────────────

/** Which service level agreements apply to a ticket, as Matrix42 itself computes them. */
export async function suitableSlasForTicket(
  client: M42Client,
  ticketObjectId: string,
): Promise<unknown> {
  const params = new URLSearchParams({ ticketId: ticketObjectId });
  return client.getJson<unknown>(`m42Services/api/activity/suitableSLAsForTicket?${params.toString()}`);
}

/**
 * Applies a service-level duration to an activity between two points in time.
 *
 * The parameter is activityId, not ticketId: sending ticketId made Matrix42 fall through to the
 * catch-all route api/activity/{ticketObjectId} and complain about a parameter this operation does
 * not even have — which is why the error named something absent from the contract.
 */
export async function slaTimeDuration(
  client: M42Client,
  input: { activityId: string; duration: number; begin?: string; end?: string },
): Promise<unknown> {
  const params = new URLSearchParams({
    activityId: input.activityId,
    duration: String(input.duration),
  });
  if (input.begin) params.set('Begin', input.begin);
  if (input.end) params.set('End', input.end);
  return client.getJson<unknown>(`m42Services/api/activity/SLATimeDurationInfo?${params.toString()}`);
}

/** Summary of a ticket as the service desk sees it. */
export async function getTicketInfo(client: M42Client, ticketObjectId: string): Promise<unknown> {
  return client.getJson<unknown>(
    `m42Services/api/activity/${encodeURIComponent(ticketObjectId)}`,
  );
}
