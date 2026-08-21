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
 * The filters the Search contract actually APPLIES.
 *
 * Established by sending each one a value that matches nothing and comparing the row count with an
 * unfiltered search: Subject, CategoryName and States narrow the result, while TicketNumber,
 * InitiatorName, RecipientName, RecipientRoleName, AssetId and ServiceId return the full set
 * unchanged. Matrix42 accepts those six and ignores them.
 *
 * That silence is the danger: a caller asking for one person's tickets would be handed everyone's
 * and have no way to tell. Anything not listed here is refused rather than sent.
 */
export const HONOURED_FILTERS = ['Subject', 'CategoryName', 'States'] as const;

/**
 * The filters that constitute a search on their own.
 *
 * Search refuses to run without criteria, and States is not enough by itself — it answers 400
 * "the advanced search criterias are not valid" — so it travels with a match-all subject.
 *
 * OnlyRelatedToCurrentUser and CurrentUserId narrow a search but never constitute one.
 */
const CRITERIA_FIELDS = ['Subject', 'CategoryName'];

/** Filters Matrix42 declares but does not honour, with what to use instead. */
const IGNORED_FILTERS: Record<string, string> = {
  ticketNumber: 'ticket_number',
  initiatorName: 'initiator_name',
  recipientName: 'recipient_name',
  recipientRoleName: 'recipient_role_name',
  attachmentName: 'attachment_name',
  assetId: 'asset_id',
  serviceId: 'service_id',
};

/**
 * Rejects a filter Matrix42 would silently drop.
 *
 * Returning unfiltered rows for a filtered request is worse than failing: the caller reports the
 * wrong answer with full confidence. The message names the alternative that does work.
 */
export function rejectIgnoredFilters(input: TicketSearchInput): string | null {
  const used = Object.entries(IGNORED_FILTERS)
    .filter(([key]) => {
      const value = (input as unknown as Record<string, unknown>)[key];
      return typeof value === 'string' && value.trim() !== '';
    })
    .map(([, name]) => name);

  if (used.length === 0) return null;
  return (
    `Matrix42's ticket Search accepts ${used.join(', ')} but does not apply ${used.length > 1 ? 'them' : 'it'} — ` +
    'the request would return every ticket, which is worse than failing. Only subject, ' +
    'category_name and states actually filter here.\n\n' +
    'These DO work through data_query, because the underlying columns are relations you can ' +
    'traverse in ASQL:\n\n' +
"  ticket_number        TicketNumber = 'TCK00154'   (or LIKE 'TCK001%')\n  initiator_name       Initiator.LastName = 'Fruhmann'   (Initiator is a relation to\n                       SPSUserClassBase, so traverse it — FirstName and MailAddress work too)\n  recipient_name       Recipient.LastName = 'Fruhmann'\n  recipient_role_name  RecipientRole.T(SPSSecurityClassRole).Name = 'Ticket Management'\n                       (SPSScRoleClassBase carries no attributes of its own)\n  asset_id             Asset.ID = '<guid>'\n  service_id           Service.ID = '<guid>'" + '\n\n' +
    "For example: data_query(action='query', class='SPSActivityClassBase', " +
    "columns='TicketNumber,Subject', where=\"Initiator.LastName = 'Fruhmann'\").\n" +
    'Confirm the attribute names for this instance with ' +
    "schema_discovery(action='describe_data_definition', include='both'), and check " +
    "data_query(action='validate_asql') before running a filter you are unsure of."
  );
}

/** Maps the tool's snake_case input onto the contract's field names. */
export function buildSearchQuery(input: TicketSearchInput): string {
  const query = new URLSearchParams(
    compact({
      // Only the filters Matrix42 honours are sent; the rest are refused above rather than
      // quietly dropped, so a caller never believes a filter was applied when it was not.
      Subject: input.subject,
      States: input.states,
      CategoryName: input.categoryName,
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
  const refusal = rejectIgnoredFilters(input);
  if (refusal) throw new Error(refusal);

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
