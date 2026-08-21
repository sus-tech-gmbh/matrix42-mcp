#!/usr/bin/env node
// scripts/generate-docs.mjs — writes the in-server guides to docs/ so they are readable on GitHub.
//
// The TypeScript constants are the single source of truth; these files are generated from them, and
// test/docs.test.ts fails if they drift. Run `npm run docs` after editing a guide.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOC_FILES, renderDoc } from '../dist/docs.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

mkdirSync(join(root, 'docs'), { recursive: true });
for (const doc of DOC_FILES) {
  writeFileSync(join(root, doc.path), renderDoc(doc), 'utf8');
  console.log(`wrote ${doc.path}`);
}
