// src/config.ts — resolves server configuration from environment variables.

/** How the server authenticates against Matrix42. */
export type AuthMode = 'token' | 'basic';

/** Fully resolved, validated server configuration. */
export interface Config {
  /** Base URL of the Matrix42 instance, e.g. "https://m42.example.com" (no trailing slash). */
  baseUrl: string;
  authMode: AuthMode;
  /** API token used for the token exchange (authMode 'token'). */
  apiToken?: string;
  /** Basic-auth username (authMode 'basic'). */
  username?: string;
  /** Basic-auth password (authMode 'basic'). */
  password?: string;
  /** Value of the Explicit-Language header sent with every request. */
  language: string;
  /** When true, TLS certificate verification is disabled (self-signed dev instances only). */
  allowInsecureTls: boolean;
  /** Tool ids the server should expose. Empty array means "all known tools". */
  enabledTools: string[];
  /** When true, tools that modify Matrix42 data are exposed. Off unless explicitly enabled. */
  allowWrites: boolean;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
}

/** Raised when the environment does not describe a usable configuration. */
export class ConfigError extends Error {}

const DEFAULT_LANGUAGE = 'en-US';
const DEFAULT_TIMEOUT_MS = 30_000;

/** Normalises a host or URL into an origin without a trailing slash. */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) throw new ConfigError('M42_HOST is empty');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ConfigError(`M42_HOST is not a valid host or URL: ${raw}`);
  }
  return `${url.protocol}//${url.host}`;
}

/** Parses a boolean-ish environment value ("1", "true", "yes" are true). */
export function parseBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/** Splits a comma-separated list env value into trimmed, non-empty entries. */
export function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** Builds the configuration from an environment map, throwing ConfigError when unusable. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const host = env.M42_HOST;
  if (!host || !host.trim()) {
    throw new ConfigError(
      'M42_HOST is required (e.g. M42_HOST=https://matrix42.example.com). ' +
        'See the README for client configuration examples.',
    );
  }
  const baseUrl = normalizeBaseUrl(host);

  const apiToken = env.M42_API_TOKEN?.trim();
  const username = env.M42_USERNAME?.trim();
  const password = env.M42_PASSWORD;

  let authMode: AuthMode;
  if (apiToken) {
    authMode = 'token';
  } else if (username && password) {
    authMode = 'basic';
  } else {
    throw new ConfigError(
      'No credentials configured. Set M42_API_TOKEN (recommended), ' +
        'or both M42_USERNAME and M42_PASSWORD for basic authentication.',
    );
  }

  const timeoutRaw = env.M42_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ConfigError(`M42_TIMEOUT_MS must be a positive number, got: ${timeoutRaw}`);
  }

  return {
    baseUrl,
    authMode,
    apiToken,
    username,
    password,
    language: env.M42_LANGUAGE?.trim() || DEFAULT_LANGUAGE,
    allowInsecureTls: parseBool(env.M42_ALLOW_INSECURE_TLS),
    enabledTools: parseList(env.M42_TOOLS),
    allowWrites: parseBool(env.M42_ALLOW_WRITES),
    timeoutMs,
  };
}

/** Redacts secrets so a configuration can be logged safely. */
export function describeConfig(config: Config): string {
  const auth = config.authMode === 'token' ? 'API token' : `basic (${config.username})`;
  const tls = config.allowInsecureTls ? ' [TLS verification DISABLED]' : '';
  const tools = config.enabledTools.length ? config.enabledTools.join(', ') : 'all';
  const mode = config.allowWrites ? 'read+write' : 'read-only';
  return `${config.baseUrl} · auth: ${auth} · language: ${config.language} · ${mode} · tools: ${tools}${tls}`;
}
