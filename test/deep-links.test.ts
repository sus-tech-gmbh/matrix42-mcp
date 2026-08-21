// test/deep-links.test.ts — unit tests for the Matrix42 web-interface link builder.
//
// The shape asserted here was confirmed by opening generated links in a signed-in browser against
// a live instance: a ticket and a person both rendered their full detail pages.

import { describe, expect, it } from 'vitest';
import { buildDeepLink, viewOptionsLink } from '../src/deep-links.js';

const HOST = 'https://matrix42.example.com';

/** The decoded view-options payload of a built link. */
function payload(url: string): Record<string, unknown> {
  const raw = new URL(url).searchParams.get('view-options');
  return JSON.parse(raw ?? '{}');
}

describe('viewOptionsLink', () => {
  it('builds the documented app path with the payload in the query string', () => {
    const url = viewOptionsLink(HOST, 'ServiceDesk', {
      type: 'SPSActivityTypeTicket',
      viewType: 'preview',
      objectId: 'obj-1',
    });
    expect(url.startsWith('https://matrix42.example.com/wm/app-ServiceDesk/?view-options=')).toBe(true);
    expect(payload(url)).toEqual({
      type: 'SPSActivityTypeTicket',
      viewType: 'preview',
      objectId: 'obj-1',
    });
  });

  it('tolerates a trailing slash on the host', () => {
    const url = viewOptionsLink(`${HOST}/`, 'ServiceDesk', { type: 'T', viewType: 'preview' });
    expect(url).toContain('https://matrix42.example.com/wm/app-ServiceDesk/');
  });

  it('omits fields the caller never set', () => {
    const url = viewOptionsLink(HOST, 'ServiceDesk', { type: 'T', viewType: 'new' });
    expect(payload(url)).toEqual({ type: 'T', viewType: 'new' });
  });

  it('escapes the application segment', () => {
    expect(viewOptionsLink(HOST, 'A/B', { type: 'T', viewType: 'preview' })).toContain('app-A%2FB');
  });
});

describe('buildDeepLink', () => {
  it('previews by default, since reading is the safe thing to do', () => {
    const link = buildDeepLink({ baseUrl: HOST, typeName: 'T', objectId: 'o1' });
    expect(link.viewType).toBe('preview');
    expect(payload(link.url).viewType).toBe('preview');
  });

  it('opens through the service desk unless another application is named', () => {
    expect(buildDeepLink({ baseUrl: HOST, typeName: 'T', objectId: 'o1' }).url).toContain(
      'app-ServiceDesk',
    );
    expect(
      buildDeepLink({ baseUrl: HOST, typeName: 'T', objectId: 'o1', application: 'Administration' }).url,
    ).toContain('app-Administration');
  });

  it('refuses a preview with no object rather than emitting a link that opens nothing', () => {
    expect(() => buildDeepLink({ baseUrl: HOST, typeName: 'T' })).toThrow(/object_id/);
  });

  it('allows a creation link without an object, which is the one case that needs none', () => {
    const link = buildDeepLink({ baseUrl: HOST, typeName: 'T', viewType: 'new' });
    expect(payload(link.url)).toEqual({ type: 'T', viewType: 'new' });
    expect(link.note).toMatch(/Nothing is created/);
  });

  it('refuses an action link with no action to run', () => {
    expect(() =>
      buildDeepLink({ baseUrl: HOST, typeName: 'T', objectId: 'o1', viewType: 'action' }),
    ).toThrow(/action_id/);
  });

  it('carries the action id when one is given', () => {
    const link = buildDeepLink({
      baseUrl: HOST,
      typeName: 'T',
      objectId: 'o1',
      viewType: 'action',
      actionId: 'a1',
    });
    expect(payload(link.url)).toMatchObject({ viewType: 'action', actionId: 'a1' });
  });

  it('passes pre-filled values through, keyed by data definition', () => {
    const link = buildDeepLink({
      baseUrl: HOST,
      typeName: 'T',
      viewType: 'new',
      presetParams: { SPSActivityClassBase: { Initiator: 'u1' } },
    });
    expect(payload(link.url).presetParams).toEqual({ SPSActivityClassBase: { Initiator: 'u1' } });
  });

  it('leaves presetParams out entirely when there is nothing to pre-fill', () => {
    const link = buildDeepLink({ baseUrl: HOST, typeName: 'T', viewType: 'new', presetParams: {} });
    expect(payload(link.url)).not.toHaveProperty('presetParams');
  });

  it('carries the optional dialog, view and embedded flags', () => {
    const link = buildDeepLink({
      baseUrl: HOST,
      typeName: 'T',
      objectId: 'o1',
      dialogId: 'd1',
      viewId: 'v1',
      embedded: true,
    });
    expect(payload(link.url)).toMatchObject({ dialogId: 'd1', viewId: 'v1', embedded: true });
  });

  it('says plainly that edit and action change nothing on their own', () => {
    expect(buildDeepLink({ baseUrl: HOST, typeName: 'T', objectId: 'o1', viewType: 'edit' }).note).toMatch(
      /until a person saves/,
    );
    expect(
      buildDeepLink({ baseUrl: HOST, typeName: 'T', objectId: 'o1', viewType: 'action', actionId: 'a' })
        .note,
    ).toMatch(/only once a person completes it/);
  });
});
