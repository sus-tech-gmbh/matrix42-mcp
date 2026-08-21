// test/data.test.ts — unit tests for query building, result shaping, and validation parsing.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  buildQueryParams,
  interpretValidation,
  projectColumns,
  stripNoise,
} from '../src/data.js';

describe('buildQueryParams', () => {
  it('always sets a page size and omits absent options', () => {
    const params = new URLSearchParams(buildQueryParams({}, 26, 1));
    expect(params.get('PageSize')).toBe('26');
    expect(params.get('Columns')).toBeNull();
    expect(params.get('Where')).toBeNull();
    expect(params.get('Sort')).toBeNull();
    expect(params.get('Page')).toBeNull();
  });

  it('passes the ASQL options through', () => {
    const params = new URLSearchParams(
      buildQueryParams(
        { columns: 'ID,Subject', where: "Subject LIKE '%a%'", sort: 'Subject ASC' },
        11,
        1,
      ),
    );
    expect(params.get('Columns')).toBe('ID,Subject');
    expect(params.get('Where')).toBe("Subject LIKE '%a%'");
    expect(params.get('Sort')).toBe('Subject ASC');
  });

  it('sends no PageNumber for the first page', () => {
    expect(new URLSearchParams(buildQueryParams({}, 5, 1)).get('PageNumber')).toBeNull();
  });

  it('translates 1-based pages to the zero-based PageNumber Matrix42 expects', () => {
    expect(new URLSearchParams(buildQueryParams({}, 5, 2)).get('PageNumber')).toBe('1');
    expect(new URLSearchParams(buildQueryParams({}, 5, 3)).get('PageNumber')).toBe('2');
  });

  it('never sends a bare Page parameter, which Matrix42 ignores', () => {
    expect(new URLSearchParams(buildQueryParams({}, 5, 2)).get('Page')).toBeNull();
  });

  it('trims whitespace-only options away', () => {
    const params = new URLSearchParams(buildQueryParams({ columns: '   ', where: '  ' }, 5, 1));
    expect(params.get('Columns')).toBeNull();
    expect(params.get('Where')).toBeNull();
  });

  it('encodes expressions containing spaces and quotes', () => {
    const query = buildQueryParams({ where: "Name = 'a b'" }, 5, 1);
    expect(query).toContain('Where=');
    expect(new URLSearchParams(query).get('Where')).toBe("Name = 'a b'");
  });
});

describe('projectColumns', () => {
  it('maps column metadata and trims the Type suffix', () => {
    expect(
      projectColumns([
        { ColumnName: 'ID', ColumnType: 'GuidType', Localizable: false },
        { ColumnName: 'Subject', ColumnType: 'StringType', Localizable: true },
      ]),
    ).toEqual([
      { name: 'ID', type: 'Guid' },
      { name: 'Subject', type: 'String', localizable: true },
    ]);
  });

  it('returns an empty list when no schema was sent', () => {
    expect(projectColumns(undefined)).toEqual([]);
    expect(projectColumns([])).toEqual([]);
  });

  it('skips malformed entries and labels a missing type', () => {
    expect(projectColumns([{ ColumnType: 'GuidType' }, { ColumnName: 'X' }])).toEqual([
      { name: 'X', type: 'Unknown' },
    ]);
  });
});

describe('stripNoise', () => {
  it('drops internal query plumbing but keeps business data', () => {
    expect(
      stripNoise([
        {
          ID: 'guid-1',
          Subject: 'Printer broken',
          'Expression-ObjectID': 'obj-1',
          'Expression-TypeCase': 'noise',
          'Expression-TypeID': 'noise',
        },
      ]),
    ).toEqual([{ ID: 'guid-1', Subject: 'Printer broken', 'Expression-ObjectID': 'obj-1' }]);
  });

  it('keeps [Expression-ObjectID], which is the bridge to the object', () => {
    const [row] = stripNoise([{ 'Expression-ObjectID': 'obj-1' }]);
    expect(row).toHaveProperty('Expression-ObjectID');
  });

  it('handles an empty result set', () => {
    expect(stripNoise([])).toEqual([]);
  });
});

describe('interpretValidation', () => {
  it('accepts a valid expression', () => {
    expect(interpretValidation({ IsValid: true, Parameters: [] })).toEqual({ isValid: true });
  });

  it('reports the parameters a parameterised expression declares', () => {
    expect(interpretValidation({ IsValid: true, Parameters: [{ Name: '@x' }] })).toEqual({
      isValid: true,
      parameters: [{ Name: '@x' }],
    });
  });

  it('treats an ErrorMessage as invalid even without IsValid:false', () => {
    expect(
      interpretValidation({
        ErrorMessage: 'Class: SPSActivityClassBase does not contain attribute Nope!',
        Parameters: [],
      }),
    ).toEqual({
      isValid: false,
      error: 'Class: SPSActivityClassBase does not contain attribute Nope!',
    });
  });

  it('reports invalid without a message as rejected', () => {
    expect(interpretValidation({ IsValid: false })).toEqual({
      isValid: false,
      error: 'Expression was rejected',
    });
  });

  it('handles an unreadable response', () => {
    expect(interpretValidation(null).isValid).toBe(false);
    expect(interpretValidation('nope').isValid).toBe(false);
  });
});

describe('DEFAULT_PAGE_SIZE', () => {
  it('is small, because record rows are far wider than metadata', () => {
    expect(DEFAULT_PAGE_SIZE).toBeGreaterThan(0);
    expect(DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(50);
  });
});
