// src/deep-links.ts — builds links into the Matrix42 web interface. No network calls.
//
// The shapes here were not invented: they were read back from the instance's own URL-building
// operations (CallTracker.GetIncidentListUrl and CallTracker.GetNewIncidentUrl), which return
// finished UUX URLs. The one ambiguity in that output — which of the two GUIDs is the object —
// was settled by experiment: passing a user's FRAGMENT id produced a URL carrying that user's
// OBJECT id, and passing the object id produced an all-zero GUID.

/** Removes a trailing slash so segments join cleanly. */
function origin(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * A link to an object's detail page.
 *
 * Takes the OBJECT id — the value of [Expression-ObjectID] — not a fragment id. The optional view
 * id selects one of the object's views; Matrix42's own builders emit it, and omitting it asks for
 * the default view.
 */
export function objectDetailsLink(
  baseUrl: string,
  typeName: string,
  objectId: string,
  viewId?: string,
): string {
  const segments = ['wm', 'object-details', typeName, objectId];
  if (viewId) segments.push(viewId);
  return `${origin(baseUrl)}/${segments.map(encodeURIComponent).join('/')}`;
}

/**
 * A link to the "create object" form, optionally pre-filled.
 *
 * presetParams is keyed by data definition, then by attribute — the shape Matrix42 itself emits,
 * e.g. { SPSActivityClassBase: { Initiator: "<user fragment id>" } }.
 */
export function createObjectLink(
  baseUrl: string,
  application: string,
  typeName: string,
  presetParams?: Record<string, unknown>,
): string {
  const path = ['wm', `app-${application}`, 'notset', 'create-object', typeName]
    .map(encodeURIComponent)
    .join('/');
  const url = `${origin(baseUrl)}/${path}`;
  if (!presetParams || Object.keys(presetParams).length === 0) return url;
  return `${url}?presetParams=${encodeURIComponent(JSON.stringify(presetParams))}`;
}

/** The kinds of link this module can build. */
export type DeepLinkKind = 'object' | 'create';

/** A built link, with the caveats a caller should pass on. */
export interface DeepLink {
  kind: DeepLinkKind;
  url: string;
  note: string;
}

/** Builds a link of the requested kind. */
export function buildDeepLink(input: {
  kind: DeepLinkKind;
  baseUrl: string;
  typeName: string;
  objectId?: string;
  viewId?: string;
  application?: string;
  presetParams?: Record<string, unknown>;
}): DeepLink {
  if (input.kind === 'object') {
    if (!input.objectId) throw new Error("An object link needs 'object_id'.");
    return {
      kind: 'object',
      url: objectDetailsLink(input.baseUrl, input.typeName, input.objectId, input.viewId),
      note:
        'Opens the object in the web interface. The id must be the OBJECT id ' +
        '([Expression-ObjectID]); a fragment id resolves to nothing.',
    };
  }
  return {
    kind: 'create',
    url: createObjectLink(
      input.baseUrl,
      input.application ?? 'ServiceDesk',
      input.typeName,
      input.presetParams,
    ),
    note: 'Opens a pre-filled creation form. Nothing is created until a person submits it.',
  };
}
