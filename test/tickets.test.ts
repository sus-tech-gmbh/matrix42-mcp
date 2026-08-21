// test/tickets.test.ts — unit tests for write payloads and the safety defaults around them.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.mock('undici', () => ({
  Agent: class MockAgent {},
  fetch: mockFetch,
}));

const {
  KNOWN_ACCEPTED_ACTIVITY_TYPES,
  REJECTED_ACTIVITY_TYPES,
  addJournalEntry,
  classifyTicket,
  closeTickets,
  createTicket,
} = await import('../src/tickets.js');
const { M42Client } = await import('../src/m42-client.js');
const { loadConfig } = await import('../src/config.js');

function response(body: unknown, status = 200): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}
const FUTURE = new Date(Date.now() + 3_600_000).toISOString();

function client() {
  return new M42Client(
    loadConfig({ M42_HOST: 'https://m42.example.com', M42_API_TOKEN: 'tok' }),
  );
}

/** The JSON body of the Nth fetch call. */
function bodyOf(call: number): Record<string, unknown> {
  const init = mockFetch.mock.calls[call]?.[1] as { body?: string };
  return JSON.parse(init.body ?? '{}') as Record<string, unknown>;
}
const urlOf = (call: number): string => String(mockFetch.mock.calls[call]?.[0]);

beforeEach(() => {
  mockFetch.mockReset();
  // Every write is preceded by the token exchange.
  mockFetch.mockResolvedValueOnce(response({ RawToken: 't', LifeTime: FUTURE }));
});

describe('createTicket', () => {
  it('posts to the activity type and returns the new id', async () => {
    mockFetch.mockResolvedValueOnce(response('"new-guid-1"'));
    const result = await createTicket(client(), { activityType: 6, subject: 'Printer down' });

    expect(urlOf(1)).toContain('api/ticket/Create?activityType=6');
    expect(bodyOf(1)).toEqual({ Subject: 'Printer down' });
    // Create answers with the OBJECT id, which close_ticket and add_journal_entry consume directly.
    expect(result).toEqual({ created: true, activityType: 6, objectId: 'new-guid-1' });
  });

  it('maps the documented contract field names', async () => {
    mockFetch.mockResolvedValueOnce(response('"id"'));
    await createTicket(client(), {
      activityType: 0,
      subject: 'New laptop',
      description: 'plain',
      initiator: 'user-1',
      category: 'cat-1',
      priority: 2,
    });
    expect(bodyOf(1)).toEqual({
      Subject: 'New laptop',
      Description: 'plain',
      User: 'user-1',
      Category: 'cat-1',
      Priority: 2,
    });
  });

  it('omits fields the caller did not set rather than sending nulls', async () => {
    mockFetch.mockResolvedValueOnce(response('"id"'));
    await createTicket(client(), { activityType: 6, subject: 'x' });
    expect(Object.keys(bodyOf(1))).toEqual(['Subject']);
  });

  it('passes extra contract fields through untouched', async () => {
    mockFetch.mockResolvedValueOnce(response('"id"'));
    await createTicket(client(), {
      activityType: 6,
      subject: 'x',
      extraFields: { TicketNumber: 'TCK1', NotifyResponsible: true },
    });
    expect(bodyOf(1)).toMatchObject({ TicketNumber: 'TCK1', NotifyResponsible: true });
  });

  it('refuses an activity type Create cannot handle, naming it, without calling the API', async () => {
    await expect(
      createTicket(client(), { activityType: 1, subject: 'x' }),
    ).rejects.toThrow(/does not handle activity type 1 \(Problem\)/);
    // Rejected before any HTTP at all — not even the token exchange was needed.
    expect(mockFetch).toHaveBeenCalledTimes(0);
  });

  it('names each activity type Create is known to reject', () => {
    expect(REJECTED_ACTIVITY_TYPES).toEqual({
      1: 'Problem',
      2: 'Change',
      3: 'Task',
      4: 'ApprovalTask',
    });
  });

  it('records the activity type ids observed to work', () => {
    expect([...KNOWN_ACCEPTED_ACTIVITY_TYPES]).toEqual([0, 5, 6]);
  });
});

describe('closeTickets — notification safety', () => {
  it('sends every notification flag as false unless asked', async () => {
    mockFetch.mockResolvedValueOnce(response(''));
    const result = await closeTickets(client(), { objectIds: ['obj-1'], comments: 'Fixed' });

    const body = bodyOf(1);
    expect(body.SendMailToInitiator).toBe(false);
    expect(body.SendMailToUsers).toBe(false);
    expect(body.NotifyResponsible).toBe(false);
    expect(body.CloseRelatedIncidents).toBe(false);
    expect(result.notificationsSent).toBe(false);
  });

  it('sends notifications only when explicitly requested, and reports that it did', async () => {
    mockFetch.mockResolvedValueOnce(response(''));
    const result = await closeTickets(client(), {
      objectIds: ['obj-1'],
      notifyInitiator: true,
    });
    expect(bodyOf(1).SendMailToInitiator).toBe(true);
    expect(result.notificationsSent).toBe(true);
  });

  it('closes by object id and carries the solution and reason', async () => {
    mockFetch.mockResolvedValueOnce(response(''));
    await closeTickets(client(), { objectIds: ['a', 'b'], comments: 'Solved', reason: 5 });
    expect(urlOf(1)).toContain('api/ticket/Close');
    expect(bodyOf(1)).toMatchObject({ ObjectIds: ['a', 'b'], Comments: 'Solved', Reason: 5 });
  });

  it('tolerates an already-closed ticket by default', async () => {
    mockFetch.mockResolvedValueOnce(response(''));
    await closeTickets(client(), { objectIds: ['a'] });
    expect(bodyOf(1).SkipFailIfAlreadyClosed).toBe(true);
  });

  it('raises the HTTP failure rather than reporting success', async () => {
    mockFetch.mockResolvedValueOnce(response('not allowed', 403));
    await expect(closeTickets(client(), { objectIds: ['a'] })).rejects.toThrow(/HTTP 403/);
  });
});

describe('addJournalEntry — visibility safety', () => {
  it('is internal by default: neither visible in the portal nor published', async () => {
    mockFetch.mockResolvedValueOnce(response({ JournalId: 'j-1' }));
    const result = await addJournalEntry(client(), { objectId: 'obj-1', comments: 'internal note' });

    const body = bodyOf(1);
    expect(body.VisibleInPortal).toBe(false);
    expect(body.Publish).toBe(false);
    expect(result).toMatchObject({ added: true, journalId: 'j-1', visibleInPortal: false });
  });

  it('publishes to the portal only when explicitly asked', async () => {
    mockFetch.mockResolvedValueOnce(response({ JournalId: 'j-2' }));
    const result = await addJournalEntry(client(), {
      objectId: 'obj-1',
      comments: 'visible to requester',
      visibleInPortal: true,
    });
    expect(bodyOf(1)).toMatchObject({ VisibleInPortal: true, Publish: true });
    expect(result.visibleInPortal).toBe(true);
  });

  it('sends template parameters in the documented shape', async () => {
    mockFetch.mockResolvedValueOnce(response({ JournalId: 'j-3' }));
    await addJournalEntry(client(), {
      objectId: 'obj-1',
      comments: 'forwarded',
      entryType: 2,
      parameters: [{ name: 'User', value: 'Alex' }, { name: 'Amount', value: 5, format: 'N2' }],
    });
    expect(bodyOf(1)).toMatchObject({
      EntryType: 2,
      Parameters: [
        { Name: 'User', Value: 'Alex' },
        { Name: 'Amount', Value: 5, Format: 'N2' },
      ],
    });
  });

  it('still reports success when the response carries no id', async () => {
    mockFetch.mockResolvedValueOnce(response(''));
    const result = await addJournalEntry(client(), { objectId: 'o', comments: 'c' });
    expect(result.added).toBe(true);
    expect(result).not.toHaveProperty('journalId');
  });
});

describe('classifyTicket', () => {
  it('sends only the text and returns the parsed suggestion', async () => {
    mockFetch.mockResolvedValueOnce(response({ TicketType: 1 }));
    const result = await classifyTicket(client(), 'Printer broken', 'It smokes');
    expect(urlOf(1)).toContain('api/ticket/Classify');
    expect(bodyOf(1)).toEqual({ TicketSubject: 'Printer broken', TicketDescription: 'It smokes' });
    expect(result).toEqual({ TicketType: 1 });
  });
});
