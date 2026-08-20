// src/schema.ts — schema exploration: data definitions, configuration items, and pickup values.
//
// Matrix42 returns numeric enums and omits properties equal to their default, so everything here
// decodes ids into names and treats "absent" as the documented default rather than as unknown.

import type { M42Client } from './m42-client.js';

// ── Enum decoding ───────────────────────────────────────────────────────────
// Values observed on live instances; unknown ids are surfaced as `Unknown(<n>)` rather than dropped.

const DATA_TYPES: Record<number, string> = {
  0: 'String',
  1: 'Guid',
  2: 'Int',
  3: 'Date',
  4: 'Long',
  5: 'Float',
  6: 'Blob',
  7: 'VirtualRelationEnd',
  8: 'Text',
  9: 'Bool',
  10: 'Decimal',
  11: 'ExpressionGuid',
  12: 'Bit',
  13: 'VarBinary',
  14: 'StringShort',
  15: 'Currency',
  16: 'CurrencyCode',
  200: 'Unknown',
};

const RELATION_TYPES: Record<number, string> = {
  0: 'OneToMany',
  1: 'ManyToMany',
  2: 'NullOrOneToOne',
  3: 'ZeroOrOneToMany',
  4: 'OneToOne',
  5: 'NoRelation',
  61440: 'ManyToOne',
  61442: 'OneToZeroOrOne',
  61443: 'ManyToZeroOrOne',
};

/** Cardinality of a data definition's membership in a configuration item. */
const CARDINALITIES: Record<number, string> = {
  0: 'Mandatory',
  1: 'Mandatory (Multi)',
  2: 'Optional',
  3: 'Optional (Multi)',
  99: 'NotDefined',
};

const CLASS_TYPES: Record<number, string> = {
  3: 'Data Definition',
  4: 'Pickup',
  9: 'Common Data Definition',
  10: 'View Based',
  12: 'Simple Data Definition',
  13: 'Simple Configuration Item Base',
};

/** Decodes an enum id, falling back to a readable marker for values we do not know. */
function decode(table: Record<number, string>, value: unknown, fallback: number): string {
  const id = typeof value === 'number' ? value : fallback;
  return table[id] ?? `Unknown(${id})`;
}

export const dataTypeName = (v: unknown): string => decode(DATA_TYPES, v, 200);
export const relationTypeName = (v: unknown): string => decode(RELATION_TYPES, v, 5);
export const classTypeName = (v: unknown): string => decode(CLASS_TYPES, v, -1);

/**
 * Decodes a cardinality. Matrix42 omits the property when it equals the default, so an absent
 * value means Mandatory (0) — not "unknown".
 */
export const cardinalityName = (v: unknown): string => decode(CARDINALITIES, v, 0);

// ── Result shapes ───────────────────────────────────────────────────────────

/** One data definition in a listing. */
export interface DataDefinitionSummary {
  internalName: string;
  displayName: string;
  description: string;
  classType: string;
  isPickup: boolean;
  isCustom: boolean;
}

/** One configuration item in a listing. */
export interface ConfigurationItemSummary {
  internalName: string;
  displayName: string;
  description: string;
  mainClass: string;
  dataDefinitions: string[];
  isCustom: boolean;
}

/** One attribute of a data definition. */
export interface AttributeInfo {
  name: string;
  displayName: string;
  datatype: string;
  description?: string;
  allowNull?: boolean;
  length?: number;
  /** Set when the attribute is a pickup: the class holding its selectable values. */
  pickupClass?: string;
  defaultValue?: string;
}

/** One relation of a data definition. */
export interface RelationInfo {
  name: string;
  type: string;
  leftClass: string;
  leftAttribute: string;
  rightClass: string;
  rightAttribute: string;
}

/** A selectable value of a pickup class. */
export interface PickupValue {
  value: number | string;
  label: string;
}

type Row = Record<string, unknown>;

const str = (row: Row, key: string): string => (typeof row[key] === 'string' ? (row[key] as string) : '');
const num = (row: Row, key: string): number | undefined =>
  typeof row[key] === 'number' ? (row[key] as number) : undefined;
const nested = (row: Row, key: string, field = 'InternalName'): string => {
  const value = row[key];
  if (value && typeof value === 'object') {
    const inner = (value as Row)[field];
    if (typeof inner === 'string') return inner;
  }
  return '';
};

// ── Cached instance metadata ────────────────────────────────────────────────

/** Cached per-instance schema listings; the schema rarely changes during a session. */
interface CacheEntry<T> {
  value: T;
  at: number;
}

const CACHE_TTL_MS = 10 * 60_000;

export class SchemaCache {
  private classes?: CacheEntry<DataDefinitionSummary[]>;
  private items?: CacheEntry<ConfigurationItemSummary[]>;
  private customPrefix?: CacheEntry<string>;

  private fresh<T>(entry: CacheEntry<T> | undefined): T | undefined {
    return entry && Date.now() - entry.at < CACHE_TTL_MS ? entry.value : undefined;
  }

  getClasses(): DataDefinitionSummary[] | undefined {
    return this.fresh(this.classes);
  }
  setClasses(value: DataDefinitionSummary[]): void {
    this.classes = { value, at: Date.now() };
  }
  getItems(): ConfigurationItemSummary[] | undefined {
    return this.fresh(this.items);
  }
  setItems(value: ConfigurationItemSummary[]): void {
    this.items = { value, at: Date.now() };
  }
  getCustomPrefix(): string | undefined {
    return this.fresh(this.customPrefix);
  }
  setCustomPrefix(value: string): void {
    this.customPrefix = { value, at: Date.now() };
  }
}

/**
 * Returns the prefix this instance uses for customer-created schema objects (e.g. "MTX_").
 * Instance-specific, so it is read from the API rather than assumed.
 */
export async function getCustomPrefix(client: M42Client, cache: SchemaCache): Promise<string> {
  const cached = cache.getCustomPrefix();
  if (cached !== undefined) return cached;
  try {
    const prefix = await client.getJson<string>('m42Services/api/Schema/customPrefix');
    const value = typeof prefix === 'string' ? prefix : '';
    cache.setCustomPrefix(value);
    return value;
  } catch {
    cache.setCustomPrefix('');
    return '';
  }
}

/** Reads name → description pairs from the metadata service, which carries docs the class list lacks. */
async function fetchDescriptions(client: M42Client, path: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { body, status } = await client.request(
      'POST',
      `m42Services/api/SchemaMetaData/${path}`,
      JSON.stringify({ NameStartsWith: '', Options: 0 }),
    );
    if (status < 200 || status >= 300) return map;
    const rows = JSON.parse(body) as Row[];
    for (const row of rows) {
      const name = str(row, 'Name');
      const description = str(row, 'Description');
      if (name && description) map.set(name, description);
    }
  } catch {
    // Descriptions are an enrichment: listings stay usable without them.
  }
  return map;
}

// ── Listings ────────────────────────────────────────────────────────────────

/** Projects the raw class list, joining in descriptions and marking customer-created classes. */
export function projectDataDefinitions(
  rows: Row[],
  descriptions: Map<string, string>,
  customPrefix: string,
): DataDefinitionSummary[] {
  return rows.map((row) => {
    const internalName = str(row, 'InternalName');
    return {
      internalName,
      displayName: str(row, 'DisplayName'),
      description: descriptions.get(internalName) ?? '',
      classType: classTypeName(row['ClassType']),
      isPickup: row['IsPickup'] === true,
      isCustom: customPrefix !== '' && internalName.startsWith(customPrefix),
    };
  });
}

/** Projects the raw type list into configuration-item summaries. */
export function projectConfigurationItems(
  rows: Row[],
  descriptions: Map<string, string>,
  customPrefix: string,
): ConfigurationItemSummary[] {
  return rows.map((row) => {
    const internalName = str(row, 'InternalName');
    const related = row['RelatedClasses'];
    return {
      internalName,
      displayName: str(row, 'DisplayName'),
      description: descriptions.get(internalName) ?? '',
      mainClass: str(row, 'MainClassName'),
      dataDefinitions: Array.isArray(related) ? related.filter((r): r is string => typeof r === 'string') : [],
      isCustom: customPrefix !== '' && internalName.startsWith(customPrefix),
    };
  });
}

/** Case-insensitive match over the fields a model would search on. */
export function matchesSearch(
  entry: { internalName: string; displayName: string; description: string },
  search?: string,
): boolean {
  const term = search?.trim().toLowerCase();
  if (!term) return true;
  return (
    entry.internalName.toLowerCase().includes(term) ||
    entry.displayName.toLowerCase().includes(term) ||
    entry.description.toLowerCase().includes(term)
  );
}

/** Lists data definitions, optionally filtered by a search term and excluding pickup classes. */
export async function listDataDefinitions(
  client: M42Client,
  cache: SchemaCache,
  options: { search?: string; includePickups?: boolean } = {},
): Promise<DataDefinitionSummary[]> {
  let all = cache.getClasses();
  if (!all) {
    const [rows, descriptions, customPrefix] = await Promise.all([
      client.getJson<Row[]>('m42Services/api/Schema/classes'),
      fetchDescriptions(client, 'DataDefinitions'),
      getCustomPrefix(client, cache),
    ]);
    all = projectDataDefinitions(rows, descriptions, customPrefix);
    cache.setClasses(all);
  }
  const withPickups = options.includePickups ? all : all.filter((entry) => !entry.isPickup);
  return withPickups.filter((entry) => matchesSearch(entry, options.search));
}

/** Lists configuration items, optionally filtered by a search term. */
export async function listConfigurationItems(
  client: M42Client,
  cache: SchemaCache,
  options: { search?: string } = {},
): Promise<ConfigurationItemSummary[]> {
  let all = cache.getItems();
  if (!all) {
    const [rows, descriptions, customPrefix] = await Promise.all([
      client.getJson<Row[]>('m42Services/api/Schema/types'),
      fetchDescriptions(client, 'ConfigurationItems'),
      getCustomPrefix(client, cache),
    ]);
    all = projectConfigurationItems(rows, descriptions, customPrefix);
    cache.setItems(all);
  }
  return all.filter((entry) => matchesSearch(entry, options.search));
}

// ── Detail ──────────────────────────────────────────────────────────────────

/** Projects the Attributes array of a class detail response. */
export function projectAttributes(rows: Row[]): AttributeInfo[] {
  return rows.map((row) => {
    const info: AttributeInfo = {
      name: str(row, 'InternalName'),
      displayName: str(row, 'DisplayName'),
      datatype: dataTypeName(row['Datatype']),
    };
    const description = str(row, 'Description');
    if (description) info.description = description;
    // AllowNull is omitted when false, so only report it when Matrix42 sent it.
    if (typeof row['AllowNull'] === 'boolean') info.allowNull = row['AllowNull'];
    const length = num(row, 'Length');
    if (length !== undefined && length > 0) info.length = length;
    const pickupClass = nested(row, 'PickupClass');
    if (pickupClass) info.pickupClass = pickupClass;
    const defaultValue = str(row, 'DefaultValue');
    if (defaultValue) info.defaultValue = defaultValue;
    return info;
  });
}

/** Projects the Relations array of a class detail response. */
export function projectRelations(rows: Row[]): RelationInfo[] {
  return rows.map((row) => ({
    name: str(row, 'InternalName'),
    type: relationTypeName(row['RelationType']),
    leftClass: nested(row, 'ClassLeft'),
    leftAttribute: str(row, 'AttributeNameLeft'),
    rightClass: nested(row, 'ClassRight'),
    rightAttribute: str(row, 'AttributeNameRight'),
  }));
}

/** What a describe_data_definition call should include. */
export type DetailInclude = 'attributes' | 'relations' | 'both';

/** Full description of one data definition, trimmed to what a model needs. */
export interface DataDefinitionDetail {
  internalName: string;
  displayName: string;
  description: string;
  classType: string;
  isPickup: boolean;
  displayExpression: string;
  usedInConfigurationItems: string[];
  attributeCount: number;
  relationCount: number;
  attributes?: AttributeInfo[];
  relations?: RelationInfo[];
  note?: string;
}

/**
 * Describes one data definition. Relations are excluded by default: a core class can carry well
 * over a hundred of them, which would dwarf the attribute list a model usually wants.
 */
export async function describeDataDefinition(
  client: M42Client,
  name: string,
  include: DetailInclude = 'attributes',
): Promise<DataDefinitionDetail> {
  const raw = await client.getJson<Row>(
    `m42Services/api/Schema/classes/${encodeURIComponent(name)}`,
  );
  const attributes = Array.isArray(raw['Attributes']) ? (raw['Attributes'] as Row[]) : [];
  const relations = Array.isArray(raw['Relations']) ? (raw['Relations'] as Row[]) : [];
  const usedIn = Array.isArray(raw['UsedInTypes']) ? (raw['UsedInTypes'] as Row[]) : [];

  const detail: DataDefinitionDetail = {
    internalName: str(raw, 'InternalName'),
    displayName: str(raw, 'DisplayName'),
    description: str(raw, 'Description'),
    classType: classTypeName(raw['ClassType']),
    isPickup: raw['IsPickup'] === true,
    displayExpression: str(raw, 'DisplayExpression'),
    usedInConfigurationItems: usedIn.map((row) => str(row, 'InternalName')).filter(Boolean),
    attributeCount: attributes.length,
    relationCount: relations.length,
  };
  if (include === 'attributes' || include === 'both') detail.attributes = projectAttributes(attributes);
  if (include === 'relations' || include === 'both') detail.relations = projectRelations(relations);
  if (include === 'attributes' && relations.length > 0) {
    detail.note = `${relations.length} relations are not shown — call again with include='relations' or 'both'.`;
  }
  return detail;
}

/** One data definition's membership in a configuration item. */
export interface RelatedClassInfo {
  internalName: string;
  displayName: string;
  cardinality: string;
  classType: string;
  isMultiFragment: boolean;
}

/** Full description of one configuration item. */
export interface ConfigurationItemDetail {
  internalName: string;
  displayName: string;
  description: string;
  displayExpression: string;
  mainClass: string;
  baseClass: string;
  dataDefinitions: RelatedClassInfo[];
}

/** Projects the RelatedClasses array of a type detail response. */
export function projectRelatedClasses(rows: Row[]): RelatedClassInfo[] {
  return rows.map((row) => {
    // Cardinality is omitted when it is 0 (Mandatory) — absence is a value, not a gap.
    const cardinalityId = typeof row['Cardinality'] === 'number' ? (row['Cardinality'] as number) : 0;
    return {
      internalName: str(row, 'InternalName'),
      displayName: str(row, 'DisplayName'),
      cardinality: cardinalityName(cardinalityId),
      classType: classTypeName(row['ClassType']),
      isMultiFragment: cardinalityId === 1 || cardinalityId === 3,
    };
  });
}

/** Describes one configuration item and the data definitions it is composed of. */
export async function describeConfigurationItem(
  client: M42Client,
  name: string,
): Promise<ConfigurationItemDetail> {
  const raw = await client.getJson<Row>(`m42Services/api/Schema/types/${encodeURIComponent(name)}`);
  const related = Array.isArray(raw['RelatedClasses']) ? (raw['RelatedClasses'] as Row[]) : [];
  return {
    internalName: str(raw, 'InternalName'),
    displayName: str(raw, 'DisplayName'),
    description: str(raw, 'Description'),
    displayExpression: str(raw, 'DisplayExpression'),
    mainClass: nested(raw, 'MainClass'),
    baseClass: nested(raw, 'BaseClass'),
    dataDefinitions: projectRelatedClasses(related),
  };
}

// ── Pickup values ───────────────────────────────────────────────────────────

/** Candidate label columns, most common first. Pickup classes do not all use the same one. */
const LABEL_COLUMNS = ['DisplayString', 'DisplayText', 'DisplayValue', 'Name'] as const;

/**
 * Picks the value and label columns for a pickup class from its actual attribute list.
 * Most pickups expose Value/DisplayString, but a minority use a different label column and a few
 * expose no label at all — so the columns are resolved instead of assumed.
 */
export function resolvePickupColumns(attributeNames: string[]): {
  valueColumn: string;
  labelColumn?: string;
  sortColumn: string;
} {
  const has = (name: string): boolean => attributeNames.includes(name);
  const valueColumn = has('Value') ? 'Value' : (attributeNames[0] ?? 'Value');
  const labelColumn = LABEL_COLUMNS.find(has);
  // Position is the order the product displays options in; fall back to the value.
  const sortColumn = has('Position') ? 'Position' : valueColumn;
  return labelColumn ? { valueColumn, labelColumn, sortColumn } : { valueColumn, sortColumn };
}

/** Projects pickup fragment rows into {value, label} pairs. */
export function projectPickupValues(
  rows: Row[],
  valueColumn: string,
  labelColumn?: string,
): PickupValue[] {
  return rows.map((row) => {
    const raw = row[valueColumn];
    const value = typeof raw === 'number' || typeof raw === 'string' ? raw : '';
    const label = labelColumn ? str(row, labelColumn) : '';
    return { value, label };
  });
}

/** Reads the selectable values of a pickup class. */
export async function getPickupValues(
  client: M42Client,
  pickupClass: string,
): Promise<{ pickupClass: string; count: number; values: PickupValue[] }> {
  const detail = await client.getJson<Row>(
    `m42Services/api/Schema/classes/${encodeURIComponent(pickupClass)}`,
  );
  const attributes = Array.isArray(detail['Attributes']) ? (detail['Attributes'] as Row[]) : [];
  const names = attributes.map((row) => str(row, 'InternalName')).filter(Boolean);
  const { valueColumn, labelColumn, sortColumn } = resolvePickupColumns(names);

  // Matrix42 rejects a Sort on a column that was not selected, so the sort column is always
  // requested even when it is not part of the projected result.
  const requested = [...new Set([valueColumn, ...(labelColumn ? [labelColumn] : []), sortColumn])];
  const params = new URLSearchParams({
    Columns: requested.join(","),
    Sort: `${sortColumn} ASC`,
  });
  const rows = await client.getJson<Row[]>(
    `m42Services/api/data/fragments/${encodeURIComponent(pickupClass)}?${params.toString()}`,
  );
  const values = projectPickupValues(rows, valueColumn, labelColumn);
  return { pickupClass, count: values.length, values };
}

/** Finds the pickup class backing one attribute of a data definition. */
export async function findPickupClass(
  client: M42Client,
  className: string,
  attributeName: string,
): Promise<string> {
  const raw = await client.getJson<Row>(
    `m42Services/api/Schema/classes/${encodeURIComponent(className)}`,
  );
  const attributes = Array.isArray(raw['Attributes']) ? (raw['Attributes'] as Row[]) : [];
  const match = attributes.find(
    (row) => str(row, 'InternalName').toLowerCase() === attributeName.toLowerCase(),
  );
  if (!match) throw new Error(`${className} has no attribute named '${attributeName}'`);
  const pickupClass = nested(match, 'PickupClass');
  if (!pickupClass) {
    throw new Error(`${className}.${attributeName} is not a pickup attribute, so it has no value list`);
  }
  return pickupClass;
}
