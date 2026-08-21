// src/deep-links.ts — builds links into the Matrix42 web interface. No network calls.
//
// Nothing here is invented. The shapes came from the instance's own URL-building operations
// (CallTracker.GetIncidentListUrl and CallTracker.GetNewIncidentUrl), and the two open questions
// were then settled directly:
//
//   Which of the two GUIDs is the object?  Passing a user's FRAGMENT id produced a URL carrying
//   that user's OBJECT id; passing the object id produced an all-zero GUID.
//
//   Is the trailing GUID required?  No. The web app declares the route itself as
//     name: "wmObjectDetailsPage", url: "/object-details/:_type/:_id/:widgetId?"
//   and the "?" marks widgetId optional, so a two-segment link opens the default widget.
//
// :_type is the CONFIGURATION ITEM name (SPSUserType), not a data definition name.

/** Removes a trailing slash so segments join cleanly. */
function origin(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * A link to an object's detail page.
 *
 * Takes the CONFIGURATION ITEM name and the OBJECT id — the value of [Expression-ObjectID] — not a
 * data definition name and not a fragment id. The widget id is optional per the app's own route;
 * omitting it opens the default widget.
 */
export function objectDetailsLink(
  baseUrl: string,
  typeName: string,
  objectId: string,
  widgetId?: string,
): string {
  const segments = ['wm', 'object-details', typeName, objectId];
  if (widgetId) segments.push(widgetId);
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
  widgetId?: string;
  application?: string;
  presetParams?: Record<string, unknown>;
}): DeepLink {
  if (input.kind === 'object') {
    if (!input.objectId) throw new Error("An object link needs 'object_id'.");
    return {
      kind: 'object',
      url: objectDetailsLink(input.baseUrl, input.typeName, input.objectId, input.widgetId),
      note:
        'Opens the object in the web interface. Takes the configuration item name and the OBJECT id ' +
        '([Expression-ObjectID]) — a data definition name or a fragment id resolves to nothing.',
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
