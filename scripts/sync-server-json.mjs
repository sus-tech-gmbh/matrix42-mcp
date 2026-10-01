#!/usr/bin/env node
// scripts/sync-server-json.mjs — copies the package version into server.json.
//
// Runs as the npm `version` lifecycle script, after package.json is bumped and before `npm version`
// commits, so the release commit and tag carry a server.json that matches. The MCP Registry rejects
// a server.json whose package version is not on npm, and test/server-json.test.ts fails if the two
// ever disagree.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = join(root, 'server.json');

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const server = JSON.parse(readFileSync(serverPath, 'utf8'));

server.version = version;
for (const pkg of server.packages) pkg.version = version;

writeFileSync(serverPath, `${JSON.stringify(server, null, 2)}\n`, 'utf8');
console.log(`server.json -> ${version}`);
