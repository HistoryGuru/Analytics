/**
 * OpenCaselist API client.
 *
 * Verified against the LIVE OpenAPI spec at https://api.opencaselist.com/v1/docs
 * on 2026-08-16. If routes ever 404/change shape, re-fetch that URL - it's
 * publicly served straight from their Express app (ashtarcommunications/caselist
 * on GitHub, GPL-3.0), so it's always current.
 *
 * AUTH: every route except /status requires a `caselist_token` cookie. You get
 * that cookie by POSTing to /login with a username/password that has a *linked
 * and Tabroom-authorized* account. There is no anonymous/API-key access - the
 * backend calls out to Tabroom's own auth (LDAP-style) to validate credentials.
 * Use your own account. Don't share sessions, don't hammer it - the routes are
 * rate-limited server-side and it's community-run infrastructure.
 */

const BASE_URL = 'https://api.opencaselist.com/v1';

export interface OpenCaselistConfig {
  username: string;
  password: string;
  /** ms to sleep between requests. Be polite - this is free infra for the community. */
  delayMs?: number;
}

export interface Caselist {
  caselist_id: number;
  slug: string;
  name: string;
  event: string;
  year: number;
  archived: boolean;
}

export interface School {
  name: string;
  displayName: string;
  state?: string | null;
}

export interface Team {
  name: string;
  display_name: string;
  notes?: string;
  debater1_first?: string;
  debater1_last?: string;
  debater2_first?: string;
  debater2_last?: string;
}

export interface Round {
  tournament: string;
  side: string;
  round: string;
  opponent?: string | null;
  judge?: string | null;
  report?: string | null;
  tourn_id?: number | null;
  external_id?: number | null;
}

export interface Cite {
  cite_id: number;
  round_id: number;
  title?: string;
  cites?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenCaselistClient {
  private cookie: string | null = null;
  private readonly delayMs: number;

  constructor(private config: OpenCaselistConfig) {
    this.delayMs = config.delayMs ?? 1500;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    await sleep(this.delayMs);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    };
    if (this.cookie) headers['Cookie'] = this.cookie;

    const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });

    // Capture the session cookie on login
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenCaselist ${init.method ?? 'GET'} ${path} -> ${res.status}: ${body}`);
    }

    // Some endpoints (e.g. /status) return plain strings
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  async login(): Promise<void> {
    await this.request('/login', {
      method: 'POST',
      body: JSON.stringify({
        username: this.config.username,
        password: this.config.password,
        remember: false,
      }),
    });
    if (!this.cookie) {
      throw new Error(
        'Login did not return a session cookie - check TABROOM_USERNAME/PASSWORD and that the account is Tabroom-linked & authorized on opencaselist.com',
      );
    }
  }

  async getCaselists(includeArchived = false): Promise<Caselist[]> {
    return this.request<Caselist[]>(`/caselists?archived=${includeArchived}`);
  }

  async getSchools(caselistSlug: string): Promise<School[]> {
    return this.request<School[]>(`/caselists/${encodeURIComponent(caselistSlug)}/schools`);
  }

  async getTeams(caselistSlug: string, schoolName: string): Promise<Team[]> {
    return this.request<Team[]>(
      `/caselists/${encodeURIComponent(caselistSlug)}/schools/${encodeURIComponent(schoolName)}/teams`,
    );
  }

  async getRounds(caselistSlug: string, schoolName: string, teamName: string, side?: string): Promise<Round[]> {
    const q = side ? `?side=${encodeURIComponent(side)}` : '';
    return this.request<Round[]>(
      `/caselists/${encodeURIComponent(caselistSlug)}/schools/${encodeURIComponent(schoolName)}/teams/${encodeURIComponent(teamName)}/rounds${q}`,
    );
  }

  async getCites(caselistSlug: string, schoolName: string, teamName: string, side?: string): Promise<Cite[]> {
    const q = side ? `?side=${encodeURIComponent(side)}` : '';
    return this.request<Cite[]>(
      `/caselists/${encodeURIComponent(caselistSlug)}/schools/${encodeURIComponent(schoolName)}/teams/${encodeURIComponent(teamName)}/cites${q}`,
    );
  }

  /** Free-text search across the full-text index (cites + open source docs). */
  async search(query: string, shard: string): Promise<unknown> {
    return this.request(`/search?q=${encodeURIComponent(query)}&shard=${encodeURIComponent(shard)}`);
  }
}
