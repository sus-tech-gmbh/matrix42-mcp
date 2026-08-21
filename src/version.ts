// src/version.ts — the server's version, read from the package rather than restated.
//
// A hardcoded copy silently drifts: `npm version` bumps package.json and the tag, but not a
// constant in the source, so the CLI and the MCP handshake go on reporting the previous release.
// That happened once already, between 0.1.0 and 0.1.1.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Resolved relative to the compiled file in dist/, so this is the package's own manifest — which
// is shipped in the tarball, since `files` includes the manifest by definition.
const manifest = require('../package.json') as { version?: unknown };

/** The published version of this server. */
export const SERVER_VERSION: string =
  typeof manifest.version === 'string' && manifest.version ? manifest.version : '0.0.0';
