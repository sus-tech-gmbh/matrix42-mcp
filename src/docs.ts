// src/docs.ts — the guides as GitHub-readable documents.
//
// The guide constants are the single source of truth. This module only decides which of them get a
// file under docs/ and what footer they carry, so the published copy cannot drift from what the
// server actually serves.

import { GUIDE_RESOURCES, type GuideResource } from './resources.js';

/** A guide published as a repository document. */
export interface DocFile {
  /** Repository-relative path of the generated file. */
  path: string;
  /** Module the text is authored in, named so readers edit the right file. */
  source: string;
  guide: GuideResource;
}

/** Finds a guide by name, failing loudly if it was renamed. */
function guide(name: string): GuideResource {
  const found = GUIDE_RESOURCES.find((resource) => resource.name === name);
  if (!found) throw new Error(`No guide named '${name}' — update src/docs.ts`);
  return found;
}

/** The guides worth reading outside a client, in the order a newcomer should read them. */
export const DOC_FILES: DocFile[] = [
  { path: 'docs/matrix42-data-model.md', source: 'src/domain-guide.ts', guide: guide('data-model') },
  { path: 'docs/matrix42-schema.md', source: 'src/schema-overview.ts', guide: guide('schema') },
  { path: 'docs/asql.md', source: 'src/asql-guide.ts', guide: guide('asql') },
  { path: 'docs/matrix42-api.md', source: 'src/api-overview.ts', guide: guide('api') },
];

/** Renders one guide as a standalone document, noting where it comes from. */
export function renderDoc(doc: DocFile): string {
  return `${doc.guide.text}

---

*This is the text the Matrix42 MCP server serves as the resource \`${doc.guide.uri}\`.
It is generated from \`${doc.source}\` - edit that file and run \`npm run docs\`.*
`;
}
