#!/usr/bin/env node
// scripts/schema-smoke.mjs — exercises the schema_discovery tool against a live instance.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined));
const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], env, stderr: 'inherit' });
const client = new Client({ name: 'schema-smoke', version: '1.0.0' });
await client.connect(transport);

const hr = (t) => console.log(`\n${'='.repeat(66)}\n${t}\n${'='.repeat(66)}`);
const call = async (args) => {
  const r = await client.callTool({ name: 'schema_discovery', arguments: args });
  return { text: r.content.map((c) => c.text ?? '').join(''), isError: r.isError ?? false };
};

hr('tools/list');
const { tools } = await client.listTools();
console.log(tools.map((t) => `${t.name} ${JSON.stringify(t.annotations ?? {})}`).join('\n'));

hr("schema_overview");
const ov = await call({ action: 'schema_overview' });
console.log(ov.text.slice(0, 260) + '…');
console.log('[size]', Math.round(ov.text.length / 1024), 'KB');

hr("list_configuration_items search='user'");
const cis = await call({ action: 'list_configuration_items', search: 'user' });
const cj = JSON.parse(cis.text);
console.log('count', cj.count, '| total', cj.total);
console.log(JSON.stringify(cj.configurationItems.slice(0, 3), null, 1));

hr("describe_configuration_item SPSUserType");
const ci = await call({ action: 'describe_configuration_item', name: 'SPSUserType' });
const cid = JSON.parse(ci.text);
console.log('mainClass:', cid.mainClass, '| DDs:', cid.dataDefinitions.length);
console.table(cid.dataDefinitions.map((d) => ({ name: d.internalName, cardinality: d.cardinality, multi: d.isMultiFragment })));

hr("describe_data_definition SPSUserClassBase (default = attributes only)");
const dd = await call({ action: 'describe_data_definition', name: 'SPSUserClassBase' });
const ddj = JSON.parse(dd.text);
console.log('attrs', ddj.attributeCount, '| relations', ddj.relationCount, '| usedIn', JSON.stringify(ddj.usedInConfigurationItems));
console.log('note:', ddj.note);
console.log('displayExpression:', ddj.displayExpression);
console.log('[payload size]', Math.round(dd.text.length / 1024), 'KB  <-- vs 175 KB raw');
console.log('pickup attrs:', ddj.attributes.filter((a) => a.pickupClass).map((a) => `${a.name}->${a.pickupClass}`).slice(0, 4).join(', '));

hr("describe_data_definition include='both' (size check)");
const both = await call({ action: 'describe_data_definition', name: 'SPSUserClassBase', include: 'both' });
console.log('[payload size]', Math.round(both.text.length / 1024), 'KB');

hr("get_pickup_values via class+attribute (UserType)");
const pv = await call({ action: 'get_pickup_values', name: 'SPSUserClassBase', attribute: 'UserType' });
console.log(pv.text);

hr("get_pickup_values on a pickup with a non-standard label column");
const odd = await call({ action: 'get_pickup_values', pickup_class: 'SPSActivityPickupAutomationProcess' });
console.log(odd.text.slice(0, 300));

hr("error paths");
for (const args of [{ action: 'describe_data_definition' }, { action: 'get_pickup_values', name: 'SPSUserClassBase', attribute: 'LastName' }]) {
  const r = await call(args);
  console.log(JSON.stringify(args), '->', r.isError, '|', r.text.slice(0, 120));
}

await client.close();
console.log('\n✅ schema smoke complete');
