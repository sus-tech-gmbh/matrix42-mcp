// src/objects.ts — object-scoped reads: journal entries, attachments, and saved data queries.

import type { M42Client } from './m42-client.js';

// ── Journal ─────────────────────────────────────────────────────────────────

/** One journal entry as shown on an object's timeline. */
export interface JournalEntry {
  id: string;
  createdDate: string;
  header: string;
  text: string;
  creator: string;
}

/**
 * Matrix42 renders object references inside journal text through a caller-supplied template and
 * rejects an empty one, so a minimal anchor is always sent.
 */
const OBJECT_LINK_TEMPLATE = '<a href="#">{0}</a>';

/** Strips the presentation-only fields (photo path, colour) a model has no use for. */
export function projectJournal(rows: unknown): JournalEntry[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const str = (key: string): string => (typeof row[key] === 'string' ? (row[key] as string) : '');
    return {
      id: str('Id'),
      createdDate: str('CreatedDate'),
      header: str('Header'),
      text: str('Text'),
      creator: str('Creator'),
    };
  });
}

/** Reads an object's journal (its comment/activity timeline), newest entries first. */
export async function listJournal(
  client: M42Client,
  objectId: string,
  options: { start?: number; count?: number } = {},
): Promise<{ objectId: string; count: number; entries: JournalEntry[] }> {
  const params = new URLSearchParams({
    objectId,
    start: String(options.start ?? 0),
    count: String(options.count ?? 25),
    objectLinkTemplate: OBJECT_LINK_TEMPLATE,
    timeOffset: '0',
  });
  const raw = await client.getJson<unknown>(`m42Services/api/journal?${params.toString()}`);
  const entries = projectJournal(raw);
  return { objectId, count: entries.length, entries };
}

// ── Attachments ─────────────────────────────────────────────────────────────

/** One file attached to an object. */
export interface AttachmentInfo {
  fileId: string;
  name: string;
  comment: string;
  updatedBy: string;
  updatedOn: string;
}

/**
 * Projects file info, dropping the inline base64 thumbnail — it can be tens of kilobytes per file
 * and carries no information a model can use.
 */
export function projectAttachments(rows: unknown): AttachmentInfo[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const str = (key: string): string => (typeof row[key] === 'string' ? (row[key] as string) : '');
    return {
      fileId: str('UniqueFileId'),
      name: str('Name'),
      comment: str('Comment'),
      updatedBy: str('UpdatedBy'),
      updatedOn: str('UpdatedOn'),
    };
  });
}

/** Lists the files attached to an object. */
export async function listAttachments(
  client: M42Client,
  objectId: string,
): Promise<{ objectId: string; count: number; attachments: AttachmentInfo[] }> {
  const raw = await client.getJson<unknown>(
    `m42Services/api/commonStorage/files/${encodeURIComponent(objectId)}`,
  );
  const attachments = projectAttachments(raw);
  return { objectId, count: attachments.length, attachments };
}

// ── Saved data queries ("views") ────────────────────────────────────────────

/** A saved data query: a curated, named view with its own predefined filter. */
export interface SavedView {
  id: string;
  name: string;
  description: string;
  class: string;
  predefinedFilter: string;
}

/** Projects data-query fragments into view summaries. */
export function projectViews(rows: unknown): SavedView[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const str = (key: string): string => (typeof row[key] === 'string' ? (row[key] as string) : '');
      return {
        id: str('Expression-ObjectID'),
        name: str('Name'),
        description: str('Description'),
        class: str('SchemaClassName'),
        predefinedFilter: str('PrimaryFilter'),
      };
    })
    .filter((view) => view.id !== '');
}

// ID is required: Matrix42 sorts by it by default and rejects sorting on an unselected column.
const VIEW_COLUMNS = 'ID,Name,Description,SchemaClassName,PrimaryFilter,[Expression-ObjectID]';

/** Lists the saved data queries defined on the instance, optionally filtered by a search term. */
export async function listViews(
  client: M42Client,
  search?: string,
): Promise<SavedView[]> {
  const params = new URLSearchParams({ Columns: VIEW_COLUMNS, PageSize: '500' });
  const rows = await client.getJson<unknown>(
    `m42Services/api/data/fragments/PDRDataQueryClassBase?${params.toString()}`,
  );
  const views = projectViews(rows);
  const term = search?.trim().toLowerCase();
  if (!term) return views;
  return views.filter(
    (view) =>
      view.name.toLowerCase().includes(term) ||
      view.description.toLowerCase().includes(term) ||
      view.class.toLowerCase().includes(term),
  );
}

/** Runs a saved data query, returning its rows with the view's predefined filter applied. */
export async function runView(
  client: M42Client,
  viewId: string,
  options: { pageSize?: number; page?: number; search?: string } = {},
): Promise<{ viewId: string; count: number; rows: unknown[] }> {
  const params = new URLSearchParams({ pageSize: String(options.pageSize ?? 25) });
  if (options.page !== undefined && options.page > 1) params.set('page', String(options.page - 1));
  if (options.search?.trim()) params.set('search', options.search.trim());
  const raw = await client.getJson<unknown>(
    `m42Services/api/DataQuery/${encodeURIComponent(viewId)}?${params.toString()}`,
  );
  const rows = Array.isArray(raw) ? raw : [];
  return { viewId, count: rows.length, rows };
}

// ── Current user ────────────────────────────────────────────────────────────

/** Identity of the account the configured credentials authenticate as. */
export interface CurrentUser {
  fragmentId: string;
  objectId: string;
  displayName: string;
  note: string;
}

/** Reads the account the current credentials act as, for "my items" style questions. */
export async function getCurrentUser(client: M42Client): Promise<CurrentUser> {
  const raw = (await client.getJson<Record<string, unknown>>('m42Services/api/userinfo')) ?? {};
  const str = (key: string): string => (typeof raw[key] === 'string' ? (raw[key] as string) : '');
  const name = [str('FirstName'), str('LastName')].filter(Boolean).join(' ') || str('DisplayString');
  return {
    fragmentId: str('Id'),
    objectId: str('ObjectID'),
    displayName: name,
    note:
      'This is the account the configured credentials act as. With a service API token it is the ' +
      'service account, not an end user. To filter records by this user, compare against its ' +
      "fragmentId, e.g. \"Recipient.ID = '<fragmentId>'\" for assigned activities, or Initiator/Creator.",
  };
}

/**
 * The configuration item an object belongs to, or null when the id is not an object id.
 *
 * A base data definition is reused by many configuration items — SPSActivityClassBase alone backs
 * incidents, service requests, changes and more — so an object's id is the only reliable way to
 * know which one a given record is. Matrix42 answers an empty string for an id it does not
 * recognise as an object, which is exactly what a fragment id produces.
 */
export async function resolveObjectType(
  client: M42Client,
  objectId: string,
): Promise<string | null> {
  let raw: unknown;
  try {
    raw = await client.getJson<unknown>(
      `m42Services/api/data/objectTypeName/${encodeURIComponent(objectId)}`,
    );
  } catch {
    return null; // an unknown id is data, not a failure
  }
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  return name === '' ? null : name;
}
