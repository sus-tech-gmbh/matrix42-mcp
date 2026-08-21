// test/docs.test.ts — the generated docs must match the guides the server actually serves.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOC_FILES, renderDoc } from '../src/docs.js';

const root = join(import.meta.dirname, '..');

describe('DOC_FILES', () => {
  it('publishes one document per guide worth reading outside a client', () => {
    expect(DOC_FILES.map((doc) => doc.guide.name)).toEqual(['data-model', 'schema', 'asql', 'api']);
  });

  it('names the module each document is authored in', () => {
    for (const doc of DOC_FILES) expect(doc.source, doc.path).toMatch(/^src\/.+\.ts$/);
  });
});

describe('generated documentation', () => {
  it.each(DOC_FILES.map((doc) => [doc.path, doc] as const))(
    '%s is in sync with the guide the server serves',
    (path, doc) => {
      const onDisk = readFileSync(join(root, path), 'utf8');
      expect(
        onDisk,
        `${path} is stale — run \`npm run docs\` after editing ${doc.source}`,
      ).toBe(renderDoc(doc));
    },
  );
});
