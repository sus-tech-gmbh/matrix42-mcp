// src/columns.ts — resolves query columns from the live schema instead of assuming them.
//
// Attribute sets differ per instance: modules may be absent and customers add their own fields.
// A hardcoded column list therefore fails with an opaque 500 on the first instance that does not
// have one of the columns. Everything here asks the instance what exists before querying.

import type { M42Client } from './m42-client.js';

/** Attribute names of one data definition, as reported by the instance. */
export interface ClassAttributes {
  /** Attribute names exactly as Matrix42 spells them. */
  names: string[];
  /** Lower-cased lookup for case-insensitive matching. */
  lookup: Map<string, string>;
}

const CACHE_TTL_MS = 10 * 60_000;

/** Caches attribute lists for the process; the schema rarely changes during a session. */
export class ColumnCache {
  private entries = new Map<string, { value: ClassAttributes; at: number }>();

  get(className: string): ClassAttributes | undefined {
    const hit = this.entries.get(className);
    if (!hit) return undefined;
    return Date.now() - hit.at < CACHE_TTL_MS ? hit.value : undefined;
  }

  set(className: string, value: ClassAttributes): void {
    this.entries.set(className, { value, at: Date.now() });
  }
}

/** Reads the attribute names a data definition actually has on this instance. */
export async function getClassAttributes(
  client: M42Client,
  className: string,
  cache: ColumnCache,
): Promise<ClassAttributes> {
  const cached = cache.get(className);
  if (cached) return cached;

  const raw = await client.getJson<{ Attributes?: { InternalName?: unknown }[] }>(
    `m42Services/api/Schema/classes/${encodeURIComponent(className)}`,
  );
  const names = (raw.Attributes ?? [])
    .map((a) => a?.InternalName)
    .filter((n): n is string => typeof n === 'string' && n.length > 0);

  const lookup = new Map(names.map((n) => [n.toLowerCase(), n]));
  const value: ClassAttributes = { names, lookup };
  cache.set(className, value);
  return value;
}

/** Wraps one identifier in square brackets unless it already carries them. */
function bracketIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed;
  return `[${trimmed}]`;
}

/**
 * Escapes a column expression the way Matrix42's expression parser requires.
 *
 * The parser reserves words that collide with real attribute names — `End` is one, because it
 * closes a CASE block, so selecting it unescaped fails with a syntax error rather than anything
 * that names the column. Bracketing a name that is NOT reserved is harmless, so the reliable
 * strategy is to bracket unconditionally rather than maintain a keyword list that will go stale.
 *
 * Each segment of a dotted path is bracketed independently, and the alias after AS is bracketed
 * too — it is parsed as an identifier and can be reserved in its own right.
 */
export function bracketExpression(expression: string): string {
  const [pathPart = expression, aliasPart] = expression.split(/\s+as\s+/i);
  const path = pathPart
    .trim()
    .split('.')
    .map(bracketIdentifier)
    .join('.');
  return aliasPart ? `${path} AS ${bracketIdentifier(aliasPart)}` : path;
}

/**
 * The name a projected column is returned under.
 *
 * Sort is applied to the RESULT of the projection, so it must name whatever the projection emits —
 * the alias when one is given, otherwise the attribute itself — and it must NOT be bracketed.
 */
export function outputName(expression: string): string {
  const [pathPart = expression, aliasPart] = expression.split(/\s+as\s+/i);
  const bare = (aliasPart ?? pathPart).trim();
  return bare.replace(/^\[|\]$/g, '');
}

/** Outcome of matching a wished-for column list against what the instance really has. */
export interface ResolvedColumns {
  /** The column expression to send, always including ID and always bracket-escaped. */
  columns: string;
  /** Preferred columns that exist here. */
  used: string[];
  /** Preferred columns this instance does not have. */
  missing: string[];
}

/**
 * Keeps only the columns a data definition actually exposes.
 *
 * Three rules established against live instances:
 *  - ID is always requested. Matrix42 sorts fragment queries by ID and rejects a sort on a column
 *    that was not selected, so omitting it fails with an opaque 500. Note that ID does not appear
 *    in a class's Attributes list, so it is added rather than looked up.
 *  - DisplayString is never requested. Selecting it explicitly is rejected on every definition
 *    tested ("does not contain attribute DisplayString"), yet it is returned automatically with
 *    any projection — so asking for it can only break the query.
 *  - Every identifier is bracket-escaped, because the expression parser has reserved words.
 */
export function resolveColumns(available: ClassAttributes, preferred: string[]): ResolvedColumns {
  const used: string[] = [];
  const missing: string[] = [];

  for (const wanted of preferred) {
    const actual = available.lookup.get(wanted.toLowerCase());
    if (actual) used.push(actual);
    else missing.push(wanted);
  }

  const selectsId = used.some((name) => name.toLowerCase() === 'id');
  const selected = selectsId ? used : ['ID', ...used];
  return { columns: selected.map(bracketExpression).join(','), used, missing };
}

/** Resolves a preferred column list against the live schema in one call. */
export async function columnsFor(
  client: M42Client,
  className: string,
  preferred: string[],
  cache: ColumnCache,
): Promise<ResolvedColumns> {
  const available = await getClassAttributes(client, className, cache);
  return resolveColumns(available, preferred);
}
