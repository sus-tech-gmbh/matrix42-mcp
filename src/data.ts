// src/data.ts — reading records: fragment queries, single fragments, objects, and ASQL validation.

import type { M42Client } from './m42-client.js';

/** Column metadata returned alongside query results. */
export interface ColumnInfo {
  name: string;
  type: string;
  localizable?: boolean;
}

/** A record row: attribute name → value, exactly as Matrix42 returned it. */
export type RecordRow = Record<string, unknown>;

/** Result of a fragment query. */
export interface QueryResult {
  class: string;
  page: number;
  pageSize: number;
  count: number;
  hasMore: boolean;
  columns: ColumnInfo[];
  rows: RecordRow[];
  hint?: string;
}

/** Outcome of validating an ASQL expression. */
export interface ValidationResult {
  isValid: boolean;
  error?: string;
  /** Named parameters the expression declares, if any. */
  parameters?: unknown[];
}

/** Default page size — records are much wider than metadata, so this stays small. */
export const DEFAULT_PAGE_SIZE = 25;

/** Matrix42 attributes that carry query plumbing rather than business data. */
const NOISE_COLUMNS = ['Expression-TypeCase', 'Expression-TypeID'];

/** Options accepted by {@link queryFragments}. */
export interface QueryOptions {
  /** Comma-separated ASQL column expressions. Omitted → Matrix42's default column set. */
  columns?: string;
  /** ASQL filter expression. */
  where?: string;
  /** Sort expression, e.g. "CreatedDate DESC". */
  sort?: string;
  /** Rows per page. */
  pageSize?: number;
  /** 1-based page number (sent as Matrix42 zero-based PageNumber). */
  page?: number;
}

/** Shape of the schema-info response: rows plus the type of each returned column. */
interface SchemaInfoResponse {
  Result?: RecordRow[];
  Schema?: { ColumnName?: string; ColumnType?: string; Localizable?: boolean }[];
}

/** Projects the Schema array into lean column descriptors. */
export function projectColumns(schema: SchemaInfoResponse['Schema']): ColumnInfo[] {
  if (!Array.isArray(schema)) return [];
  return schema
    .filter((entry) => typeof entry?.ColumnName === 'string')
    .map((entry) => {
      const info: ColumnInfo = {
        name: entry.ColumnName as string,
        type: (entry.ColumnType ?? '').replace(/Type$/, '') || 'Unknown',
      };
      if (entry.Localizable) info.localizable = true;
      return info;
    });
}

/** Removes internal query plumbing that would otherwise take up context for no benefit. */
export function stripNoise(rows: RecordRow[]): RecordRow[] {
  return rows.map((row) => {
    const clean: RecordRow = {};
    for (const [key, value] of Object.entries(row)) {
      if (!NOISE_COLUMNS.includes(key)) clean[key] = value;
    }
    return clean;
  });
}

/**
 * Ensures ID is part of an explicit column list.
 *
 * Matrix42 sorts fragment queries by ID unless a Sort is given, and rejects sorting on a column
 * that was not selected — so a projection without ID fails with an opaque 500.
 */
export function withIdColumn(columns: string): string {
  const parts = columns.split(',').map((part) => part.trim()).filter(Boolean);
  const hasId = parts.some((part) => /^id$/i.test(part) || /\bas\s+id$/i.test(part));
  return hasId ? parts.join(',') : ['ID', ...parts].join(',');
}

/** Builds the query string for a fragment list request. */
export function buildQueryParams(options: QueryOptions, fetchSize: number, page: number): string {
  const params = new URLSearchParams();
  if (options.columns?.trim()) params.set('Columns', withIdColumn(options.columns));
  if (options.where?.trim()) params.set('Where', options.where.trim());
  if (options.sort?.trim()) params.set('Sort', options.sort.trim());
  params.set('PageSize', String(fetchSize));
  // Matrix42 pages fragments with a ZERO-based PageNumber; this tool exposes 1-based pages.
  if (page > 1) params.set('PageNumber', String(page - 1));
  return params.toString();
}

/**
 * Runs a fragment query against one data definition.
 *
 * Matrix42 exposes no total-count endpoint for fragments, so one extra row is requested to detect
 * whether a further page exists; the extra row is dropped before returning.
 */
export async function queryFragments(
  client: M42Client,
  className: string,
  options: QueryOptions = {},
): Promise<QueryResult> {
  const pageSize =
    options.pageSize !== undefined && options.pageSize > 0 ? options.pageSize : DEFAULT_PAGE_SIZE;
  const page = options.page !== undefined && options.page > 0 ? options.page : 1;
  const query = buildQueryParams(options, pageSize + 1, page);

  const response = await client.getJson<SchemaInfoResponse | RecordRow[]>(
    `m42Services/api/data/fragments/${encodeURIComponent(className)}/schema-info?${query}`,
  );

  // The schema-info variant answers {Result, Schema}; tolerate a bare array just in case.
  const raw = Array.isArray(response) ? response : (response.Result ?? []);
  const columns = Array.isArray(response) ? [] : projectColumns(response.Schema);

  const hasMore = raw.length > pageSize;
  const rows = stripNoise(hasMore ? raw.slice(0, pageSize) : raw);

  const result: QueryResult = {
    class: className,
    page,
    pageSize,
    count: rows.length,
    hasMore,
    columns,
    rows,
  };
  if (hasMore) {
    result.hint = `More rows exist — request page ${page + 1}, or narrow the 'where' filter.`;
  }
  return result;
}

/** Reads one complete fragment by its fragment id. */
export async function getFragment(
  client: M42Client,
  className: string,
  fragmentId: string,
): Promise<RecordRow> {
  const row = await client.getJson<RecordRow>(
    `m42Services/api/data/fragments/${encodeURIComponent(className)}/${encodeURIComponent(fragmentId)}`,
  );
  const [clean] = stripNoise([row]);
  return clean ?? row;
}

/** Reads one complete object (all fragments of a configuration item) by its object id. */
export async function getObject(
  client: M42Client,
  ciName: string,
  objectId: string,
): Promise<unknown> {
  return client.getJson<unknown>(
    `m42Services/api/data/objects/${encodeURIComponent(ciName)}/${encodeURIComponent(objectId)}`,
  );
}

/** Interprets the validator response, which reports failure via ErrorMessage rather than a status. */
export function interpretValidation(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { isValid: false, error: 'Validator returned an unreadable response' };
  }
  const body = raw as { IsValid?: unknown; ErrorMessage?: unknown; Parameters?: unknown };
  const error = typeof body.ErrorMessage === 'string' ? body.ErrorMessage : '';
  const parameters = Array.isArray(body.Parameters) ? body.Parameters : [];
  if (body.IsValid === true && !error) {
    return parameters.length > 0 ? { isValid: true, parameters } : { isValid: true };
  }
  return { isValid: false, error: error || 'Expression was rejected' };
}

/** Validates an ASQL expression against a data definition without running it. */
export async function validateAsql(
  client: M42Client,
  className: string,
  expression: string,
): Promise<ValidationResult> {
  const params = new URLSearchParams({ entityClass: className, expr: expression });
  const raw = await client.getJson<unknown>(
    `m42Services/api/Schema/evaluateParameterExpressionEntityClass?${params.toString()}`,
  );
  return interpretValidation(raw);
}
