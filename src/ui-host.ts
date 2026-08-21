// src/ui-host.ts — finds the origin the Matrix42 web interface is actually served from.
//
// The host you connect the API to is not necessarily the host the web interface runs on. An
// instance reachable at an IP commonly serves its UUX under a real name, and the shell's own
// config.json says so: restHosts.default names the API origin the browser app will call. Building
// a link against the wrong one loads the shell and then fails, because the app ends up calling a
// different origin than the one it was served from.

import type { M42Client } from './m42-client.js';

/** Where a UI origin came from, so a caller can tell a discovered value from a fallback. */
export type UiHostSource = 'configured' | 'discovered' | 'fallback';

/** The resolved web-interface origin. */
export interface UiHost {
  origin: string;
  source: UiHostSource;
  /** Present when discovery was attempted and did not work out. */
  note?: string;
}

/** Strips any trailing slash so segments join cleanly. */
function normalize(url: string): string {
  return url.replace(/\/+$/, '');
}

/** The origin of a URL, or null when it is not parseable. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Resolves the web-interface origin once per process.
 *
 * An explicit override always wins. Otherwise the shell's config.json is consulted, and the API
 * origin it names is used — that is the origin the browser app itself talks to, so a link built
 * against it lands the user in a working session. If config.json cannot be read, the configured
 * API host is used and the result is marked as a fallback rather than presented as certain.
 */
export class UiHostResolver {
  private cached: UiHost | undefined;

  constructor(
    private readonly apiBaseUrl: string,
    private readonly override?: string,
  ) {}

  async resolve(client: M42Client): Promise<UiHost> {
    if (this.cached) return this.cached;

    if (this.override?.trim()) {
      this.cached = { origin: normalize(this.override.trim()), source: 'configured' };
      return this.cached;
    }

    try {
      const config = await client.getJson<{ restHosts?: { default?: unknown } }>('wm/config.json');
      const declared = config?.restHosts?.default;
      const origin = typeof declared === 'string' ? originOf(declared) : null;
      if (origin) {
        this.cached = { origin, source: 'discovered' };
        return this.cached;
      }
      this.cached = {
        origin: normalize(this.apiBaseUrl),
        source: 'fallback',
        note: 'The web shell did not declare a REST host, so the configured API host was used. Set M42_UI_URL if links do not open.',
      };
    } catch {
      this.cached = {
        origin: normalize(this.apiBaseUrl),
        source: 'fallback',
        note: 'The web shell config could not be read, so the configured API host was used. Set M42_UI_URL if links do not open.',
      };
    }
    return this.cached;
  }
}
