// src/resources.ts - the written guides, published as MCP resources.
//
// The same text is reachable through tool actions, but resources make it discoverable: a client can
// list and read them without calling a tool, and can attach one to a conversation up front. Models
// that would otherwise guess an attribute name tend to find the rules here first.

import type { McpServer } from '@modelcontextprotocol/server';
import { API_OVERVIEW } from './api-overview.js';
import { ASQL_GUIDE } from './asql-guide.js';
import { DOMAIN_GUIDE } from './domain-guide.js';
import { SCHEMA_OVERVIEW } from './schema-overview.js';

/** One published guide. */
export interface GuideResource {
  name: string;
  uri: string;
  title: string;
  description: string;
  text: string;
}

/** Every guide this server publishes, in the order a newcomer should read them. */
export const GUIDE_RESOURCES: GuideResource[] = [
  {
    name: 'data-model',
    uri: 'matrix42://guide/data-model',
    title: 'Matrix42 is one graph, not many modules',
    description:
      'How the modules map onto a handful of base classes - where tickets, assets, licenses, contracts, SLAs and catalog items actually live, and the rule against guessing attribute names.',
    text: DOMAIN_GUIDE,
  },
  {
    name: 'schema',
    uri: 'matrix42://guide/schema',
    title: 'Matrix42 schema model',
    description:
      'Data definitions vs configuration items, fragments, cardinality and pickups - read before reasoning about Matrix42 data.',
    text: SCHEMA_OVERVIEW,
  },
  {
    name: 'asql',
    uri: 'matrix42://guide/asql',
    title: 'ASQL expression language',
    description: 'The filter and column-list language used by every fragment query.',
    text: ASQL_GUIDE,
  },
  {
    name: 'api',
    uri: 'matrix42://guide/api',
    title: 'Matrix42 REST API conventions',
    description:
      'Authentication, headers, and the Public vs Product API distinction - read before writing standalone Matrix42 integration code.',
    text: API_OVERVIEW,
  },
];

/** Publishes the guides so clients can list and read them without calling a tool. */
export function registerResources(server: McpServer): void {
  for (const guide of GUIDE_RESOURCES) {
    server.registerResource(
      guide.name,
      guide.uri,
      { title: guide.title, description: guide.description, mimeType: 'text/markdown' },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text: guide.text }],
      }),
    );
  }
}
