// test/ui-host.test.ts — unit tests for resolving the web interface origin.

import { describe, expect, it, vi } from 'vitest';
import { UiHostResolver } from '../src/ui-host.js';
import type { M42Client } from '../src/m42-client.js';

const API = 'https://192.168.0.10';

/** A client whose getJson answers with a canned shell config, or throws. */
function fakeClient(payload: unknown, throws = false) {
  const getJson = vi.fn(async () => {
    if (throws) throw new Error('not found');
    return payload;
  });
  return { client: { getJson } as unknown as M42Client, getJson };
}

describe('UiHostResolver', () => {
  it('uses the origin the web shell says its API lives on', async () => {
    const { client } = fakeClient({ restHosts: { default: 'https://m42dev01/m42Services' } });
    const host = await new UiHostResolver(API).resolve(client);

    expect(host.origin).toBe('https://m42dev01');
    expect(host.source).toBe('discovered');
  });

  it('reads the shell config rather than guessing a path', async () => {
    const { client, getJson } = fakeClient({ restHosts: { default: 'https://x/m42Services' } });
    await new UiHostResolver(API).resolve(client);
    expect(getJson).toHaveBeenCalledWith('wm/config.json');
  });

  it('keeps a non-default port, which a lab instance often has', async () => {
    const { client } = fakeClient({ restHosts: { default: 'https://m42dev01:8443/m42Services' } });
    expect((await new UiHostResolver(API).resolve(client)).origin).toBe('https://m42dev01:8443');
  });

  it('lets an explicit override win without asking the instance', async () => {
    const { client, getJson } = fakeClient({ restHosts: { default: 'https://discovered/x' } });
    const host = await new UiHostResolver(API, 'https://chosen.example.com/').resolve(client);

    expect(host.origin).toBe('https://chosen.example.com');
    expect(host.source).toBe('configured');
    expect(getJson).not.toHaveBeenCalled();
  });

  it('falls back to the API host when the shell config cannot be read', async () => {
    const { client } = fakeClient(null, true);
    const host = await new UiHostResolver(API).resolve(client);

    expect(host.origin).toBe(API);
    expect(host.source).toBe('fallback');
    expect(host.note).toMatch(/M42_UI_URL/);
  });

  it('falls back when the shell declares no REST host', async () => {
    const { client } = fakeClient({ restHosts: {} });
    expect((await new UiHostResolver(API).resolve(client)).source).toBe('fallback');
  });

  it('falls back when the declared host is not a URL', async () => {
    const { client } = fakeClient({ restHosts: { default: 'not a url' } });
    expect((await new UiHostResolver(API).resolve(client)).source).toBe('fallback');
  });

  it('asks the instance only once, since the origin does not move', async () => {
    const { client, getJson } = fakeClient({ restHosts: { default: 'https://m42dev01/m42Services' } });
    const resolver = new UiHostResolver(API);

    await resolver.resolve(client);
    await resolver.resolve(client);
    expect(getJson).toHaveBeenCalledTimes(1);
  });

  it('caches a fallback too, rather than retrying a miss on every link', async () => {
    const { client, getJson } = fakeClient(null, true);
    const resolver = new UiHostResolver(API);

    await resolver.resolve(client);
    await resolver.resolve(client);
    expect(getJson).toHaveBeenCalledTimes(1);
  });
});
