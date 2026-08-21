// test/deep-links.test.ts — unit tests for the Matrix42 web-interface link builder.

import { describe, expect, it } from 'vitest';
import { buildDeepLink, createObjectLink, objectDetailsLink } from '../src/deep-links.js';

const HOST = 'https://matrix42.example.com';

describe('objectDetailsLink', () => {
  it('builds the object-details path the instance itself emits', () => {
    expect(objectDetailsLink(HOST, 'SPSUserType', 'obj-1')).toBe(
      'https://matrix42.example.com/wm/object-details/SPSUserType/obj-1',
    );
  });

  it('appends a view id when one is given', () => {
    expect(objectDetailsLink(HOST, 'SPSUserType', 'obj-1', 'view-9')).toBe(
      'https://matrix42.example.com/wm/object-details/SPSUserType/obj-1/view-9',
    );
  });

  it('tolerates a trailing slash on the host', () => {
    expect(objectDetailsLink(`${HOST}/`, 'T', 'o')).toBe(
      'https://matrix42.example.com/wm/object-details/T/o',
    );
  });

  it('escapes a segment so it cannot break out of the path', () => {
    expect(objectDetailsLink(HOST, 'A/B', 'o')).toContain('A%2FB');
  });
});

describe('createObjectLink', () => {
  it('builds the creation path, including the placeholder segment Matrix42 uses', () => {
    expect(createObjectLink(HOST, 'ServiceDesk', 'SPSActivityTypeTicket')).toBe(
      'https://matrix42.example.com/wm/app-ServiceDesk/notset/create-object/SPSActivityTypeTicket',
    );
  });

  it('encodes preset values as the JSON query parameter the form reads', () => {
    const url = createObjectLink(HOST, 'ServiceDesk', 'T', {
      SPSActivityClassBase: { Initiator: 'u1' },
    });
    const preset = new URL(url).searchParams.get('presetParams');
    expect(JSON.parse(preset ?? '{}')).toEqual({ SPSActivityClassBase: { Initiator: 'u1' } });
  });

  it('omits the query string when there is nothing to pre-fill', () => {
    expect(createObjectLink(HOST, 'App', 'T', {})).not.toContain('?');
  });
});

describe('buildDeepLink', () => {
  it('defaults to an object link and says the id must be an object id', () => {
    const link = buildDeepLink({ kind: 'object', baseUrl: HOST, typeName: 'T', objectId: 'o1' });
    expect(link.kind).toBe('object');
    expect(link.note).toMatch(/OBJECT id/);
  });

  it('refuses an object link with no object id rather than emitting a broken URL', () => {
    expect(() => buildDeepLink({ kind: 'object', baseUrl: HOST, typeName: 'T' })).toThrow(/object_id/);
  });

  it('states that a creation link changes nothing by itself', () => {
    const link = buildDeepLink({ kind: 'create', baseUrl: HOST, typeName: 'T' });
    expect(link.note).toMatch(/Nothing is created/);
  });

  it('falls back to the service desk application for a creation link', () => {
    expect(buildDeepLink({ kind: 'create', baseUrl: HOST, typeName: 'T' }).url).toContain('app-ServiceDesk');
  });
});
