// src/m42-client.ts — authenticated HTTP client for the Matrix42 REST API.

// Node's global fetch ignores a dispatcher created by this package, so use undici's own fetch:
// they must come from the same implementation for the TLS dispatcher to apply.
import { Agent, fetch, type Dispatcher, type RequestInit, type Response } from 'undici';
import type { Config } from './config.js';

/** Raw HTTP response from the Matrix42 API. */
export interface M42Response {
  status: number;
  body: string;
}

/** Raised when a Matrix42 request fails (non-2xx) or authentication cannot be established. */
export class M42Error extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'M42Error';
  }
}

/** Shape returned by the token exchange endpoint. */
interface TokenExchangeBody {
  RawToken?: string;
  LifeTime?: string;
}

const TOKEN_EXCHANGE_PATH = 'm42Services/api/ApiToken/GenerateAccessTokenFromApiToken';
/** Refresh this long before the access token actually expires. */
const EXPIRY_BUFFER_MS = 60_000;

/**
 * Client for one Matrix42 instance. Handles the API-token → access-token exchange, caches the
 * access token until shortly before it expires, and applies the Explicit-Language header.
 */
export class M42Client {
  private accessToken: string | null = null;
  /** Epoch milliseconds at which the cached access token stops being usable. */
  private tokenExpiresAt = 0;
  private inFlightExchange: Promise<string> | null = null;
  private readonly dispatcher?: Dispatcher;

  constructor(private readonly config: Config) {
    if (config.allowInsecureTls) {
      // Scoped to this client only — never disables verification process-wide.
      this.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    }
  }

  /** Base URL this client talks to. */
  get baseUrl(): string {
    return this.config.baseUrl;
  }

  /** Sends an authenticated request and returns the raw status + body. */
  async request(method: string, path: string, body?: string): Promise<M42Response> {
    const url = `${this.config.baseUrl}/${path.replace(/^\/+/, '')}`;
    const headers: Record<string, string> = {
      Authorization: await this.authorizationHeader(),
      Accept: 'application/json, text/plain, */*',
      // Matrix42 ignores Accept-Language; Explicit-Language is the documented control.
      'Explicit-Language': this.config.language,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json;charset=UTF-8';

    const response = await this.fetchWithTimeout(url, { method, headers, body });
    return { status: response.status, body: await response.text() };
  }

  /** Sends an authenticated GET and parses the JSON body, throwing M42Error on failure. */
  async getJson<T>(path: string): Promise<T> {
    const { status, body } = await this.request('GET', path);
    if (status < 200 || status >= 300) {
      throw new M42Error(`Matrix42 returned HTTP ${status} for /${path}: ${truncate(body)}`, status);
    }
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new M42Error(`Matrix42 returned a non-JSON body for /${path}: ${truncate(body)}`, status);
    }
  }

  /** Verifies the configured credentials by performing a cheap authenticated read. */
  async verifyConnection(): Promise<void> {
    const { status, body } = await this.request('GET', 'm42Services/api/Schema/classes');
    if (status < 200 || status >= 300) {
      throw new M42Error(
        `Connection check failed with HTTP ${status}. ` +
          (status === 401
            ? 'Credentials were rejected — check M42_API_TOKEN (or M42_USERNAME/M42_PASSWORD).'
            : status === 403
              ? 'Authenticated, but this account is not permitted to read the API (role/audience restriction).'
              : status === 406
                ? 'Matrix42 rejected the credentials. An API token must be exchanged for an access token — check that M42_API_TOKEN is a valid, unexpired API token.'
                : truncate(body)),
        status,
      );
    }
  }

  /** Builds the Authorization header, exchanging/refreshing the access token when needed. */
  private async authorizationHeader(): Promise<string> {
    if (this.config.authMode === 'basic') {
      const credentials = `${this.config.username ?? ''}:${this.config.password ?? ''}`;
      return `Basic ${Buffer.from(credentials).toString('base64')}`;
    }
    return `Bearer ${await this.ensureAccessToken()}`;
  }

  /**
   * Returns a valid access token, exchanging the API token when the cached one is missing or
   * about to expire. Concurrent callers share a single in-flight exchange.
   */
  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - EXPIRY_BUFFER_MS) {
      return this.accessToken;
    }
    this.inFlightExchange ??= this.exchangeToken().finally(() => {
      this.inFlightExchange = null;
    });
    return this.inFlightExchange;
  }

  /** Exchanges the configured API token for a short-lived access token. */
  private async exchangeToken(): Promise<string> {
    const url = `${this.config.baseUrl}/${TOKEN_EXCHANGE_PATH}`;
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiToken ?? ''}`,
        'Content-Length': '0',
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new M42Error(
        `Token exchange failed with HTTP ${response.status}: ${truncate(text)}`,
        response.status,
      );
    }
    let parsed: TokenExchangeBody | null;
    try {
      parsed = JSON.parse(text) as TokenExchangeBody | null;
    } catch {
      throw new M42Error(`Token exchange returned an unreadable body: ${truncate(text)}`);
    }
    // Matrix42 answers 200 with a literal `null` when the API token is expired or invalid.
    if (!parsed?.RawToken) {
      throw new M42Error(
        'Token exchange returned no token — the API token is expired or invalid. ' +
          'Generate a new API token in the Matrix42 Administration application.',
      );
    }
    this.accessToken = parsed.RawToken;
    this.tokenExpiresAt = parseLifetime(parsed.LifeTime);
    return this.accessToken;
  }

  /** fetch() with the configured timeout and TLS dispatcher applied. */
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new M42Error(`Request to ${url} timed out after ${this.config.timeoutMs}ms`);
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new M42Error(`Request to ${url} failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Parses the LifeTime field into epoch ms, falling back to a conservative 5 minutes. */
export function parseLifetime(lifetime: string | undefined): number {
  const parsed = lifetime ? Date.parse(lifetime) : Number.NaN;
  return Number.isNaN(parsed) ? Date.now() + 5 * 60_000 : parsed;
}

/** Shortens a body for inclusion in an error message. */
function truncate(text: string, max = 300): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}
