// test/service-desk.test.ts — unit tests for ticket search, service levels and lifecycle verbs.

import { describe, expect, it, vi } from 'vitest';
import {
  HONOURED_FILTERS,
  MATCH_ALL_SUBJECT,
  TICKET_KINDS,
  buildSearchQuery,
  rejectIgnoredFilters,
  unwrapSearchResult,
  getTicketInfo,
  searchTickets,
  slaTimeDuration,
  suitableSlasForTicket,
} from '../src/service-desk.js';
import {
  WORK_ACTIVITY_TYPES,
  forwardTickets,
  pauseTickets,
  reopenTickets,
  returnToRole,
  setDeadline,
  planTransform,
  takeOverOrAccept,
  trackWorkingTime,
} from '../src/ticket-verbs.js';
import type { M42Client } from '../src/m42-client.js';

/** A client that records read URLs and answers with a canned payload. */
function readClient(payload: unknown = []) {
  const urls: string[] = [];
  const getJson = vi.fn(async (path: string) => {
    urls.push(path);
    return payload;
  });
  return { client: { getJson } as unknown as M42Client, urls };
}

/** A client that records POSTs and answers 200 unless a status is supplied. */
function writeClient(status = 200, body = '{}') {
  const calls: { path: string; body: unknown }[] = [];
  const request = vi.fn(async (_method: string, path: string, raw?: string) => {
    calls.push({ path, body: raw ? JSON.parse(raw) : undefined });
    return { status, body };
  });
  return { client: { request } as unknown as M42Client, calls };
}

describe('TICKET_KINDS', () => {
  it('covers every kind the uniform Search contract is exposed on', () => {
    expect(Object.keys(TICKET_KINDS).sort()).toEqual(
      ['change', 'incident', 'kb_article', 'problem', 'service_request', 'task', 'ticket'].sort(),
    );
  });

  it('maps the kinds whose route differs from their name', () => {
    expect(TICKET_KINDS.service_request).toBe('ServiceRequest');
    expect(TICKET_KINDS.kb_article).toBe('kbarticle');
  });
});

describe('buildSearchQuery', () => {
  it('maps the honoured filters onto the contract field names', () => {
    const params = new URLSearchParams(
      buildSearchQuery({ kind: 'incident', subject: 'printer', states: '1,2', categoryName: 'Hardware' }),
    );
    expect(params.get('Subject')).toBe('printer');
    expect(params.get('States')).toBe('1,2');
    expect(params.get('CategoryName')).toBe('Hardware');
  });

  it('sends nothing Matrix42 would ignore', () => {
    // Sending an ignored filter is what made an unfiltered result look filtered.
    const params = new URLSearchParams(
      buildSearchQuery({ kind: 'ticket', subject: 'x', initiatorName: 'Ada', ticketNumber: 'T1' }),
    );
    expect(params.get('InitiatorName')).toBeNull();
    expect(params.get('TicketNumber')).toBeNull();
  });

  it('omits filters that were not supplied', () => {
    const params = new URLSearchParams(buildSearchQuery({ kind: 'ticket', subject: 'x' }));
    expect(params.get('InitiatorName')).toBeNull();
    expect([...params.keys()]).toEqual(['Subject']);
  });

  it('falls back to a match-all subject, because Search refuses to run with no criteria', () => {
    expect(buildSearchQuery({ kind: 'ticket' })).toBe(`Subject=${encodeURIComponent(MATCH_ALL_SUBJECT)}`);
    expect(buildSearchQuery({ kind: 'ticket', subject: '' })).toBe(
      `Subject=${encodeURIComponent(MATCH_ALL_SUBJECT)}`,
    );
  });

  it('does not add the fallback once a field that stands alone is present', () => {
    expect(
      new URLSearchParams(buildSearchQuery({ kind: 'ticket', categoryName: 'Hardware' })).get('Subject'),
    ).toBeNull();
  });

  it('companions States with a match-all subject, since it cannot stand alone', () => {
    const params = new URLSearchParams(buildSearchQuery({ kind: 'ticket', states: '200' }));
    expect(params.get('Subject')).toBe(MATCH_ALL_SUBJECT);
  });

  it('keeps a honoured filter alongside the fallback', () => {
    const params = new URLSearchParams(buildSearchQuery({ kind: 'ticket', states: '200' }));
    expect(params.get('States')).toBe('200');
    expect(params.get('Subject')).toBe(MATCH_ALL_SUBJECT);
  });

  it('sends the "my items" flag together with the user it applies to', () => {
    const params = new URLSearchParams(
      buildSearchQuery({ kind: 'ticket', onlyRelatedToCurrentUser: true, currentUserId: 'u1' }),
    );
    expect(params.get('OnlyRelatedToCurrentUser')).toBe('true');
    expect(params.get('CurrentUserId')).toBe('u1');
  });

  it('escapes a value so it survives as one filter', () => {
    const params = new URLSearchParams(buildSearchQuery({ kind: 'ticket', categoryName: 'A & B' }));
    expect(params.get('CategoryName')).toBe('A & B');
  });
});

describe('searchTickets', () => {
  it('calls the Search route of the requested kind', async () => {
    const { client, urls } = readClient([]);
    await searchTickets(client, { kind: 'service_request', subject: 'vpn' });
    expect(urls[0]).toBe('m42Services/api/ServiceRequest/Search?Subject=vpn');
  });

  it('always sends criteria, since a bare Search answers 400 or 500 depending on the kind', async () => {
    const { client, urls } = readClient([]);
    await searchTickets(client, { kind: 'incident' });
    expect(urls[0]).toBe('m42Services/api/incident/Search?Subject=%25');
  });

  it('counts the rows a search returned', async () => {
    const { client } = readClient([{ a: 1 }, { a: 2 }]);
    const result = await searchTickets(client, { kind: 'ticket' });
    expect(result.count).toBe(2);
    expect(result.kind).toBe('ticket');
  });

  it('unwraps a result envelope when the service returns one', async () => {
    const { client } = readClient({ Results: [{ a: 1 }] });
    const result = await searchTickets(client, { kind: 'ticket' });
    expect(result.count).toBe(1);
    expect(result.results).toEqual([{ a: 1 }]);
  });

  it('reports zero rather than failing on an unexpected payload', async () => {
    const { client } = readClient({ unexpected: true });
    expect((await searchTickets(client, { kind: 'ticket' })).count).toBe(0);
  });
});

describe('service levels', () => {
  it('asks Matrix42 which SLAs apply, instead of computing it locally', async () => {
    const { client, urls } = readClient({});
    await suitableSlasForTicket(client, 'obj-1');
    expect(urls[0]).toBe('m42Services/api/activity/suitableSLAsForTicket?ticketId=obj-1');
  });

  it('names the activity, not the ticket — ticketId belongs to a different operation', async () => {
    const { client, urls } = readClient({});
    await slaTimeDuration(client, { activityId: 'obj-1', duration: 60 });
    expect(urls[0]).toBe('m42Services/api/activity/SLATimeDurationInfo?activityId=obj-1&duration=60');
  });

  it('passes an optional window through', async () => {
    const { client, urls } = readClient({});
    await slaTimeDuration(client, {
      activityId: 'obj-1',
      duration: 30,
      begin: '2026-01-01T08:00:00Z',
      end: '2026-01-01T09:00:00Z',
    });
    expect(urls[0]).toContain('Begin=2026-01-01T08%3A00%3A00Z');
    expect(urls[0]).toContain('End=2026-01-01T09%3A00%3A00Z');
  });

  it('escapes an object id into the ticket-info path', async () => {
    const { client, urls } = readClient({});
    await getTicketInfo(client, 'a/b');
    expect(urls[0]).toBe('m42Services/api/activity/a%2Fb');
  });
});

describe('lifecycle verbs', () => {
  it('sends take-over in the generic object-request shape', async () => {
    const { client, calls } = writeClient();
    await takeOverOrAccept(client, 'TakeOver', ['o1', 'o2'], 'SPSActivityTypeIncident');
    expect(calls[0]?.path).toBe('m42Services/api/activity/TakeOver');
    expect(calls[0]?.body).toEqual({
      Objects: [{ ObjectIds: ['o1', 'o2'], TypeName: 'SPSActivityTypeIncident' }],
    });
  });

  it('uses the Accept route when accepting', async () => {
    const { client, calls } = writeClient();
    await takeOverOrAccept(client, 'Accept', ['o1'], 'T');
    expect(calls[0]?.path).toBe('m42Services/api/activity/Accept');
  });

  it('raises the Matrix42 error text on a non-2xx response', async () => {
    const { client } = writeClient(500, 'Activity type Problem is not supported');
    await expect(takeOverOrAccept(client, 'TakeOver', ['o1'], 'T')).rejects.toThrow(
      /HTTP 500.*not supported/,
    );
  });

  it('models each forwarded ticket as a type/id tuple', async () => {
    const { client, calls } = writeClient();
    await forwardTickets(client, {
      tickets: [{ typeName: 'T', objectId: 'o1' }],
      roleId: 'r1',
      comments: 'over to you',
    });
    expect(calls[0]?.body).toEqual({
      Tickets: [{ Item1: 'T', Item2: 'o1' }],
      RoleID: 'r1',
      Comments: 'over to you',
    });
  });

  it('refuses a forward with no target before making a request', async () => {
    const { client, calls } = writeClient();
    await expect(
      forwardTickets(client, { tickets: [{ typeName: 'T', objectId: 'o1' }] }),
    ).rejects.toThrow(/role_id or user_id/);
    expect(calls).toHaveLength(0);
  });

  it('holds the escalation clock only when asked', async () => {
    const { client, calls } = writeClient();
    const base = { objectIds: ['o1'], reminderDate: '2030-01-01T00:00:00Z' };
    await pauseTickets(client, base);
    expect(calls[0]?.body).toMatchObject({ NotEscalateWhilePaused: false });

    await pauseTickets(client, { ...base, notEscalateWhilePaused: true });
    expect(calls[1]?.body).toMatchObject({ NotEscalateWhilePaused: true });
  });

  it('always sends a reminder date, which the server requires despite the contract', async () => {
    const { client, calls } = writeClient();
    await pauseTickets(client, { objectIds: ['o1'], reminderDate: '2030-01-01T00:00:00Z' });
    expect(calls[0]?.body).toMatchObject({ ReminderDate: '2030-01-01T00:00:00Z' });
  });

  it('omits pause fields the caller left unset', async () => {
    const { client, calls } = writeClient();
    await pauseTickets(client, { objectIds: ['o1'], reminderDate: '2030-01-01T00:00:00Z' });
    expect(calls[0]?.body).not.toHaveProperty('Comments');
    expect(calls[0]?.body).not.toHaveProperty('Reason');
  });

  it('reopens tickets with an optional reason', async () => {
    const { client, calls } = writeClient();
    await reopenTickets(client, ['o1'], 'came back');
    expect(calls[0]?.path).toBe('m42Services/api/activity/Reopen');
    expect(calls[0]?.body).toEqual({ ObjectIds: ['o1'], Reason: 'came back' });
  });

  it('returns a single ticket to its role', async () => {
    const { client, calls } = writeClient();
    await returnToRole(client, 'o1', 'not mine');
    expect(calls[0]?.body).toEqual({ TicketId: 'o1', Comments: 'not mine' });
  });

  it('sets a deadline on every listed ticket', async () => {
    const { client, calls } = writeClient();
    const result = await setDeadline(client, ['o1', 'o2'], '2026-01-01T00:00:00Z');
    expect(calls[0]?.body).toEqual({
      ObjectIds: ['o1', 'o2'],
      Deadline: '2026-01-01T00:00:00Z',
    });
    expect(result.deadline).toBe('2026-01-01T00:00:00Z');
  });

  it('translates a work activity name to the id the contract expects', async () => {
    const { client, calls } = writeClient();
    await trackWorkingTime(client, {
      objectIds: ['o1'],
      minutes: 30,
      activityType: 'investigation',
      begin: '2026-01-01T08:00:00Z',
      end: '2026-01-01T08:30:00Z',
    });
    expect(calls[0]?.body).toMatchObject({
      Minutes: 30,
      ActivityType: WORK_ACTIVITY_TYPES.investigation,
    });
  });

  it('always sends the four fields the contract marks mandatory', async () => {
    const { client, calls } = writeClient();
    await trackWorkingTime(client, {
      objectIds: ['o1'],
      minutes: 0,
      activityType: 'other',
      begin: '2026-01-01T08:00:00Z',
      end: '2026-01-01T08:30:00Z',
    });
    const body = calls[0]?.body ?? {};
    expect(body).toMatchObject({ Minutes: 0, ActivityType: WORK_ACTIVITY_TYPES.other });
    expect(body).toHaveProperty('Begin');
    expect(body).toHaveProperty('End');
  });
});

describe('unwrapSearchResult', () => {
  it('reads the Tickets envelope the ticket services answer with', () => {
    expect(unwrapSearchResult({ Tickets: [{ a: 1 }] })).toEqual([{ a: 1 }]);
  });

  it('reads the KbArticles envelope, which the knowledge base uses instead', () => {
    expect(unwrapSearchResult({ KbArticles: [{ a: 1 }], TicketClassName: 'x' })).toEqual([{ a: 1 }]);
  });

  it('passes a bare array through', () => {
    expect(unwrapSearchResult([{ a: 1 }])).toEqual([{ a: 1 }]);
  });

  it('returns an empty list rather than pretending there were no results', () => {
    expect(unwrapSearchResult({ Tickets: [] })).toEqual([]);
  });

  it('hands back anything it does not recognise, instead of silently reporting zero', () => {
    expect(unwrapSearchResult({ unexpected: true })).toEqual({ unexpected: true });
  });
});

describe('the "my items" filter, which is not criteria on its own', () => {
  it('adds the match-all subject when only_mine is the only thing set', () => {
    const params = new URLSearchParams(
      buildSearchQuery({ kind: 'ticket', onlyRelatedToCurrentUser: true, currentUserId: 'u1' }),
    );
    expect(params.get('Subject')).toBe(MATCH_ALL_SUBJECT);
    expect(params.get('CurrentUserId')).toBe('u1');
  });

  it('leaves a real filter alone when one is present alongside it', () => {
    const params = new URLSearchParams(
      buildSearchQuery({
        kind: 'ticket',
        subject: 'printer',
        onlyRelatedToCurrentUser: true,
        currentUserId: 'u1',
      }),
    );
    expect(params.get('Subject')).toBe('printer');
  });

  it('treats only the fields that stand alone as sufficient on their own', () => {
    for (const input of [{ subject: 'printer' }, { categoryName: 'HW' }]) {
      const params = new URLSearchParams(buildSearchQuery({ kind: 'ticket', ...input }));
      expect(params.get('Subject'), JSON.stringify(input)).not.toBe(MATCH_ALL_SUBJECT);
    }
  });
})

describe('rejectIgnoredFilters', () => {
  it('passes a search that only uses filters Matrix42 applies', () => {
    expect(rejectIgnoredFilters({ kind: 'ticket', subject: 'printer' })).toBeNull();
    expect(rejectIgnoredFilters({ kind: 'ticket', categoryName: 'HW', states: '200' })).toBeNull();
  });

  it('refuses a filter Matrix42 accepts but never applies', () => {
    // Verified live: a nonsense initiator name returns every ticket rather than none.
    const refusal = rejectIgnoredFilters({ kind: 'ticket', initiatorName: 'Ada' });
    expect(refusal).toMatch(/initiator_name/);
    expect(refusal).toMatch(/does not apply/);
  });

  it('names every ignored filter the caller passed', () => {
    const refusal = rejectIgnoredFilters({ kind: 'ticket', initiatorName: 'Ada', assetId: 'a1' });
    expect(refusal).toMatch(/initiator_name/);
    expect(refusal).toMatch(/asset_id/);
  });

  it('points at the query that does work instead of just refusing', () => {
    const refusal = rejectIgnoredFilters({ kind: 'ticket', ticketNumber: 'T1' }) ?? '';
    expect(refusal).toMatch(/data_query/);
    expect(refusal).toMatch(/SPSActivityClassBase/);
  });

  it('ignores a blank value rather than refusing on it', () => {
    expect(rejectIgnoredFilters({ kind: 'ticket', subject: 'x', initiatorName: '   ' })).toBeNull();
  });

  it('lists exactly the three filters proven to narrow a result', () => {
    expect([...HONOURED_FILTERS]).toEqual(['Subject', 'CategoryName', 'States']);
  });
});

describe('planTransform', () => {
  const base = {
    objectIds: ['o1'],
    sourceTypeName: 'SPSActivityTypeTicket',
    targetTypeName: 'SPSActivityTypeIncident',
  };

  it('sends the transmutation contract Matrix42 declares', () => {
    const plan = planTransform(base);
    expect(plan.path).toBe('m42Services/api/ticket/Transform');
    expect(plan.body).toMatchObject({
      ObjectIds: ['o1'],
      SourceTypeName: 'SPSActivityTypeTicket',
      TargetTypeName: 'SPSActivityTypeIncident',
      InitDefaultValues: false,
    });
  });

  it('refuses a transform that would change nothing', () => {
    expect(() => planTransform({ ...base, targetTypeName: base.sourceTypeName })).toThrow(
      /nothing to transform/,
    );
  });

  it('warns that the record’s identity changes and fields can be lost', () => {
    const plan = planTransform(base);
    expect(plan.effects[0]).toMatch(/Changes what the ticket IS/);
    expect(plan.effects[0]).toMatch(/lost/);
  });

  it('says which way the defaults go', () => {
    expect(planTransform(base).effects[1]).toMatch(/Keeps the existing/);
    expect(planTransform({ ...base, initDefaultValues: true }).effects[1]).toMatch(/Re-initialises/);
  });

  it('carries explicit values for the new type when given', () => {
    const plan = planTransform({ ...base, category: 'c1', sla: 's1', ola: 'o1', recipientRole: 'r1' });
    expect(plan.body).toMatchObject({ Category: 'c1', Sla: 's1', Ola: 'o1', RecipientRole: 'r1' });
  });

  it('omits the optional values that were not set', () => {
    const body = planTransform(base).body ?? {};
    expect(body).not.toHaveProperty('Category');
    expect(body).not.toHaveProperty('Sla');
  });
});
