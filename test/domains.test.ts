// test/domains.test.ts — unit tests for the curated domain browser.

import { describe, expect, it, vi } from 'vitest';
import { ColumnCache } from '../src/columns.js';
import {
  DOMAINS,
  DOMAIN_NAMES,
  buildSearchFilter,
  listDomain,
  rootAttribute,
  searchEverywhere,
  sortForProjection,
} from '../src/domains.js';
import type { M42Client } from '../src/m42-client.js';

/**
 * A client that answers schema requests from a supplied attribute list and fragment requests from
 * supplied rows, recording the fragment URL so tests can assert the query that was built.
 */
function fakeClient(attributes: string[], rows: unknown[] = []) {
  const urls: string[] = [];
  const getJson = vi.fn(async (path: string) => {
    urls.push(path);
    if (path.includes('/Schema/classes/')) {
      return { Attributes: attributes.map((InternalName) => ({ InternalName })) };
    }
    return rows;
  });
  return { client: { getJson } as unknown as M42Client, urls };
}

/** The query string of the fragment request the browser issued. */
function fragmentQuery(urls: string[]): URLSearchParams {
  const url = urls.find((u) => u.includes('/data/fragments/'));
  if (!url) throw new Error('no fragment request was made');
  return new URLSearchParams(url.slice(url.indexOf('?') + 1));
}

describe('DOMAINS registry', () => {
  it('names every domain it exposes', () => {
    expect(DOMAIN_NAMES.length).toBe(Object.keys(DOMAINS).length);
    expect(DOMAIN_NAMES).toContain('assets');
  });

  it('gives every domain a base class, a description and fields', () => {
    for (const [name, spec] of Object.entries(DOMAINS)) {
      expect(spec.class, name).toMatch(/^[A-Za-z]/);
      expect(spec.description.length, name).toBeGreaterThan(10);
      expect(spec.preferred.length, name).toBeGreaterThan(0);
      expect(spec.searchable.length, name).toBeGreaterThan(0);
    }
  });

  it('only makes fields searchable that the domain also selects', () => {
    for (const [name, spec] of Object.entries(DOMAINS)) {
      const selected = spec.preferred.map(rootAttribute);
      for (const field of spec.searchable) {
        expect(selected, `${name}.${field}`).toContain(rootAttribute(field));
      }
    }
  });

  it('sorts only on a field it selects, because Matrix42 rejects sorting on an unselected column', () => {
    for (const [name, spec] of Object.entries(DOMAINS)) {
      if (!spec.sort) continue;
      expect(spec.preferred.map(rootAttribute), `${name} sort`).toContain(rootAttribute(spec.sort));
    }
  });

  it('exposes workflow instances read-only — no control verb hides in the registry', () => {
    const workflows = DOMAINS.workflow_instances;
    expect(workflows?.class).toBe('PLSLProcessInstanceClassBase');
    expect(workflows?.description).toMatch(/read-only/i);
  });
});

describe('buildSearchFilter', () => {
  it('matches the term against every available field', () => {
    expect(buildSearchFilter('abc', ['Name', 'Model'])).toBe(
      "Name LIKE '%abc%' OR Model LIKE '%abc%'",
    );
  });

  it('escapes a quote so a search term cannot break out of the literal', () => {
    expect(buildSearchFilter("O'Brien", ['Name'])).toBe("Name LIKE '%O''Brien%'");
  });
});

describe('listDomain', () => {
  it('rejects an unknown domain by name and lists the known ones', async () => {
    const { client } = fakeClient([]);
    await expect(listDomain(client, new ColumnCache(), 'nope')).rejects.toThrow(/Unknown domain/);
  });

  it('selects only the fields this instance actually has, and reports the rest', async () => {
    const { client, urls } = fakeClient(['Name', 'SerialNumber']);
    const result = await listDomain(client, new ColumnCache(), 'assets');

    const columns = fragmentQuery(urls).get('Columns')?.split(',') ?? [];
    expect(columns).toContain('[ID]');
    expect(columns).toContain('[Name]');
    expect(columns).toContain('[SerialNumber]');
    expect(columns.join(',')).not.toContain('BookValue');
    expect(result.unavailableFields).toContain('BookValue');
  });

  it('keeps a dotted expression only when its root attribute exists', async () => {
    const { client, urls } = fakeClient(['Name', 'Start', 'State']);
    await listDomain(client, new ColumnCache(), 'workflow_instances');

    const columns = fragmentQuery(urls).get('Columns') ?? '';
    expect(columns).toContain('[State].[DisplayString] AS [State]');
    expect(columns).not.toContain('StateReason');
  });

  it('omits the sort when the sort column is not available here', async () => {
    const { client, urls } = fakeClient(['SerialNumber']);
    await listDomain(client, new ColumnCache(), 'assets');
    expect(fragmentQuery(urls).get('Sort')).toBeNull();
  });

  it('sorts when the sort column survived resolution', async () => {
    const { client, urls } = fakeClient(['Name']);
    await listDomain(client, new ColumnCache(), 'assets');
    expect(fragmentQuery(urls).get('Sort')).toBe('Name ASC');
  });

  it('combines a caller filter and a search term with AND', async () => {
    const { client, urls } = fakeClient(['Name', 'Model']);
    await listDomain(client, new ColumnCache(), 'assets', {
      where: "Name = 'x'",
      search: 'thinkpad',
    });

    const where = fragmentQuery(urls).get('Where') ?? '';
    expect(where).toBe("(Name = 'x') AND ([Name] LIKE '%thinkpad%' OR [Model] LIKE '%thinkpad%')");
  });

  it('sends no filter for a search when no searchable field exists here', async () => {
    const { client, urls } = fakeClient(['AcquisitionDate']);
    await listDomain(client, new ColumnCache(), 'assets', { search: 'thinkpad' });
    expect(fragmentQuery(urls).get('Where')).toBeNull();
  });

  it('asks for one row beyond the limit so it can report that more exist', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ ID: String(i), Name: `n${i}` }));
    const { client, urls } = fakeClient(['Name'], rows);
    const result = await listDomain(client, new ColumnCache(), 'assets', { limit: 3 });

    expect(fragmentQuery(urls).get('PageSize')).toBe('4');
    expect(result.count).toBe(3);
    expect(result.hasMore).toBe(true);
    expect(result.hint).toMatch(/narrow/);
  });

  it('reports no more rows when the page came back short', async () => {
    const { client } = fakeClient(['Name'], [{ ID: '1', Name: 'a' }]);
    const result = await listDomain(client, new ColumnCache(), 'assets', { limit: 3 });
    expect(result.hasMore).toBe(false);
    expect(result.hint).toBeUndefined();
  });

  it('falls back to a default limit for a non-positive one', async () => {
    const { client, urls } = fakeClient(['Name']);
    await listDomain(client, new ColumnCache(), 'assets', { limit: 0 });
    expect(fragmentQuery(urls).get('PageSize')).toBe('26');
  });

  it('queries the base class the domain declares', async () => {
    const { client, urls } = fakeClient(['Name']);
    await listDomain(client, new ColumnCache(), 'slas');
    expect(urls.some((u) => u.includes('/data/fragments/SVCServiceLevelAgreementClassBase'))).toBe(true);
  });

  it('tolerates a definition that returns no rows array', async () => {
    const getJson = vi.fn(async (path: string) =>
      path.includes('/Schema/classes/') ? { Attributes: [{ InternalName: 'Name' }] } : null,
    );
    const client = { getJson } as unknown as M42Client;
    const result = await listDomain(client, new ColumnCache(), 'assets');
    expect(result.rows).toEqual([]);
    expect(result.count).toBe(0);
  });
});

describe('sortForProjection', () => {
  it('keeps the attribute name when the projection does not alias it', () => {
    expect(sortForProjection('Name ASC', ['Name'])).toBe('Name ASC');
  });

  it('follows the alias, because Matrix42 sorts the projected result set', () => {
    expect(sortForProjection('End DESC', ['End AS EndedOn'])).toBe('EndedOn DESC');
  });

  it('works without a direction', () => {
    expect(sortForProjection('Name', ['Name'])).toBe('Name');
  });

  it('falls back to the attribute when it is not in the projection', () => {
    expect(sortForProjection('Name ASC', ['Other'])).toBe('Name ASC');
  });
});

describe('the workflow instance domain, which a live run caught', () => {
  it('aliases End, a reserved word that fails as a bare column', () => {
    const preferred = DOMAINS.workflow_instances?.preferred ?? [];
    expect(preferred).not.toContain('End');
    expect(preferred.some((expression) => /^End\s+AS\s+/i.test(expression))).toBe(true);
  });

  it('sorts on a column the projection emits', async () => {
    const { client, urls } = fakeClient(['Name', 'Start', 'End', 'LastUpdate']);
    await listDomain(client, new ColumnCache(), 'workflow_instances');
    const sort = fragmentQuery(urls).get('Sort');
    expect(sort).toBe('LastUpdate DESC');
  });
});

describe('searchEverywhere', () => {
  it('rejects an unknown domain rather than silently searching fewer', async () => {
    const { client } = fakeClient(['Name']);
    await expect(searchEverywhere(client, new ColumnCache(), 'x', { domains: ['nope'] })).rejects.toThrow(
      /Unknown domain/,
    );
  });

  it('reports only the domains that actually matched', async () => {
    const { client } = fakeClient(['Name'], [{ ID: '1', Name: 'thinkpad' }]);
    const result = await searchEverywhere(client, new ColumnCache(), 'thinkpad', {
      domains: ['assets', 'contracts'],
    });
    expect(result.searched).toEqual(['assets', 'contracts']);
    expect(result.hits.every((hit) => hit.count > 0)).toBe(true);
  });

  it('drops a domain that returned nothing, keeping the answer readable', async () => {
    const { client } = fakeClient(['Name'], []);
    const result = await searchEverywhere(client, new ColumnCache(), 'nothing', { domains: ['assets'] });
    expect(result.hits).toEqual([]);
    expect(result.totalRows).toBe(0);
    expect(result.hint).toMatch(/search_tickets/);
  });

  it('survives one domain failing, instead of losing the whole search', async () => {
    const getJson = vi.fn(async (path: string) => {
      if (path.includes('SPSAssetClassBase')) throw new Error('module not installed');
      if (path.includes('/Schema/classes/')) return { Attributes: [{ InternalName: 'Name' }] };
      return [{ ID: '1', Name: 'hit' }];
    });
    const client = { getJson } as unknown as M42Client;

    const result = await searchEverywhere(client, new ColumnCache(), 'hit', {
      domains: ['assets', 'contracts'],
    });
    expect(result.skipped?.[0]?.domain).toBe('assets');
    expect(result.hits.map((hit) => hit.domain)).toEqual(['contracts']);
  });

  it('ranks the domain with the most matches first', async () => {
    const getJson = vi.fn(async (path: string) => {
      if (path.includes('/Schema/classes/')) return { Attributes: [{ InternalName: 'Name' }] };
      const many = path.includes('SPSContractClassBase');
      return many ? [{ ID: '1' }, { ID: '2' }, { ID: '3' }] : [{ ID: '1' }];
    });
    const client = { getJson } as unknown as M42Client;

    const result = await searchEverywhere(client, new ColumnCache(), 'x', {
      domains: ['assets', 'contracts'],
    });
    expect(result.hits[0]?.domain).toBe('contracts');
    expect(result.totalRows).toBe(4);
  });

  it('searches every domain when none are named', async () => {
    const { client } = fakeClient(['Name'], []);
    const result = await searchEverywhere(client, new ColumnCache(), 'x');
    expect(result.searched).toEqual(DOMAIN_NAMES);
  });
})

describe('the workflow definitions domain', () => {
  it('lives in the service repository, where workflows are components', () => {
    expect(DOMAINS.workflow_definitions?.class).toBe('PLSLComponentClassBase');
  });

  it('selects the System flag, which separates product workflows from custom ones', () => {
    expect(DOMAINS.workflow_definitions?.preferred).toContain('System');
  });
})
