// test/columns.test.ts — unit tests for schema-driven column resolution.

import { describe, expect, it, vi } from 'vitest';
import {
  ColumnCache,
  bracketExpression,
  columnsFor,
  getClassAttributes,
  outputName,
  resolveColumns,
} from '../src/columns.js';
import type { M42Client } from '../src/m42-client.js';

/** A client whose getJson returns canned schema payloads and records its calls. */
function fakeClient(payload: unknown): { client: M42Client; getJson: ReturnType<typeof vi.fn> } {
  const getJson = vi.fn().mockResolvedValue(payload);
  return { client: { getJson } as unknown as M42Client, getJson };
}

const SCHEMA = {
  Attributes: [
    { InternalName: 'Name' },
    { InternalName: 'SerialNumber' },
    { InternalName: 'AcquisitionDate' },
    { InternalName: null },
    {},
  ],
};

describe('getClassAttributes', () => {
  it('reads attribute names from the schema endpoint', async () => {
    const { client, getJson } = fakeClient(SCHEMA);
    const attributes = await getClassAttributes(client, 'SPSAssetClassBase', new ColumnCache());

    expect(attributes.names).toEqual(['Name', 'SerialNumber', 'AcquisitionDate']);
    expect(getJson).toHaveBeenCalledWith('m42Services/api/Schema/classes/SPSAssetClassBase');
  });

  it('drops entries without a usable internal name instead of emitting undefined columns', async () => {
    const { client } = fakeClient(SCHEMA);
    const attributes = await getClassAttributes(client, 'X', new ColumnCache());
    expect(attributes.names).not.toContain(undefined);
    expect(attributes.names).toHaveLength(3);
  });

  it('tolerates a definition that reports no attributes', async () => {
    const { client } = fakeClient({});
    const attributes = await getClassAttributes(client, 'X', new ColumnCache());
    expect(attributes.names).toEqual([]);
  });

  it('serves the second request for a class from the cache', async () => {
    const { client, getJson } = fakeClient(SCHEMA);
    const cache = new ColumnCache();
    await getClassAttributes(client, 'SPSAssetClassBase', cache);
    await getClassAttributes(client, 'SPSAssetClassBase', cache);
    expect(getJson).toHaveBeenCalledTimes(1);
  });

  it('caches per class, not globally', async () => {
    const { client, getJson } = fakeClient(SCHEMA);
    const cache = new ColumnCache();
    await getClassAttributes(client, 'A', cache);
    await getClassAttributes(client, 'B', cache);
    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it('refetches once the cached entry has aged out', async () => {
    vi.useFakeTimers();
    try {
      const { client, getJson } = fakeClient(SCHEMA);
      const cache = new ColumnCache();
      await getClassAttributes(client, 'A', cache);
      vi.advanceTimersByTime(11 * 60_000);
      await getClassAttributes(client, 'A', cache);
      expect(getJson).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('resolveColumns', () => {
  const available = {
    names: ['Name', 'SerialNumber'],
    lookup: new Map([
      ['name', 'Name'],
      ['serialnumber', 'SerialNumber'],
    ]),
  };

  it('keeps the columns that exist and reports the ones that do not', () => {
    const resolved = resolveColumns(available, ['Name', 'BookValue', 'SerialNumber']);
    expect(resolved.used).toEqual(['Name', 'SerialNumber']);
    expect(resolved.missing).toEqual(['BookValue']);
  });

  it('always selects ID, which Matrix42 needs for its default sort', () => {
    expect(resolveColumns(available, ['Name']).columns).toBe('[ID],[Name]');
  });

  it('never selects ID twice', () => {
    const withId = {
      names: ['ID', 'Name'],
      lookup: new Map([
        ['id', 'ID'],
        ['name', 'Name'],
      ]),
    };
    expect(resolveColumns(withId, ['ID', 'Name']).columns).toBe('[ID],[Name]');
  });

  it('answers with the instance spelling, not the caller spelling', () => {
    expect(resolveColumns(available, ['serialnumber']).used).toEqual(['SerialNumber']);
  });

  it('never selects DisplayString, which every tested definition rejects explicitly', () => {
    const resolved = resolveColumns(available, ['Name', 'DisplayString']);
    expect(resolved.columns).not.toContain('DisplayString');
    expect(resolved.missing).toContain('DisplayString');
  });

  it('still produces a valid projection when nothing the caller wanted exists', () => {
    expect(resolveColumns(available, ['Nope']).columns).toBe('[ID]');
  });
});

describe('columnsFor', () => {
  it('resolves against the live schema in one call', async () => {
    const { client } = fakeClient(SCHEMA);
    const resolved = await columnsFor(client, 'SPSAssetClassBase', ['Name', 'Ghost'], new ColumnCache());
    expect(resolved.columns).toBe('[ID],[Name]');
    expect(resolved.missing).toEqual(['Ghost']);
  });
});

describe('bracketExpression', () => {
  it('brackets a plain attribute', () => {
    expect(bracketExpression('Name')).toBe('[Name]');
  });

  it('escapes End, which the parser reads as the end of a CASE block rather than a column', () => {
    expect(bracketExpression('End')).toBe('[End]');
  });

  it('brackets each segment of a dotted path independently', () => {
    expect(bracketExpression('State.DisplayString AS State')).toBe('[State].[DisplayString] AS [State]');
  });

  it('brackets the alias too, since it is parsed as an identifier in its own right', () => {
    expect(bracketExpression('End AS End')).toBe('[End] AS [End]');
  });

  it('leaves an already-bracketed identifier alone rather than nesting brackets', () => {
    expect(bracketExpression('[Expression-ObjectID]')).toBe('[Expression-ObjectID]');
  });

  it('tolerates a lower-case AS', () => {
    expect(bracketExpression('Name as Label')).toBe('[Name] AS [Label]');
  });
});

describe('outputName', () => {
  it('is the attribute itself when nothing is aliased', () => {
    expect(outputName('Name')).toBe('Name');
  });

  it('is the alias when one is applied, because the sort sees the projected result', () => {
    expect(outputName('End AS EndedOn')).toBe('EndedOn');
  });

  it('strips brackets, which a sort clause rejects', () => {
    expect(outputName('[End] AS [EndedOn]')).toBe('EndedOn');
    expect(outputName('[Name]')).toBe('Name');
  });

  it('uses the leaf of a dotted path when it is unaliased', () => {
    expect(outputName('State.DisplayString')).toBe('State.DisplayString');
  });
});
