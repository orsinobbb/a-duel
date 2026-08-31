import type { DeckCardKey } from '../engine/battle';
import type { MatchSummary, PlayerSeat, UserSession } from './types';

const configuredApiBase = import.meta.env.VITE_A_DUEL_API_BASE?.trim().replace(/\/$/, '');
const apiBase = configuredApiBase || `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export async function login(name: string): Promise<UserSession> {
  const response = await request<{ user: UserSession }>('/login', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return response.user;
}

export async function restoreSession(token: string): Promise<UserSession> {
  const response = await request<{ user: UserSession }>('/session', { token });
  return response.user;
}

export async function logout(token: string): Promise<void> {
  await request('/logout', { method: 'POST', token });
}

export async function listMatches(): Promise<MatchSummary[]> {
  const response = await request<{ matches: MatchSummary[] }>('/matches');
  return response.matches;
}

export async function createMatch(token: string, deckOrder: readonly DeckCardKey[]): Promise<{ match: MatchSummary; seat: PlayerSeat }> {
  return request('/matches', { method: 'POST', token, body: JSON.stringify({ deckOrder }) });
}

export async function joinMatch(
  token: string,
  matchId: string,
  deckOrder: readonly DeckCardKey[],
): Promise<{ match: MatchSummary; seat: PlayerSeat | 'spectator' }> {
  return request(`/matches/${encodeURIComponent(matchId)}/join`, {
    method: 'POST',
    token,
    body: JSON.stringify({ deckOrder }),
  });
}

export async function leaveMatch(token: string, matchId: string): Promise<void> {
  await request(`/matches/${encodeURIComponent(matchId)}/leave`, { method: 'POST', token });
}

async function request<T = unknown>(path: string, options: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);

  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `http_${response.status}`, response.status);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
