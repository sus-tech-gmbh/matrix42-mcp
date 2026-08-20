// test/config.test.ts — unit tests for environment configuration parsing.

import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  describeConfig,
  loadConfig,
  normalizeBaseUrl,
  parseBool,
  parseList,
} from '../src/config.js';

const TOKEN_ENV = { M42_HOST: 'https://m42.example.com', M42_API_TOKEN: 'tok-123' };

describe('normalizeBaseUrl', () => {
  it('adds https:// when the scheme is missing', () => {
    expect(normalizeBaseUrl('m42.example.com')).toBe('https://m42.example.com');
  });

  it('keeps an explicit scheme and strips trailing slashes and paths', () => {
    expect(normalizeBaseUrl('http://10.0.0.1/')).toBe('http://10.0.0.1');
    expect(normalizeBaseUrl('https://m42.example.com/m42Services/')).toBe('https://m42.example.com');
  });

  it('preserves a non-default port', () => {
    expect(normalizeBaseUrl('m42.example.com:8443')).toBe('https://m42.example.com:8443');
  });

  it('rejects an empty host', () => {
    expect(() => normalizeBaseUrl('   ')).toThrow(ConfigError);
  });
});

describe('parseBool', () => {
  it('treats 1/true/yes/on as true, case-insensitively', () => {
    for (const value of ['1', 'true', 'TRUE', 'yes', 'on']) expect(parseBool(value)).toBe(true);
  });

  it('treats anything else as false and honours the fallback when unset', () => {
    for (const value of ['0', 'false', 'no', 'anything']) expect(parseBool(value)).toBe(false);
    expect(parseBool(undefined)).toBe(false);
    expect(parseBool(undefined, true)).toBe(true);
    expect(parseBool('', true)).toBe(true);
  });
});

describe('parseList', () => {
  it('splits, trims, and drops empty entries', () => {
    expect(parseList(' a , b ,, c ')).toEqual(['a', 'b', 'c']);
    expect(parseList(undefined)).toEqual([]);
    expect(parseList('')).toEqual([]);
  });
});

describe('loadConfig', () => {
  it('builds a token configuration with sensible defaults', () => {
    const config = loadConfig(TOKEN_ENV);
    expect(config.baseUrl).toBe('https://m42.example.com');
    expect(config.authMode).toBe('token');
    expect(config.apiToken).toBe('tok-123');
    expect(config.language).toBe('en-US');
    expect(config.allowInsecureTls).toBe(false);
    expect(config.enabledTools).toEqual([]);
    expect(config.timeoutMs).toBe(30_000);
  });

  it('prefers the API token when both token and basic credentials are present', () => {
    const config = loadConfig({ ...TOKEN_ENV, M42_USERNAME: 'u', M42_PASSWORD: 'p' });
    expect(config.authMode).toBe('token');
  });

  it('falls back to basic auth when only username and password are set', () => {
    const config = loadConfig({
      M42_HOST: 'm42.example.com',
      M42_USERNAME: 'Administrator',
      M42_PASSWORD: 'secret',
    });
    expect(config.authMode).toBe('basic');
    expect(config.username).toBe('Administrator');
  });

  it('requires a host', () => {
    expect(() => loadConfig({ M42_API_TOKEN: 'tok' })).toThrow(/M42_HOST is required/);
  });

  it('requires credentials', () => {
    expect(() => loadConfig({ M42_HOST: 'm42.example.com' })).toThrow(/No credentials configured/);
  });

  it('requires both halves of basic auth', () => {
    expect(() => loadConfig({ M42_HOST: 'h', M42_USERNAME: 'u' })).toThrow(
      /No credentials configured/,
    );
  });

  it('reads the optional overrides', () => {
    const config = loadConfig({
      ...TOKEN_ENV,
      M42_LANGUAGE: 'de-DE',
      M42_ALLOW_INSECURE_TLS: '1',
      M42_TOOLS: 'server_info, webservice_discovery',
      M42_TIMEOUT_MS: '5000',
    });
    expect(config.language).toBe('de-DE');
    expect(config.allowInsecureTls).toBe(true);
    expect(config.enabledTools).toEqual(['server_info', 'webservice_discovery']);
    expect(config.timeoutMs).toBe(5000);
  });

  it('rejects a non-numeric or non-positive timeout', () => {
    expect(() => loadConfig({ ...TOKEN_ENV, M42_TIMEOUT_MS: 'soon' })).toThrow(/positive number/);
    expect(() => loadConfig({ ...TOKEN_ENV, M42_TIMEOUT_MS: '0' })).toThrow(/positive number/);
  });
});

describe('describeConfig', () => {
  it('never includes the API token or password', () => {
    const described = describeConfig(
      loadConfig({ ...TOKEN_ENV, M42_TOOLS: 'server_info', M42_ALLOW_INSECURE_TLS: '1' }),
    );
    expect(described).not.toContain('tok-123');
    expect(described).toContain('https://m42.example.com');
    expect(described).toContain('TLS verification DISABLED');
  });

  it('names the basic-auth user but not the password', () => {
    const described = describeConfig(
      loadConfig({ M42_HOST: 'h', M42_USERNAME: 'Administrator', M42_PASSWORD: 'hunter2' }),
    );
    expect(described).toContain('Administrator');
    expect(described).not.toContain('hunter2');
  });
});
