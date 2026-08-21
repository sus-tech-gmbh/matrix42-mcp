#!/usr/bin/env node
// scripts/service-desk-smoke.mjs — exercises the service-desk surface against a live instance.
//
// Reads touch existing data. WRITES are confined to a single ticket this script creates itself:
// every lifecycle verb runs against that ticket, and it is closed at the end. Nothing pre-existing
// is modified, and no notification e-mail is ever requested.
//
// Nothing here guesses an attribute name or a type name: both are read back from the instance.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const base = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined));
const hr = (t) => console.log(`\n${'='.repeat(72)}\n${t}\n${'='.repeat(72)}`);

let failures = 0;
const check = (label, pass, extra = '') => {
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
};

async function connect(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    env,
    stderr: 'inherit',
  });
  const client = new Client({ name: 'service-desk-smoke', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

const call = async (client, name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content.map((c) => c.text ?? '').join(''), isError: r.isError ?? false };
};

const json = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** An ISO timestamp offset from now, for the verbs that demand real dates. */
const isoIn = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();

// ── read-only deployment ────────────────────────────────────────────────────
hr('1. RESOURCES AND PROMPTS');
let client = await connect(base);

const uris = (await client.listResources()).resources.map((r) => r.uri);
check('four guides published', uris.length === 4, uris.join(', '));

const guide = await client.readResource({ uri: 'matrix42://guide/data-model' });
const guideText = guide.contents[0]?.text ?? '';
check('data model guide has content', guideText.length > 500, `${guideText.length} chars`);
check('states the never-guess rule', /never guess an attribute name/i.test(guideText));

const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
check('prompt templates published', prompts.length >= 5, prompts.join(', '));
const built = await client.getPrompt({ name: 'build_query', arguments: { goal: 'open incidents' } });
check(
  'a prompt expands with its arguments',
  (built.messages[0]?.content?.text ?? '').includes('open incidents'),
);

hr('2. TOOLS — service_desk is a read tool, present by default');
const names = (await client.listTools()).tools.map((t) => t.name);
console.log('tools:', names.join(', '));
check('service_desk present', names.includes('service_desk'));
check('ticket_actions absent by default', !names.includes('ticket_actions'));

hr('3. A1 — uniform search across every ticket kind');
const KINDS = ['ticket', 'incident', 'problem', 'change', 'task', 'service_request', 'kb_article'];
for (const kind of KINDS) {
  const r = await call(client, 'service_desk', { action: 'search_tickets', kind });
  const parsed = json(r.text);
  check(`search ${kind}`, !r.isError && parsed !== null, r.isError ? r.text.slice(0, 160) : `${parsed?.count} rows`);
}

hr('3b. A1 — filtering, and the "my items" guard');
const info = await call(client, 'server_info', {});
const fragmentId = /fragmentId (\S+)/.exec(info.text)?.[1];
console.log('authenticated fragment id:', fragmentId ?? '(not reported)');

if (fragmentId) {
  const mine = await call(client, 'service_desk', {
    action: 'search_tickets',
    kind: 'ticket',
    only_mine: true,
    user_id: fragmentId,
  });
  check('only_mine runs', !mine.isError, `${json(mine.text)?.count} rows`);
}
const missingUser = await call(client, 'service_desk', {
  action: 'search_tickets',
  kind: 'ticket',
  only_mine: true,
});
check('only_mine without a user id is refused locally', missingUser.isError);

hr('4. A4 + B1-B6 — browse every curated domain');
const DOMAINS = [
  'assets', 'stock_units', 'contracts', 'slas', 'catalog_services', 'bookings',
  'kb_articles', 'approvals', 'imports', 'import_runs', 'workflow_instances', 'applications',
];
for (const domain of DOMAINS) {
  const r = await call(client, 'service_desk', { action: 'browse', domain, limit: 3 });
  const parsed = json(r.text);
  const detail = r.isError
    ? r.text.slice(0, 200)
    : `${parsed?.count} rows${parsed?.unavailableFields?.length ? `, unavailable: ${parsed.unavailableFields.join(',')}` : ''}`;
  check(`browse ${domain}`, !r.isError && parsed !== null, detail);
}

hr('4b. browse — sorted and searched');
const searched = await call(client, 'service_desk', {
  action: 'browse',
  domain: 'workflow_instances',
  search: 'a',
  limit: 3,
});
check(
  'workflow_instances survives search + sort (the End reserved-word case)',
  !searched.isError,
  searched.isError ? searched.text.slice(0, 200) : `${json(searched.text)?.count} rows`,
);

hr('5. A3 — a real ticket, its object id, and its service levels');
const sample = json((await call(client, 'data_query', {
  action: 'query',
  class: 'SPSActivityClassBase',
  columns: 'Subject,[Expression-ObjectID] AS ObjectID',
  page_size: 1,
})).text);
const ticketObjectId = sample?.rows?.[0]?.ObjectID;
console.log('sample ticket object id:', ticketObjectId ?? '(none found)');

if (ticketObjectId) {
  const got = await call(client, 'service_desk', { action: 'get_ticket', ticket_object_id: ticketObjectId });
  check('get_ticket', !got.isError && got.text.trim() !== 'null', got.text.slice(0, 120));

  const slas = await call(client, 'service_desk', { action: 'sla_for_ticket', ticket_object_id: ticketObjectId });
  check('sla_for_ticket', !slas.isError, slas.isError ? slas.text.slice(0, 200) : slas.text.slice(0, 80));

  const times = await call(client, 'service_desk', {
    action: 'sla_times',
    ticket_object_id: ticketObjectId,
    duration: 60,
  });
  check('sla_times (activityId + duration)', !times.isError, times.isError ? times.text.slice(0, 220) : times.text.slice(0, 80));

  const noDuration = await call(client, 'service_desk', { action: 'sla_times', ticket_object_id: ticketObjectId });
  check('sla_times without duration is refused locally', noDuration.isError);
}

hr('6. data_model guide via a tool action');
const model = await call(client, 'service_desk', { action: 'data_model' });
check('data_model returns the guide', !model.isError && model.text.includes('one graph'));

// ── write deployment ────────────────────────────────────────────────────────
hr('7. PREVIEW-THEN-CONFIRM');
await client.close();
client = await connect({ ...base, M42_ALLOW_WRITES: '1' });

const writeNames = (await client.listTools()).tools.map((t) => t.name);
check('ticket_actions appears with writes enabled', writeNames.includes('ticket_actions'));

const SUBJECT = 'MCP smoke test — lifecycle verbs (safe to delete)';

const countMatching = async () =>
  json(
    (await call(client, 'service_desk', { action: 'search_tickets', kind: 'ticket', subject: SUBJECT }))
      .text,
  )?.count ?? 0;

// Earlier runs leave their (closed) ticket behind, so compare counts rather than expecting zero.
const beforePreview = await countMatching();

const preview = await call(client, 'ticket_actions', {
  action: 'create_ticket',
  activity_type: 6,
  subject: SUBJECT,
});
const previewed = json(preview.text);
check('create previews without confirm', previewed?.applied === false, previewed?.summary ?? preview.text.slice(0, 140));
check('preview shows the real request', Boolean(previewed?.request?.path), previewed?.request?.path ?? '');

const afterPreview = await countMatching();
check(
  'preview created nothing',
  afterPreview === beforePreview,
  `${beforePreview} before, ${afterPreview} after`,
);

hr('8. A2 — lifecycle verbs against a ticket this script creates');
// Forward refuses a ticket with no initiator, so raise it for a real user read from the instance.
const users = json((await call(client, 'data_query', {
  action: 'query',
  class: 'SPSUserClassBase',
  columns: 'LastName',
  page_size: 1,
})).text);
const initiatorId = users?.rows?.[0]?.ID;
console.log('initiator:', users?.rows?.[0]?.DisplayString ?? '(none)', initiatorId ?? '');

const created = json((await call(client, 'ticket_actions', {
  action: 'create_ticket',
  activity_type: 6,
  subject: SUBJECT,
  description: 'Created by scripts/service-desk-smoke.mjs. Closed automatically at the end.',
  initiator: initiatorId,
  confirm: true,
})).text);
const objectId = created?.objectId;
console.log('created object id:', objectId ?? '(create failed)');
check('create_ticket returned an object id', Boolean(objectId));
check('audit note written', created?.auditNote?.added === true, JSON.stringify(created?.auditNote ?? {}));

if (objectId) {
  // Read the configuration item back rather than assuming it.
  const found = json((await call(client, 'service_desk', {
    action: 'search_tickets', kind: 'ticket', subject: SUBJECT,
  })).text);
  // Match on the id we just created — several runs share this subject.
  const row = (found?.results ?? []).find((t) => t.Id === objectId);
  const typeName = row?.TypeName;
  console.log('configuration item reported by the instance:', typeName ?? '(unknown)');
  check('the created ticket is findable by search', Boolean(row), `${found?.count} matches`);

  const verbs = [
    ['take_over', { action: 'take_over', object_ids: [objectId], type_name: typeName, confirm: true }],
    ['set_deadline', { action: 'set_deadline', object_ids: [objectId], deadline: isoIn(60 * 24 * 30), confirm: true }],
    ['track_working_time', {
      action: 'track_working_time',
      object_ids: [objectId],
      minutes: 5,
      work_activity_type: 'investigation',
      begin: isoIn(-30),
      end: isoIn(-25),
      description: 'smoke test',
      confirm: true,
    }],
    ['pause', {
      action: 'pause',
      object_ids: [objectId],
      reminder_date: isoIn(60),
      comments: 'smoke test',
      not_escalate_while_paused: true,
      confirm: true,
    }],
    ['return_to_role', { action: 'return_to_role', object_id: objectId, comments: 'smoke test', confirm: true }],
    ['add_journal_entry', { action: 'add_journal_entry', object_id: objectId, comments: 'smoke test note (internal)', confirm: true }],
  ];
  for (const [label, args] of verbs) {
    if (label === 'take_over' && !typeName) {
      check(label, false, 'skipped: the instance did not report a TypeName');
      continue;
    }
    const r = await call(client, 'ticket_actions', args);
    check(label, !r.isError, r.isError ? r.text.slice(0, 240) : r.text.slice(0, 110));
  }

  hr('8b. forward — to a real role, read from the class that carries role names');
  // Forward's foreign key is CO_SPSScRoleClassBaseID_…, so it wants the role's
  // SPSScRoleClassBase fragment id — NOT the SPSSecurityClassRole id, which is a different
  // fragment of the same object. Pivot for the name, which only the sibling definition carries.
  const roles = json((await call(client, 'data_query', {
    action: 'query',
    class: 'SPSScRoleClassBase',
    columns: 'T(SPSSecurityClassRole).Name AS RoleName',
    page_size: 1,
  })).text);
  const roleId = roles?.rows?.[0]?.ID;
  console.log('role:', roles?.rows?.[0]?.RoleName ?? '(none)', roleId ?? '');
  if (roleId && typeName) {
    const r = await call(client, 'ticket_actions', {
      action: 'forward',
      object_ids: [objectId],
      type_name: typeName,
      role_id: roleId,
      comments: 'smoke test',
      confirm: true,
    });
    check('forward', !r.isError, r.isError ? r.text.slice(0, 240) : r.text.slice(0, 110));
  } else {
    check('forward', false, 'no role or type name available');
  }

  hr('8c. guards');
  const noTarget = await call(client, 'ticket_actions', {
    action: 'forward', object_ids: [objectId], type_name: typeName ?? 'X', confirm: true,
  });
  check('forward without a target is refused', noTarget.isError, noTarget.text.slice(0, 110));

  const noReminder = await call(client, 'ticket_actions', {
    action: 'pause', object_ids: [objectId], confirm: true,
  });
  check('pause without a reminder date is refused', noReminder.isError, noReminder.text.slice(0, 110));

  const noTimes = await call(client, 'ticket_actions', {
    action: 'track_working_time', object_ids: [objectId], minutes: 5, confirm: true,
  });
  check('track_working_time without begin/end is refused', noTimes.isError, noTimes.text.slice(0, 110));

  hr('9. CLEANUP — close, reopen, close again');
  for (const [label, args] of [
    ['close_ticket', { action: 'close_ticket', object_ids: [objectId], comments: 'Smoke test finished.', confirm: true }],
    ['reopen', { action: 'reopen', object_ids: [objectId], reason_text: 'smoke test reopen', confirm: true }],
    ['close again', { action: 'close_ticket', object_ids: [objectId], comments: 'Smoke test finished.', confirm: true }],
  ]) {
    const r = await call(client, 'ticket_actions', args);
    check(label, !r.isError, r.isError ? r.text.slice(0, 240) : '');
  }

  console.log(`\nTest ticket left CLOSED: ${objectId}`);
}

await client.close();

hr(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
