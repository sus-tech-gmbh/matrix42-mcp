// test/resources.test.ts — unit tests for the guides published as MCP resources.

import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { GUIDE_RESOURCES, registerResources } from '../src/resources.js';

/** Captures what registerResources published, without starting a server. */
function capture() {
  const registered: { name: string; uri: string; config: Record<string, unknown>; read: Function }[] =
    [];
  const server = {
    registerResource: (name: string, uri: string, config: Record<string, unknown>, read: Function) => {
      registered.push({ name, uri, config, read });
    },
  } as unknown as McpServer;
  registerResources(server);
  return registered;
}

describe('GUIDE_RESOURCES', () => {
  it('publishes the data model guide first, since it is the orientation piece', () => {
    expect(GUIDE_RESOURCES[0]?.name).toBe('data-model');
  });

  it('covers the data model, schema, ASQL and API guides', () => {
    expect(GUIDE_RESOURCES.map((guide) => guide.name)).toEqual(['data-model', 'schema', 'asql', 'api']);
  });

  it('gives every guide a unique matrix42:// uri', () => {
    const uris = GUIDE_RESOURCES.map((guide) => guide.uri);
    expect(new Set(uris).size).toBe(uris.length);
    for (const uri of uris) expect(uri).toMatch(/^matrix42:\/\/guide\//);
  });

  it('gives every guide a title, a description and real content', () => {
    for (const guide of GUIDE_RESOURCES) {
      expect(guide.title.length, guide.name).toBeGreaterThan(0);
      expect(guide.description.length, guide.name).toBeGreaterThan(20);
      expect(guide.text.length, guide.name).toBeGreaterThan(200);
    }
  });

  it('states the never-guess rule in the data model guide, where a model will meet it first', () => {
    const dataModel = GUIDE_RESOURCES.find((guide) => guide.name === 'data-model');
    expect(dataModel?.text).toMatch(/never guess an attribute name/i);
  });

  it('teaches that a ticket person column is a relation, which a name filter silently ignores', () => {
    // Filtering by initiator_name once returned every ticket instead of failing. The guide has to
    // say why: Initiator points at another definition, so the filter has to traverse it.
    const asql = GUIDE_RESOURCES.find((guide) => guide.name === 'asql');
    expect(asql?.text).toMatch(/no InitiatorName column/i);
    expect(asql?.text).toContain("Initiator.LastName = 'Smith'");
    expect(asql?.text).toMatch(/T\(SPSSecurityClassRole\)/);
  });
});

describe('registerResources', () => {
  it('registers one resource per guide', () => {
    expect(capture()).toHaveLength(GUIDE_RESOURCES.length);
  });

  it('declares markdown so clients render the guides as documents', () => {
    for (const entry of capture()) expect(entry.config.mimeType).toBe('text/markdown');
  });

  it('returns the guide text under the uri the client asked for', async () => {
    const entry = capture()[0];
    if (!entry) throw new Error('nothing registered');

    const result = await entry.read(new URL(entry.uri));
    expect(result.contents[0].uri).toBe(new URL(entry.uri).href);
    expect(result.contents[0].text).toBe(GUIDE_RESOURCES[0]?.text);
  });

  it('serves each guide its own text, not the first one', async () => {
    const entries = capture();
    const asql = entries.find((entry) => entry.name === 'asql');
    if (!asql) throw new Error('asql guide missing');

    const result = await asql.read(new URL(asql.uri));
    expect(result.contents[0].text).toBe(
      GUIDE_RESOURCES.find((guide) => guide.name === 'asql')?.text,
    );
  });
});
