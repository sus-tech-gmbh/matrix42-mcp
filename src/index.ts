#!/usr/bin/env node
// src/index.ts — entry point: wires configuration, the Matrix42 client, and the MCP stdio server.

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ConfigError, describeConfig, loadConfig } from './config.js';
import { M42Client } from './m42-client.js';
import { ALL_TOOLS, registerTools, selectTools } from './tools/index.js';

const SERVER_NAME = 'matrix42-mcp';
const SERVER_VERSION = '0.1.0';

/**
 * Orientation text sent to the client on connect, so the model knows what this server is for
 * and which tool to reach for first.
 */
const INSTRUCTIONS = `This server connects to a Matrix42 instance and exposes its REST API surface to you.
It handles authentication (API-token exchange), the Explicit-Language header, and TLS for every call,
so tools need no credentials from you.

Use the webservice_discovery tool to work with the API:
  - action='api_overview' for general Matrix42 API conventions (auth, headers, Public vs Product API);
    read this before writing any standalone Matrix42 integration code for the user.
  - action='list_operations' with a 'search' term to find an endpoint.
  - action='describe_operation' with an operation_id for its parameters and return type.
Use the schema_discovery tool to explore the data model:
  - action='schema_overview' explains data definitions vs configuration items, fragments,
    cardinality and pickups — read this before reasoning about Matrix42 data.
  - action='list_data_definitions' / 'list_configuration_items' to find schema objects.
  - action='describe_data_definition' / 'describe_configuration_item' for their structure.
  - action='get_pickup_values' for the valid values of a pickup attribute (never guess these).
Use server_info to see which instance is connected.

All tools are read-only: they return API metadata, not business records.`;

/** stdout belongs to the MCP protocol — every diagnostic goes to stderr. */
function log(message: string): void {
  process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
}

/** Prints CLI usage. */
function printHelp(): void {
  process.stderr.write(
    `${SERVER_NAME} ${SERVER_VERSION} — Model Context Protocol server for Matrix42

Usage: ${SERVER_NAME}            start the MCP server on stdio (how MCP clients run it)
       ${SERVER_NAME} --help     show this help
       ${SERVER_NAME} --version  print the version
       ${SERVER_NAME} --tools    list available tool ids

Configuration (environment variables):
  M42_HOST                 required — https://matrix42.example.com
  M42_API_TOKEN            API token (recommended); exchanged for an access token automatically
  M42_USERNAME/M42_PASSWORD  basic-auth alternative to M42_API_TOKEN
  M42_LANGUAGE             response language, default en-US (sent as Explicit-Language)
  M42_TOOLS                comma-separated tool ids to expose (default: all)
  M42_ALLOW_INSECURE_TLS   set to 1 to skip TLS verification (self-signed dev instances only)
  M42_TIMEOUT_MS           per-request timeout, default 30000

Tools:
${ALL_TOOLS.map((tool) => `  ${tool.id.padEnd(22)} ${tool.summary}`).join('\n')}
`,
  );
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stderr.write(`${SERVER_VERSION}\n`);
    return;
  }
  if (argv.includes('--tools')) {
    process.stderr.write(ALL_TOOLS.map((tool) => `${tool.id}\t${tool.summary}`).join('\n') + '\n');
    return;
  }

  const config = loadConfig();
  const { tools, unknown } = selectTools(config.enabledTools);
  if (unknown.length > 0) {
    log(`warning: ignoring unknown tool id(s) in M42_TOOLS: ${unknown.join(', ')}`);
  }
  if (tools.length === 0) {
    throw new ConfigError(
      `M42_TOOLS selected no known tools. Known ids: ${ALL_TOOLS.map((t) => t.id).join(', ')}`,
    );
  }

  // One client per process: it owns the cached access token and the TLS dispatcher.
  const client = new M42Client(config);

  // serveStdio owns the protocol-era decision and pins one server instance per connection,
  // so the same registrations serve both the legacy and the current MCP spec.
  const handle = serveStdio(() => {
    const server = new McpServer(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
    );
    registerTools(server, { client, config }, tools);
    return server;
  });

  log(`ready — ${describeConfig(config)}`);
  if (config.allowInsecureTls) {
    log('warning: TLS certificate verification is disabled (M42_ALLOW_INSECURE_TLS)');
  }

  // stdin EOF is the primary shutdown signal for stdio servers; signals are belt-and-braces.
  let closing = false;
  const shutdown = (reason: string): void => {
    if (closing) return;
    closing = true;
    log(`shutting down (${reason})`);
    void handle.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

try {
  main();
} catch (error: unknown) {
  if (error instanceof ConfigError) {
    log(`configuration error: ${error.message}`);
  } else {
    log(`fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
  process.exit(1);
}
