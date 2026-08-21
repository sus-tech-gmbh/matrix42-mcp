// src/domains.ts — curated views over the base classes that carry Matrix42's functional areas.
//
// Encodes the "one graph" model directly: each entry names a base data definition plus the fields
// worth showing. Columns are resolved against the live schema before every query, never assumed —
// instances differ in which modules are installed and which fields customers added.

import { ColumnCache, bracketExpression, columnsFor, outputName } from './columns.js';
import type { M42Client } from './m42-client.js';
import { stripNoise, type RecordRow } from './data.js';

/** One browsable domain: a base class plus the fields worth showing for it. */
export interface DomainSpec {
  /** Base data definition this domain lives in. */
  class: string;
  /** One line on what the domain holds. */
  description: string;
  /** Fields to show when present. Missing ones are reported, not fatal. */
  preferred: string[];
  /** Fields a free-text search should match against, when present. */
  searchable: string[];
  /** Default sort expression; must reference a selected column. */
  sort?: string;
}

/**
 * The domain registry. Names are the vocabulary a model uses; the class is where the data really
 * lives. Several domains deliberately share a base class — that is the point of the model.
 */
export const DOMAINS: Record<string, DomainSpec> = {
  assets: {
    class: 'SPSAssetClassBase',
    description:
      'Hardware assets. The same definition also backs licenses (configuration item SPSAssetTypeLicense).',
    preferred: [
      'Name', 'InventoryNumber', 'SerialNumber', 'Model', 'ManufacturerName', 'SupplierName',
      'AcquisitionDate', 'GuarantyEndDate', 'EndOfLifeDueDate', 'BookValue', 'Description',
    ],
    searchable: ['Name', 'InventoryNumber', 'SerialNumber', 'Model', 'ManufacturerName'],
    sort: 'Name ASC',
  },
  stock_units: {
    class: 'SPSStockKeepingUnitClassBase',
    description: 'Stock keeping units — the device models assets are procured and classified by.',
    preferred: ['Name', 'Model', 'ExternalId', 'Description'],
    searchable: ['Name', 'Model', 'ExternalId'],
    sort: 'Name ASC',
  },
  contracts: {
    class: 'SPSContractClassBase',
    description:
      'Contracts of every kind. Service level agreements are contracts too — see the slas domain for their service-level fields.',
    preferred: [
      'Name', 'ContractID', 'ValidFrom', 'ValidUntil', 'UnlimitedValidity', 'CancellationDate',
      'FirstCancellationDate', 'RenewalPeriod', 'OriginalExpirationDate',
    ],
    searchable: ['Name', 'ContractID'],
    sort: 'Name ASC',
  },
  slas: {
    class: 'SVCServiceLevelAgreementClassBase',
    description:
      'Service level agreements, with their targets. The contract side of the same object is in the contracts domain.',
    preferred: [
      'Name', 'ContractID', 'ValidFrom', 'ValidUntil', 'AgreedAvailability', 'DeliveryTime',
      'MTBF', 'MTRS', 'MTBSI', 'Description',
    ],
    searchable: ['Name', 'ContractID', 'Description'],
    sort: 'Name ASC',
  },
  catalog_services: {
    class: 'SPSArticleClassBase',
    description: 'Catalog services, bundles and groups — everything orderable is an article.',
    preferred: ['Name', 'SSPName', 'Description', 'ActiveFrom', 'MinDeliveryTime'],
    searchable: ['Name', 'SSPName', 'Description'],
    sort: 'Name ASC',
  },
  bookings: {
    class: 'SVCServiceBookingClassBase',
    description:
      'Service bookings — one per service and recipient in an order. Carries four INDEPENDENT status axes: approval, provisioning, accounting and acceptance.',
    preferred: [
      'ServiceName', 'BookingID', 'CreatedDate', 'ApprovedDate', 'ProvisionedDate', 'AcceptedDate',
      'OrderAmount', 'Comment',
      'ApprovalStatus.DisplayString AS ApprovalStatus',
      'ProvisioningStatus.DisplayString AS ProvisioningStatus',
      'AccountingStatus.DisplayString AS AccountingStatus',
      'AcceptanceStatus.DisplayString AS AcceptanceStatus',
    ],
    searchable: ['ServiceName', 'BookingID'],
    sort: 'CreatedDate DESC',
  },
  kb_articles: {
    class: 'SVMKBArticleClassBase',
    description: 'Knowledge base articles.',
    preferred: [
      'Subject', 'ArticleID', 'Keywords', 'Version', 'CreatedOn', 'LastRevisedOn', 'ExpiresOn',
      'VisibleInSSP', 'Featured', 'SolutionText',
    ],
    searchable: ['Subject', 'ArticleID', 'Keywords', 'SolutionText'],
    sort: 'CreatedOn DESC',
  },
  approvals: {
    class: 'SVCApprovalTaskClassBase',
    description: 'Approval tasks — a responsible person or role deciding on a request.',
    preferred: ['TicketNumber', 'CreatedDate', 'ClosedDate', 'Proceeded', 'Reason', 'IsCommonOrderApproval'],
    searchable: ['TicketNumber', 'Reason'],
    sort: 'CreatedDate DESC',
  },
  imports: {
    class: 'GDIEImportClassBase',
    description: 'Data Gateway import definitions, with the result of their last run.',
    preferred: ['Name', 'Description', 'Created', 'LastAccessed', 'LastResult.DisplayString AS LastResult'],
    searchable: ['Name', 'Description'],
    sort: 'Name ASC',
  },
  import_runs: {
    class: 'GDIEImportLogClassBase',
    description: 'Import run logs — start and end times, outcome and per-phase summaries.',
    preferred: [
      'StartTime', 'EndTime', 'DestTypeName', 'Initiator', 'ImportSummary', 'ValidationSummary',
      'MatchingSummary', 'StagingSummary', 'Result.DisplayString AS Result',
    ],
    searchable: ['DestTypeName', 'Initiator'],
    sort: 'StartTime DESC',
  },
  workflow_instances: {
    class: 'PLSLProcessInstanceClassBase',
    description:
      'Workflow / process instances and the state they are in. Read-only: this server does not suspend, resume or cancel them.',
    preferred: [
      'Name', 'Start', 'End AS EndedOn', 'LastUpdate', 'Summary',
      'State.DisplayString AS State', 'StateReason.DisplayString AS StateReason',
    ],
    searchable: ['Name', 'Summary'],
    sort: 'LastUpdate DESC',
  },
  workflow_definitions: {
    class: 'PLSLComponentClassBase',
    description:
      'Workflow and component definitions in the Service Repository. The System flag separates what shipped with Matrix42 from what this customer built — filter on it to find custom workflows.',
    preferred: [
      'Name', 'Title', 'Description', 'Type.DisplayString AS Type', 'System', 'Hidden',
      'CreatedDate', 'LockedDate',
    ],
    searchable: ['Name', 'Title', 'Description'],
    sort: 'Name ASC',
  },
  applications: {
    class: 'SPSApplicationClassBase',
    description: 'Applications reported by inventory.',
    preferred: ['Name', 'Version', 'Manufacturer'],
    searchable: ['Name', 'Manufacturer', 'Version'],
    sort: 'Name ASC',
  },
};

/** Names a model can pass as `domain`. */
export const DOMAIN_NAMES = Object.keys(DOMAINS) as [string, ...string[]];

/** A domain listing, including which requested fields this instance does not have. */
export interface DomainResult {
  domain: string;
  class: string;
  count: number;
  hasMore: boolean;
  rows: RecordRow[];
  /** Preferred fields absent on this instance — usually a module that is not installed. */
  unavailableFields?: string[];
  hint?: string;
}

/**
 * The attribute an expression ultimately depends on.
 *
 * Both column expressions ("State.DisplayString AS State") and sort expressions ("Name ASC") are
 * only usable if that attribute exists here, so both are reduced the same way.
 */
export function rootAttribute(expression: string): string {
  const withoutAlias = expression.split(/\s+as\s+/i)[0] ?? expression;
  const withoutDirection = withoutAlias.replace(/\s+(asc|desc)\s*$/i, '');
  return (withoutDirection.split('.')[0] ?? withoutDirection).trim();
}

/**
 * Rewrites a sort expression to name the projected output.
 *
 * "End DESC" has to become "EndTime DESC" once the projection aliases [End] AS EndTime, because
 * Matrix42 applies the sort to the result set and rejects a name the result does not carry.
 */
export function sortForProjection(sort: string, projection: string[]): string {
  const direction = /\s+(asc|desc)\s*$/i.exec(sort);
  const root = rootAttribute(sort);
  const projected = projection.find(
    (expression) => rootAttribute(expression).toLowerCase() === root.toLowerCase(),
  );
  const name = projected ? outputName(projected) : root;
  return direction ? `${name}${direction[0].replace(/\s+$/, '')}` : name;
}

/** Builds an ASQL filter matching a term against whichever searchable fields exist here. */
export function buildSearchFilter(term: string, available: string[]): string {
  const escaped = term.replace(/'/g, "''");
  return available.map((field) => `${field} LIKE '%${escaped}%'`).join(' OR ');
}

/**
 * Lists one domain.
 *
 * Column resolution happens against the live schema on every call, so a definition that lacks a
 * field on this instance simply drops it from the projection instead of failing the query.
 */
export async function listDomain(
  client: M42Client,
  cache: ColumnCache,
  domain: string,
  options: { search?: string; limit?: number; where?: string } = {},
): Promise<DomainResult> {
  const spec = DOMAINS[domain];
  if (!spec) throw new Error(`Unknown domain '${domain}'. Known: ${DOMAIN_NAMES.join(', ')}`);

  // Resolve every preferred field, keyed on the root attribute so dotted expressions survive.
  const roots = spec.preferred.map(rootAttribute);
  const resolved = await columnsFor(client, spec.class, roots, cache);
  const usable = spec.preferred.filter((expression) => resolved.used.includes(rootAttribute(expression)));
  const selectsId = usable.some((expression) => rootAttribute(expression).toLowerCase() === 'id');
  const columns = (selectsId ? usable : ['ID', ...usable]).map(bracketExpression).join(',');

  const clauses: string[] = [];
  if (options.where?.trim()) clauses.push(`(${options.where.trim()})`);
  if (options.search?.trim()) {
    const searchable = spec.searchable
      .filter((field) => resolved.used.includes(rootAttribute(field)))
      .map(bracketExpression);
    if (searchable.length > 0) clauses.push(`(${buildSearchFilter(options.search.trim(), searchable)})`);
  }

  const limit = options.limit !== undefined && options.limit > 0 ? options.limit : 25;
  const params = new URLSearchParams({ Columns: columns, PageSize: String(limit + 1) });
  if (clauses.length) params.set('Where', clauses.join(' AND '));
  // Sort only on a column that survived resolution, or Matrix42 rejects it. It must name what the
  // projection EMITS — the alias where one is applied — and must not be bracketed.
  if (spec.sort && resolved.used.includes(rootAttribute(spec.sort))) {
    params.set('Sort', sortForProjection(spec.sort, usable));
  }

  const raw = await client.getJson<RecordRow[]>(
    `m42Services/api/data/fragments/${encodeURIComponent(spec.class)}?${params.toString()}`,
  );
  const list = Array.isArray(raw) ? raw : [];
  const hasMore = list.length > limit;
  const rows = stripNoise(hasMore ? list.slice(0, limit) : list);

  const result: DomainResult = {
    domain,
    class: spec.class,
    count: rows.length,
    hasMore,
    rows,
  };
  if (resolved.missing.length > 0) result.unavailableFields = resolved.missing;
  if (hasMore) result.hint = `More rows exist — narrow with 'search' or raise 'limit'.`;
  return result;
}

/** What one domain contributed to a cross-domain search. */
export interface SearchHit {
  domain: string;
  class: string;
  count: number;
  rows: RecordRow[];
  /** Why this domain could not be searched, when it could not. */
  error?: string;
}

/** The result of searching everywhere at once. */
export interface GlobalSearchResult {
  term: string;
  searched: string[];
  totalRows: number;
  hits: SearchHit[];
  /** Domains that failed, usually because the module is not installed here. */
  skipped?: { domain: string; reason: string }[];
  hint?: string;
}

/**
 * Searches every curated domain for one term.
 *
 * Each domain is searched independently and a failure in one never sinks the rest — an instance
 * missing a module should still answer for everything it does have. Domains that returned nothing
 * are dropped from the result so the answer stays readable.
 */
export async function searchEverywhere(
  client: M42Client,
  cache: ColumnCache,
  term: string,
  options: { domains?: string[]; limit?: number } = {},
): Promise<GlobalSearchResult> {
  const names = options.domains?.length ? options.domains : DOMAIN_NAMES;
  const unknown = names.filter((name) => !DOMAINS[name]);
  if (unknown.length > 0) {
    throw new Error(`Unknown domain(s): ${unknown.join(', ')}. Known: ${DOMAIN_NAMES.join(', ')}`);
  }

  const limit = options.limit !== undefined && options.limit > 0 ? options.limit : 5;
  const settled = await Promise.allSettled(
    names.map((name) => listDomain(client, cache, name, { search: term, limit })),
  );

  const hits: SearchHit[] = [];
  const skipped: { domain: string; reason: string }[] = [];

  settled.forEach((outcome, index) => {
    const domain = names[index] ?? '';
    if (outcome.status === 'rejected') {
      const reason = outcome.reason;
      skipped.push({
        domain,
        reason: reason instanceof Error ? reason.message : String(reason),
      });
      return;
    }
    if (outcome.value.count > 0) {
      hits.push({
        domain,
        class: outcome.value.class,
        count: outcome.value.count,
        rows: outcome.value.rows,
      });
    }
  });

  hits.sort((a, b) => b.count - a.count);
  const result: GlobalSearchResult = {
    term,
    searched: names,
    totalRows: hits.reduce((sum, hit) => sum + hit.count, 0),
    hits,
  };
  if (skipped.length > 0) result.skipped = skipped;
  if (hits.length === 0) {
    result.hint =
      'Nothing matched. Tickets are not included here — search those with action=\'search_tickets\'.';
  }
  return result;
}
