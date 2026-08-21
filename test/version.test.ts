// test/version.test.ts — the reported version must match the published one.

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { SERVER_VERSION } from '../src/version.js';

const require = createRequire(import.meta.url);
const manifest = require('../package.json') as { version: string };

describe('SERVER_VERSION', () => {
  it('matches the version in package.json', () => {
    expect(SERVER_VERSION).toBe(manifest.version);
  });

  it('is a real semantic version, not the fallback', () => {
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(SERVER_VERSION).not.toBe('0.0.0');
  });
});
