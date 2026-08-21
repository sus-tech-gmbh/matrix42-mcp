// src/deep-links.ts — builds links into the Matrix42 web interface. No network calls.
//
// This is the format Matrix42 documents for deep linking, and it was confirmed by opening the
// generated links in a signed-in browser against a live instance:
//
//     <origin>/wm/app-<Application>/?view-options={"objectId":…,"type":…,"viewType":"preview"}
//
// A ticket rendered its full detail page, and a person rendered theirs with the usual actions.
//
// An earlier attempt used the router's own /wm/object-details/<type>/<id> path. That path exists —
// the app declares it — but opening it loads the application shell and leaves the content pane
// EMPTY, so it is not the supported entry point. Do not go back to it.
//
// Two values matter and are easy to get wrong:
//   type      the CONFIGURATION ITEM name (SPSActivityTypeTicket), never a data definition name.
//   objectId  the OBJECT id ([Expression-ObjectID]), never a fragment id.

/** How the object should be opened. */
export type ViewType = 'preview' | 'edit' | 'new' | 'action';

/** Removes a trailing slash so segments join cleanly. */
function origin(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/** Everything the view-options payload can carry. */
export interface ViewOptions {
  type: string;
  viewType: ViewType;
  objectId?: string;
  /** Required when viewType is 'action'. */
  actionId?: string;
  /** Opens a specific dialog rather than the default one. */
  dialogId?: string;
  /** Shows only one page of the dialog. */
  viewId?: string;
  /** Hides the surrounding navigation, for embedding in another page. */
  embedded?: boolean;
  /** Pre-fills fields, keyed by data definition then attribute. */
  presetParams?: Record<string, unknown>;
  /** Opens the archived version of the object. */
  archived?: 0 | 1;
}

/** Drops unset entries so the payload carries only what the caller meant. */
function compact(options: ViewOptions): Record<string, unknown> {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
}

/**
 * Builds a deep link.
 *
 * The application segment selects which shell opens; ServiceDesk resolves tickets and people alike,
 * so it is the default. The payload rides in the query string as JSON.
 */
export function viewOptionsLink(
  baseUrl: string,
  application: string,
  options: ViewOptions,
): string {
  const path = ['wm', `app-${application}`].map(encodeURIComponent).join('/');
  const payload = encodeURIComponent(JSON.stringify(compact(options)));
  return `${origin(baseUrl)}/${path}/?view-options=${payload}`;
}

/** A built link, with the caveats a caller should pass on. */
export interface DeepLink {
  viewType: ViewType;
  url: string;
  note: string;
}

/** What each view type does, in the words a caller should repeat to a user. */
const NOTES: Record<ViewType, string> = {
  preview: 'Opens the object read-only in the web interface.',
  edit: 'Opens the object in edit mode. Nothing changes until a person saves.',
  new: 'Opens a creation form, pre-filled where asked. Nothing is created until a person submits it.',
  action: 'Opens an action or wizard against the object. It runs only once a person completes it.',
};

/** Builds a link of the requested kind, refusing combinations Matrix42 will not honour. */
export function buildDeepLink(input: {
  baseUrl: string;
  typeName: string;
  viewType?: ViewType;
  objectId?: string;
  actionId?: string;
  dialogId?: string;
  viewId?: string;
  embedded?: boolean;
  presetParams?: Record<string, unknown>;
  application?: string;
}): DeepLink {
  const viewType = input.viewType ?? 'preview';

  if (viewType !== 'new' && !input.objectId) {
    throw new Error(`A '${viewType}' link needs 'object_id' — only 'new' opens without one.`);
  }
  if (viewType === 'action' && !input.actionId) {
    throw new Error("An 'action' link needs 'action_id'.");
  }

  const options: ViewOptions = { type: input.typeName, viewType };
  if (input.objectId) options.objectId = input.objectId;
  if (input.actionId) options.actionId = input.actionId;
  if (input.dialogId) options.dialogId = input.dialogId;
  if (input.viewId) options.viewId = input.viewId;
  if (input.embedded !== undefined) options.embedded = input.embedded;
  if (input.presetParams && Object.keys(input.presetParams).length > 0) {
    options.presetParams = input.presetParams;
  }

  return {
    viewType,
    url: viewOptionsLink(input.baseUrl, input.application ?? 'ServiceDesk', options),
    note: NOTES[viewType],
  };
}
