#!/usr/bin/env node
// scripts/tier23-smoke.mjs — exercises the Tier 2/3 surface against a live instance.
//
// Writes are confined to a ticket this script creates itself: create → journal → close.
// Nothing pre-existing is modified, and no notification e-mail is ever requested.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const base = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined));
const hr = (t) => console.log(`\n${'='.repeat(72)}\n${t}\n${'='.repeat(72)}`);

async function connect(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    env,
    stderr: 'inherit',
  });
  const client = new Client({ name: 'tier23-smoke', version: '1.0.0' });
  await client.connect(transport);
  return client;
}
const call = async (client, name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content.map((c) => c.text ?? '').join(''), isError: r.isError ?? false };
};

// ── read-only deployment ───────────────────────────────────────────────────
hr('1. DEFAULT (read-only) — write tools must be absent');
let client = await connect(base);
let names = (await client.listTools()).tools.map((t) => t.name);
console.log('tools:', names.join(', '));
console.log('ticket_actions present?', names.includes('ticket_actions'), '(expected: false)');

hr('2. server_info — identity for "my items"');
const info = await call(client, 'server_info', {});
console.log(info.text);
const fragmentId = /fragmentId (\S+)/.exec(info.text)?.[1];

hr('3. "my tickets" — assigned to the authenticated account');
for (const [label, rel] of [['assigned (Recipient)', 'Recipient'], ['raised (Initiator)', 'Initiator'], ['created (Creator)', 'Creator']]) {
  const r = await call(client, 'data_query', {
    action: 'query',
    class: 'SPSActivityClassBase',
    columns: 'ID,Subject,[Expression-ObjectID]',
    where: `${rel}.ID = '${fragmentId}'`,
    sort: 'Subject ASC',
    page_size: 3,
  });
  const j = JSON.parse(r.text);
  console.log(` ${label.padEnd(22)} ${j.count} shown, hasMore=${j.hasMore} | e.g. ${j.rows[0]?.Subject ?? '-'}`);
}

hr('4. saved views (data queries) — curated, pre-filtered');
const views = JSON.parse((await call(client, 'data_query', { action: 'list_views', search: 'knowledge' })).text);
console.log('matching views:', views.count);
for (const v of views.views.slice(0, 3)) console.log(`  ${v.name} [${v.class}] filter="${v.predefinedFilter}"`);
if (views.views[0]) {
  const run = JSON.parse((await call(client, 'data_query', { action: 'run_view', view_id: views.views[0].id, page_size: 2 })).text);
  console.log(`  run "${views.views[0].name}" → ${run.count} rows`);
}

hr('5. journal + attachments on a real object');
const withFiles = JSON.parse((await call(client, 'data_query', {
  action: 'query', class: 'SPSActivityClassBase',
  columns: 'ID,Subject,[Expression-ObjectID]', where: "Subject LIKE '%Test Attachment%'", page_size: 1,
})).text).rows[0];
if (withFiles) {
  const oid = withFiles['Expression-ObjectID'];
  const jr = JSON.parse((await call(client, 'data_query', { action: 'list_journal', object_id: oid, page_size: 5 })).text);
  console.log(` journal entries: ${jr.count}`);
  for (const e of jr.entries.slice(0, 3)) console.log(`   [${e.createdDate?.slice(0, 10)}] ${e.header} — ${e.text?.slice(0, 60)}`);
  const at = JSON.parse((await call(client, 'data_query', { action: 'list_attachments', object_id: oid })).text);
  console.log(` attachments: ${at.count} →`, at.attachments.map((a) => a.name).join(', '));
  console.log(' [payload]', Math.round(JSON.stringify(at).length / 1024), 'KB (thumbnails stripped)');
}
await client.close();

// ── write-enabled deployment ───────────────────────────────────────────────
hr('6. WRITES ENABLED — full lifecycle on a ticket this script creates');
client = await connect({ ...base, M42_ALLOW_WRITES: '1' });
names = (await client.listTools()).tools.map((t) => t.name);
console.log('tools:', names.join(', '));

const cls = await call(client, 'ticket_actions', {
  action: 'classify_ticket',
  subject: 'Printer on 3rd floor is jammed',
  description: 'Paper jam, cannot print',
});
console.log('\n classify (non-mutating):', cls.text.slice(0, 200));

const created = await call(client, 'ticket_actions', {
  action: 'create_ticket',
  activity_type: 6,
  subject: 'MCP smoke test — safe to delete',
  description: 'Created by the matrix42-mcp smoke test to verify the write path.',
});
console.log('\n create:', created.text, '| isError', created.isError);
const newId = JSON.parse(created.text || '{}').id;

if (newId && !created.isError) {
  const row = JSON.parse((await call(client, 'data_query', {
    action: 'query', class: 'SPSActivityClassBase',
    columns: 'ID,Subject,[Expression-ObjectID]', where: `ID = '${newId}'`,
  })).text).rows[0];
  console.log(' verify via query:', JSON.stringify(row));
  const objectId = row?.['Expression-ObjectID'];

  if (objectId) {
    const j = await call(client, 'ticket_actions', {
      action: 'add_journal_entry',
      object_id: objectId,
      comments: 'Internal note added by the smoke test.',
    });
    console.log('\n journal add (internal):', j.text, '| isError', j.isError);

    const jr = JSON.parse((await call(client, 'data_query', { action: 'list_journal', object_id: objectId })).text);
    console.log(' journal now has', jr.count, 'entries:', jr.entries.map((e) => e.header || e.text?.slice(0, 40)).join(' | '));

    const closed = await call(client, 'ticket_actions', {
      action: 'close_ticket',
      object_ids: [objectId],
      comments: 'Closed by the smoke test. No notifications requested.',
    });
    console.log('\n close:', closed.text, '| isError', closed.isError);
  }
}
await client.close();
console.log('\n✅ tier 2/3 smoke complete');
