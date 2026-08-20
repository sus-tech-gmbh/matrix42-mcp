#!/usr/bin/env node
// scripts/smoke.mjs — end-to-end check: spawns the built server over stdio as a real MCP client
// and exercises every tool against a live Matrix42 instance.
//
// Usage: M42_HOST=... M42_API_TOKEN=... node scripts/smoke.mjs

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const required = ['M42_HOST'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`missing ${key}`);
    process.exit(1);
  }
}

const env = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined),
);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js'],
  env,
  stderr: 'inherit',
});

const client = new Client({ name: 'smoke-test', version: '1.0.0' });
await client.connect(transport);

const hr = (t) => console.log(`\n${'='.repeat(64)}\n${t}\n${'='.repeat(64)}`);
const text = (r) => r.content.map((c) => c.text ?? '').join('');

hr('server instructions (sent on initialize)');
console.log((client.getInstructions() ?? '(none)').slice(0, 400) + '…');

hr('tools/list');
const { tools } = await client.listTools();
for (const t of tools) {
  console.log(`- ${t.name}: ${t.title ?? ''}`);
  console.log(`  annotations: ${JSON.stringify(t.annotations ?? {})}`);
  console.log(`  input: ${Object.keys(t.inputSchema?.properties ?? {}).join(', ') || '(none)'}`);
}

hr('server_info');
const info = await client.callTool({ name: 'server_info', arguments: {} });
console.log(text(info), '\n  isError:', info.isError ?? false);

hr("webservice_discovery action='api_overview'");
const ov = await client.callTool({
  name: 'webservice_discovery',
  arguments: { action: 'api_overview' },
});
console.log(text(ov).slice(0, 300) + '…');

hr("webservice_discovery action='list_services'");
const svc = await client.callTool({
  name: 'webservice_discovery',
  arguments: { action: 'list_services' },
});
const svcJson = JSON.parse(text(svc));
console.log('count:', svcJson.count);
console.log('sample:', JSON.stringify(svcJson.services.find((s) => s.documentation) ?? svcJson.services[0]));

hr("webservice_discovery action='list_operations' search='fragment'");
const ops = await client.callTool({
  name: 'webservice_discovery',
  arguments: { action: 'list_operations', search: 'fragment' },
});
const opsJson = JSON.parse(text(ops));
console.log('count:', opsJson.count, '| total:', opsJson.total, '| truncated:', opsJson.truncated ?? false);
for (const o of opsJson.operations.slice(0, 6)) {
  console.log(`  [${o.method}] ${o.service}/${o.path}  — ${o.name}: ${(o.documentation || '').slice(0, 60)}`);
}

hr("webservice_discovery action='list_operations' (no filter, default limit)");
const all = await client.callTool({
  name: 'webservice_discovery',
  arguments: { action: 'list_operations' },
});
const allJson = JSON.parse(text(all));
console.log('count:', allJson.count, '| total:', allJson.total, '| truncated:', allJson.truncated ?? false);
console.log('payload size:', Math.round(text(all).length / 1024), 'KB');

hr("webservice_discovery action='describe_operation' (the delete-fragment op)");
const target =
  opsJson.operations.find((o) => o.method === 'DELETE' && o.name === 'Delete') ?? opsJson.operations[0];
console.log('target:', JSON.stringify({ id: target.id, name: target.name, method: target.method, path: target.path }));
const spec = await client.callTool({
  name: 'webservice_discovery',
  arguments: { action: 'describe_operation', operation_id: target.id },
});
console.log(text(spec).slice(0, 900));

hr("error path: describe_operation without operation_id");
const bad = await client.callTool({
  name: 'webservice_discovery',
  arguments: { action: 'describe_operation' },
});
console.log('isError:', bad.isError, '|', text(bad));

await client.close();
console.log('\n✅ smoke test complete');
