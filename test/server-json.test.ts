// test/server-json.test.ts — the MCP Registry entry must describe the package that is published.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface ServerJson {
  name: string;
  description: string;
  version: string;
  packages: {
    registryType: string;
    identifier: string;
    version: string;
    environmentVariables: { name: string }[];
  }[];
}

const root = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const manifest = JSON.parse(read('package.json')) as {
  name: string;
  version: string;
  mcpName: string;
};
const server = JSON.parse(read('server.json')) as ServerJson;

describe('server.json', () => {
  it('is named what package.json claims, which is how the registry verifies ownership', () => {
    expect(server.name).toBe(manifest.mcpName);
  });

  it('carries the package version — run `node scripts/sync-server-json.mjs` if this fails', () => {
    expect(server.version).toBe(manifest.version);
    for (const pkg of server.packages) expect(pkg.version).toBe(manifest.version);
  });

  it('points at this npm package', () => {
    expect(server.packages.map((pkg) => [pkg.registryType, pkg.identifier])).toEqual([
      ['npm', manifest.name],
    ]);
  });

  it('keeps the description within the registry limit of 100 characters', () => {
    expect(server.description.length).toBeLessThanOrEqual(100);
  });

  it('advertises every variable the server reads, except the discouraged basic-auth pair', () => {
    // Taken from the source, so a new setting cannot be forgotten here.
    const readByServer = [...read('src/config.ts').matchAll(/env\.(M42_[A-Z_]+)/g)]
      .map((match) => match[1])
      .filter((name) => name !== 'M42_USERNAME' && name !== 'M42_PASSWORD');
    const advertised = server.packages.flatMap((pkg) => pkg.environmentVariables);

    expect(advertised.map((variable) => variable.name).sort()).toEqual(
      [...new Set(readByServer)].sort(),
    );
  });
});
