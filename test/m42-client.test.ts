// test/m42-client.test.ts — unit tests for authentication, caching, and error mapping.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

vi.mock('undici', () => ({
  Agent: class MockAgent {
    constructor(readonly options?: unknown) {}
  },
  fetch: mockFetch,
}));

const { M42Client, M42Error, parseLifetime } = await import('../src/m42-client.js');
const { loadConfig } = await import('../src/config.js');

/** Builds a minimal stand-in for an undici Response. */
function response(body: unknown, status = 200): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

const FUTURE = new Date(Date.now() + 60 * 60_000).toISOString();

function tokenConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    M42_HOST: 'https://m42.example.com',
    M42_API_TOKEN: 'api-token',
    ...overrides,
  });
}

/** Reads the headers passed to the Nth fetch call. */
function headersOf(call: number): Record<string, string> {
  return (mockFetch.mock.calls[call]?.[1] as { headers: Record<string, string> }).headers;
}

/** Counts how many calls hit the token exchange endpoint. */
function exchangeCount(): number {
  return mockFetch.mock.calls.filter(([url]) =>
    String(url).includes('GenerateAccessTokenFromApiToken'),
  ).length;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('token exchange', () => {
  it('exchanges the API token, then uses the access token as a Bearer', async () => {
    mockFetch
      .mockResolvedValueOnce(response({ RawToken: 'access-1', LifeTime: FUTURE }))
      .mockResolvedValueOnce(response([{ ok: true }]));

    const client = new M42Client(tokenConfig());
    await client.getJson('m42Services/api/Schema/classes');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('GenerateAccessTokenFromApiToken');
    expect(headersOf(0).Authorization).toBe('Bearer api-token');
    expect(headersOf(1).Authorization).toBe('Bearer access-1');
  });

  it('caches the access token across requests', async () => {
    mockFetch
      .mockResolvedValueOnce(response({ RawToken: 'access-1', LifeTime: FUTURE }))
      .mockResolvedValue(response([]));

    const client = new M42Client(tokenConfig());
    await client.getJson('a');
    await client.getJson('b');
    await client.getJson('c');

    expect(exchangeCount()).toBe(1);
  });

  it('shares a single exchange between concurrent requests', async () => {
    mockFetch
      .mockResolvedValueOnce(response({ RawToken: 'access-1', LifeTime: FUTURE }))
      .mockResolvedValue(response([]));

    const client = new M42Client(tokenConfig());
    await Promise.all([client.getJson('a'), client.getJson('b'), client.getJson('c')]);

    expect(exchangeCount()).toBe(1);
  });

  it('re-exchanges once the cached token is inside the expiry buffer', async () => {
    const soon = new Date(Date.now() + 5_000).toISOString();
    mockFetch
      .mockResolvedValueOnce(response({ RawToken: 'access-1', LifeTime: soon }))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ RawToken: 'access-2', LifeTime: FUTURE }))
      .mockResolvedValueOnce(response([]));

    const client = new M42Client(tokenConfig());
    await client.getJson('a');
    await client.getJson('b');

    expect(exchangeCount()).toBe(2);
    expect(headersOf(1).Authorization).toBe('Bearer access-1');
    expect(headersOf(3).Authorization).toBe('Bearer access-2');
  });

  it('explains that the API token is expired when the exchange returns null', async () => {
    mockFetch.mockResolvedValueOnce(response(null));
    const client = new M42Client(tokenConfig());
    await expect(client.getJson('a')).rejects.toThrow(/expired or invalid/);
  });

  it('surfaces a failed exchange with its status', async () => {
    mockFetch.mockResolvedValueOnce(response('nope', 401));
    const client = new M42Client(tokenConfig());
    await expect(client.getJson('a')).rejects.toThrow(/Token exchange failed with HTTP 401/);
  });
});

describe('basic auth', () => {
  it('sends a Basic header and never performs a token exchange', async () => {
    mockFetch.mockResolvedValueOnce(response([]));
    const client = new M42Client(
      loadConfig({
        M42_HOST: 'https://m42.example.com',
        M42_USERNAME: 'user',
        M42_PASSWORD: 'pass',
      }),
    );
    await client.getJson('m42Services/api/Schema/classes');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const expected = 'Basic ' + Buffer.from('user:pass').toString('base64');
    expect(headersOf(0).Authorization).toBe(expected);
  });
});

describe('request headers', () => {
  it('always sends the configured Explicit-Language', async () => {
    mockFetch
      .mockResolvedValueOnce(response({ RawToken: 't', LifeTime: FUTURE }))
      .mockResolvedValueOnce(response([]));
    const client = new M42Client(tokenConfig({ M42_LANGUAGE: 'de-DE' }));
    await client.getJson('a');
    expect(headersOf(1)['Explicit-Language']).toBe('de-DE');
  });
});

describe('getJson', () => {
  it('throws M42Error carrying the status on a non-2xx response', async () => {
    mockFetch
      .mockResolvedValueOnce(response({ RawToken: 't', LifeTime: FUTURE }))
      .mockResolvedValueOnce(response('forbidden', 403));
    const client = new M42Client(tokenConfig());
    await expect(client.getJson('a')).rejects.toMatchObject({ name: 'M42Error', status: 403 });
  });

  it('throws when the body is not JSON', async () => {
    mockFetch
      .mockResolvedValueOnce(response({ RawToken: 't', LifeTime: FUTURE }))
      .mockResolvedValueOnce(response('<html>login</html>'));
    const client = new M42Client(tokenConfig());
    await expect(client.getJson('a')).rejects.toThrow(/non-JSON body/);
  });

  it('returns the parsed body on success', async () => {
    mockFetch
      .mockResolvedValueOnce(response({ RawToken: 't', LifeTime: FUTURE }))
      .mockResolvedValueOnce(response([{ Name: 'x' }]));
    const client = new M42Client(tokenConfig());
    await expect(client.getJson('a')).resolves.toEqual([{ Name: 'x' }]);
  });
});

describe('verifyConnection', () => {
  it('passes when the schema endpoint answers 2xx', async () => {
    mockFetch
      .mockResolvedValueOnce(response({ RawToken: 't', LifeTime: FUTURE }))
      .mockResolvedValueOnce(response([]));
    await expect(new M42Client(tokenConfig()).verifyConnection()).resolves.toBeUndefined();
  });

  it.each([
    [401, /Credentials were rejected/],
    [403, /not permitted/],
    [406, /must be exchanged/],
  ])('explains HTTP %i in plain language', async (status, expected) => {
    mockFetch
      .mockResolvedValueOnce(response({ RawToken: 't', LifeTime: FUTURE }))
      .mockResolvedValueOnce(response('', status));
    await expect(new M42Client(tokenConfig()).verifyConnection()).rejects.toThrow(expected);
  });
});

describe('parseLifetime', () => {
  it('parses an ISO-8601 expiry', () => {
    expect(parseLifetime('2030-01-01T00:00:00Z')).toBe(Date.parse('2030-01-01T00:00:00Z'));
  });

  it('falls back to a short window for a missing or unparseable value', () => {
    const before = Date.now();
    for (const value of [undefined, 'not-a-date']) {
      const parsed = parseLifetime(value);
      expect(parsed).toBeGreaterThanOrEqual(before + 4 * 60_000);
      expect(parsed).toBeLessThanOrEqual(Date.now() + 6 * 60_000);
    }
  });
});

describe('M42Error', () => {
  it('is an Error subclass that keeps the status', () => {
    const error = new M42Error('boom', 500);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(500);
  });
});
