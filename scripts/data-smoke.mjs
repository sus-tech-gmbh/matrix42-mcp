#!/usr/bin/env node
// scripts/data-smoke.mjs — exercises data_query against a live instance, as an AI would use it.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined));
const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], env, stderr: 'inherit' });
const client = new Client({ name: 'data-smoke', version: '1.0.0' });
await client.connect(transport);
const hr = (t) => console.log(`\n${'='.repeat(70)}\n${t}\n${'='.repeat(70)}`);
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content.map((c) => c.text ?? '').join(''), isError: r.isError ?? false };
};
const data = (a) => call('data_query', a);

hr('tools');
console.log((await client.listTools()).tools.map((t) => t.name).join(', '));

hr("asql_guide");
const g = await data({ action: 'asql_guide' });
console.log(g.text.slice(0, 200) + '…\n[size]', Math.round(g.text.length / 1024), 'KB');

hr('AI workflow step 1 — find the class (schema_discovery)');
const cls = await call('schema_discovery', { action: 'list_data_definitions', search: 'activity', limit: 5 });
const cj = JSON.parse(cls.text);
console.log('matches:', cj.total, '→', cj.dataDefinitions.map((d) => d.internalName).join(', '));

hr('step 2 — validate a filter BEFORE querying');
for (const expr of ["Subject LIKE '%Test%'", "Nope = 'x'"]) {
  const v = await data({ action: 'validate_asql', class: 'SPSActivityClassBase', expression: expr });
  console.log(` ${expr.padEnd(28)} → ${v.text}`);
}

hr('step 3 — query with filter + projection + paging');
const q = await data({ action: 'query', class: 'SPSActivityClassBase', columns: 'ID,Subject,[Expression-ObjectID]', where: "Subject LIKE '%Test%'", sort: 'Subject ASC', page_size: 3 });
const qj = JSON.parse(q.text);
console.log('count', qj.count, '| hasMore', qj.hasMore, '| page', qj.page);
console.log('columns:', JSON.stringify(qj.columns));
console.log('rows:', JSON.stringify(qj.rows, null, 1).slice(0, 500));
console.log('hint:', qj.hint ?? '(none)');
console.log('[payload]', Math.round(q.text.length / 1024), 'KB');

hr('step 4 — page 2');
const p2 = await data({ action: 'query', class: 'SPSActivityClassBase', columns: 'ID,Subject', where: "Subject LIKE '%Test%'", sort: 'Subject ASC', page_size: 3, page: 2 });
const p2j = JSON.parse(p2.text);
console.log('page', p2j.page, '| count', p2j.count, '| first:', p2j.rows[0]?.Subject);

hr('step 5 — pickup-aware filter (T() pivot + .Value)');
const pv = await call('schema_discovery', { action: 'get_pickup_values', name: 'SPSCommonClassBase', attribute: 'State' });
console.log('pickup values:', pv.text.slice(0, 200));
const st = await data({ action: 'query', class: 'SPSActivityClassBase', columns: 'ID,Subject,T(SPSCommonClassBase).State.DisplayString AS StateLabel', page_size: 3 });
console.log('rows:', JSON.stringify(JSON.parse(st.text).rows));

hr('step 6 — get_fragment then get_object');
const first = qj.rows[0];
if (first?.ID) {
  const f = await data({ action: 'get_fragment', class: 'SPSActivityClassBase', fragment_id: first.ID });
  console.log('fragment fields:', Object.keys(JSON.parse(f.text)).length, '| [size]', Math.round(f.text.length / 1024), 'KB');
}
if (first?.['Expression-ObjectID']) {
  const o = await data({ action: 'get_object', ci_name: 'SPSActivityTypeIncident', object_id: first['Expression-ObjectID'] });
  console.log('get_object isError:', o.isError, '|', o.text.slice(0, 220));
}

hr('error paths');
for (const args of [
  { action: 'query' },
  { action: 'query', class: 'SPSActivityClassBase', where: 'Nope = 1' },
  { action: 'get_fragment', class: 'SPSActivityClassBase' },
]) {
  const r = await data(args);
  console.log(JSON.stringify(args).slice(0, 60), '→ isError', r.isError, '|', r.text.slice(0, 150).replace(/\n/g, ' '));
}
await client.close();
console.log('\n✅ data smoke complete');
