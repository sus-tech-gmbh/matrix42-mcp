// test/tools.test.ts — unit tests for tool selection and result limiting.

import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, READ_TOOLS, selectTools } from '../src/tools/index.js';
import { DEFAULT_OPERATION_LIMIT, limitResults } from '../src/tools/webservice-discovery.js';

describe('ALL_TOOLS', () => {
  it('exposes the expected tool ids', () => {
    expect(ALL_TOOLS.map((tool) => tool.id)).toEqual([
      'server_info',
      'webservice_discovery',
      'schema_discovery',
      'data_query',
      'ticket_actions',
    ]);
  });

  it('gives every tool a non-empty summary', () => {
    for (const tool of ALL_TOOLS) expect(tool.summary.length).toBeGreaterThan(0);
  });
});

describe('selectTools', () => {
  it('returns every READ tool when no allow-list is configured', () => {
    const { tools, unknown } = selectTools([]);
    expect(tools).toHaveLength(READ_TOOLS.length);
    expect(unknown).toEqual([]);
  });

  it('returns every tool when no allow-list is configured and writes are enabled', () => {
    const { tools } = selectTools([], true);
    expect(tools).toHaveLength(ALL_TOOLS.length);
  });

  it('honours an explicit allow-list', () => {
    const { tools, unknown } = selectTools(['server_info']);
    expect(tools.map((tool) => tool.id)).toEqual(['server_info']);
    expect(unknown).toEqual([]);
  });

  it('reports unknown ids instead of failing silently', () => {
    const { tools, unknown } = selectTools(['server_info', 'nope']);
    expect(tools.map((tool) => tool.id)).toEqual(['server_info']);
    expect(unknown).toEqual(['nope']);
  });

  it('returns no tools when the allow-list matches nothing', () => {
    expect(selectTools(['nope']).tools).toEqual([]);
  });
});

describe('limitResults', () => {
  const items = Array.from({ length: 10 }, (_, index) => index);

  it('caps the list and reports the true total', () => {
    const { returned, total, truncated } = limitResults(items, 3);
    expect(returned).toEqual([0, 1, 2]);
    expect(total).toBe(10);
    expect(truncated).toBe(true);
  });

  it('does not flag truncation when everything fits', () => {
    expect(limitResults(items, 10)).toMatchObject({ total: 10, truncated: false });
  });

  it('treats 0 and negatives as "no limit"', () => {
    expect(limitResults(items, 0).returned).toHaveLength(10);
    expect(limitResults(items, -1).truncated).toBe(false);
  });

  it('uses a default limit that keeps large listings manageable', () => {
    expect(DEFAULT_OPERATION_LIMIT).toBeGreaterThan(0);
    const capped = limitResults(Array.from({ length: 1107 }), DEFAULT_OPERATION_LIMIT);
    expect(capped).toMatchObject({ total: 1107, truncated: true });
    expect(capped.returned).toHaveLength(DEFAULT_OPERATION_LIMIT);
  });
});
