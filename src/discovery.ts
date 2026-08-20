// src/discovery.ts — web service discovery against the Matrix42 metadata surface.

import type { M42Client } from './m42-client.js';

/** One web service as returned to the model. */
export interface ServiceSummary {
  id: string;
  name: string;
  routePrefix: string;
  implementationType: string;
  documentation: string;
}

/** One web service operation as returned to the model. */
export interface OperationSummary {
  id: string;
  name: string;
  method: string;
  path: string;
  service: string;
  serviceRoute: string;
  isPublic: boolean;
  documentation: string;
}

/** A raw fragment row: attribute names are Matrix42's, values are loosely typed. */
type FragmentRow = Record<string, unknown>;

const SERVICE_CLASS = 'PLSLServiceClassBase';
const OPERATION_CLASS = 'PLSLWebServiceOperation';

const SERVICE_COLUMNS = 'Name,ID,RoutePrefix,ImplementationType,Documentation,IsPublished';
const OPERATION_COLUMNS = [
  'ID',
  'Name',
  'Documentation',
  'RouteTemplate',
  'Type.DisplayString AS Method',
  'IsPublic',
  'Service.Name AS ServiceName',
  'Service.RoutePrefix AS ServiceRoute',
].join(',');

/** Reads a string attribute from a fragment row, defaulting to ''. */
function str(row: FragmentRow, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

/** Reads a boolean-ish attribute (Matrix42 returns 0/1) from a fragment row. */
function bool(row: FragmentRow, key: string): boolean {
  const value = row[key];
  return value === true || value === 1 || value === '1';
}

/** Projects raw service fragments into lean summaries. */
export function projectServices(rows: FragmentRow[]): ServiceSummary[] {
  return rows.map((row) => ({
    id: str(row, 'ID'),
    name: str(row, 'Name'),
    routePrefix: str(row, 'RoutePrefix'),
    implementationType: str(row, 'ImplementationType'),
    documentation: str(row, 'Documentation'),
  }));
}

/**
 * Projects raw operation fragments into lean summaries, optionally keeping only those whose
 * name or documentation contains `search` (case-insensitive).
 */
export function projectOperations(rows: FragmentRow[], search?: string): OperationSummary[] {
  const term = search?.trim().toLowerCase();
  const projected = rows.map((row) => ({
    id: str(row, 'ID'),
    name: str(row, 'Name'),
    method: str(row, 'Method'),
    path: str(row, 'RouteTemplate'),
    service: str(row, 'ServiceName'),
    serviceRoute: str(row, 'ServiceRoute'),
    isPublic: bool(row, 'IsPublic'),
    documentation: str(row, 'Documentation'),
  }));
  if (!term) return projected;
  return projected.filter(
    (op) =>
      op.name.toLowerCase().includes(term) ||
      op.documentation.toLowerCase().includes(term) ||
      op.service.toLowerCase().includes(term),
  );
}

/** Builds the fragments URL for a data definition with the given columns and optional filter. */
export function fragmentsPath(dataDefinition: string, columns: string, where?: string): string {
  const params = new URLSearchParams({ Columns: columns });
  if (where) params.set('Where', where);
  return `m42Services/api/data/fragments/${dataDefinition}?${params.toString()}`;
}

/** Lists every web service of the instance. */
export async function listServices(client: M42Client): Promise<ServiceSummary[]> {
  const rows = await client.getJson<FragmentRow[]>(fragmentsPath(SERVICE_CLASS, SERVICE_COLUMNS));
  return projectServices(rows);
}

/** Lists operations, optionally limited to one service and/or filtered by a search term. */
export async function listOperations(
  client: M42Client,
  options: { serviceId?: string; search?: string } = {},
): Promise<OperationSummary[]> {
  const where = options.serviceId ? `Service.ID = '${options.serviceId}'` : undefined;
  const rows = await client.getJson<FragmentRow[]>(
    fragmentsPath(OPERATION_CLASS, OPERATION_COLUMNS, where),
  );
  return projectOperations(rows, options.search);
}

/** Returns one operation's full contract: method, path, parameters with types, and return type. */
export async function describeOperation(
  client: M42Client,
  operationId: string,
): Promise<Record<string, unknown>> {
  return client.getJson<Record<string, unknown>>(
    `m42Services/api/Help/ServiceOperation/${encodeURIComponent(operationId)}`,
  );
}
