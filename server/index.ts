import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import {
  DUEL_DURATION_MS,
  createInitialState,
  forfeitBattle,
  getBattlePhase,
  isValidDeckOrder,
  resolveBattle,
  setPlayerDeckOrder,
  type BattleCard,
  type BattleState,
  type DeckCardKey,
} from '../src/engine/battle';
import type {
  ClientMessage,
  MatchSummary,
  PlayerSeat,
  PublicUser,
  ServerMessage,
  UserSession,
} from '../src/shared/protocol';
import { applyAuthorizedAction, getMatchLifecycle, isBattleAction } from './match';
import type { MatchRecord, PersistedSnapshot } from './protocol';
import { createSnapshotStore } from './store';

const PORT = Number(process.env.PORT ?? process.env.A_DUEL_SERVER_PORT ?? 8787);
const HOST = process.env.A_DUEL_HOST ?? (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const APP_BASE = normalizeBasePath(process.env.A_DUEL_BASE_PATH ?? '/a-duel');
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FINISHED_MATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WAITING_MATCH_TTL_MS = 6 * 60 * 60 * 1000;
const DIST_DIR = path.resolve(process.cwd(), 'dist');
const DATA_FILE = path.resolve(process.env.A_DUEL_DATA_FILE ?? path.join(process.cwd(), 'data', 'a-duel.json'));

type MatchRoom = MatchRecord & {
  sockets: Set<ClientSocket>;
};

type ClientSocket = WebSocket & {
  user?: UserSession;
  matchId?: string;
  isAlive?: boolean;
  messageCount?: number;
  messageWindowStartedAt?: number;
};

const sessions = new Map<string, UserSession>();
const matches = new Map<string, MatchRoom>();
const resolutionTimers = new Map<string, ReturnType<typeof setTimeout>>();
const store = createSnapshotStore(DATA_FILE, process.env.DATABASE_URL);
const server = http.createServer((req, res) => {
  void handleRequest(req, res);
});
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (!isWebSocketPath(url.pathname) || !isAllowedOrigin(req.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (webSocket) => {
    wss.emit('connection', webSocket, req);
  });
});

wss.on('connection', (rawSocket, req) => {
  const socket = rawSocket as ClientSocket;
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const token = url.searchParams.get('token') ?? '';
  const matchId = (url.searchParams.get('matchId') ?? '').toUpperCase();
  const user = getSession(token);
  const match = matches.get(matchId);

  if (!user || !match) {
    socket.close(1008, 'invalid_session_or_match');
    return;
  }

  socket.user = user;
  socket.matchId = matchId;
  socket.isAlive = true;
  socket.messageCount = 0;
  socket.messageWindowStartedAt = Date.now();
  match.sockets.add(socket);
  sendMatchUpdate(match, socket);
  broadcastMatch(match);

  socket.on('pong', () => {
    socket.isAlive = true;
  });
  socket.on('message', (raw) => handleSocketMessage(socket, raw.toString()));
  socket.on('close', () => {
    match.sockets.delete(socket);
    broadcastMatch(match);
  });
  socket.on('error', () => {
    match.sockets.delete(socket);
  });
});

const heartbeat = setInterval(() => {
  for (const rawSocket of wss.clients) {
    const socket = rawSocket as ClientSocket;
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 30_000);
heartbeat.unref();

const cleanup = setInterval(() => {
  if (pruneExpiredData()) persist();
}, 15 * 60_000);
cleanup.unref();

void bootstrap().catch(async (error) => {
  console.error('Unable to start A牌對決:', error);
  await store.close?.();
  process.exitCode = 1;
});

async function bootstrap() {
  const snapshot = await store.load();
  const now = Date.now();

  for (const session of snapshot.sessions) {
    if (session.expiresAt > now) sessions.set(session.token, session);
  }

  for (const record of snapshot.matches) {
    matches.set(record.id, { ...record, sockets: new Set() });
  }
  pruneExpiredData();

  server.listen(PORT, HOST, () => {
    console.log(`A牌對決已啟動：http://${HOST}:${PORT}${APP_BASE}/`);
  });
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    setSecurityHeaders(res);
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const apiPath = toApiPath(url.pathname);

    if (apiPath) {
      setCorsHeaders(req, res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      await routeApi(req, res, apiPath);
      return;
    }

    if (url.pathname === '/healthz') {
      sendJson(res, 200, { ok: true, matches: matches.size });
      return;
    }

    await serveApp(req, res, url.pathname);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const code = error instanceof HttpError ? error.code : 'server_error';
    if (!(error instanceof HttpError)) console.error(error);
    sendJson(res, status, { error: code });
  }
}

async function routeApi(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true, matches: matches.size });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/login') {
    const body = await readJson<{ name?: string }>(req);
    const name = normalizePlayerName(body.name);
    if (!name) throw new HttpError(400, 'name_required');

    const session: UserSession = {
      token: randomUUID(),
      userId: randomUUID(),
      name,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    sessions.set(session.token, session);
    persist();
    sendJson(res, 200, { user: session });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/session') {
    const user = requireSession(req);
    sendJson(res, 200, { user });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/logout') {
    const token = getBearerToken(req);
    if (token) sessions.delete(token);
    persist();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/matches') {
    if (pruneExpiredData()) persist();
    const summaries = [...matches.values()]
      .map(toMatchSummary)
      .sort((left, right) => matchSortScore(left) - matchSortScore(right) || right.updatedAt - left.updatedAt);
    sendJson(res, 200, { matches: summaries });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/matches') {
    const user = requireSession(req);
    const body = await readJson<{ deckOrder?: unknown }>(req);
    const deckOrder = parseDeckOrder(body.deckOrder);
    removeUserFromWaitingMatches(user.userId);
    const match = createMatch(user, deckOrder);
    matches.set(match.id, match);
    persist();
    sendJson(res, 201, { match: toMatchSummary(match), seat: 'A' satisfies PlayerSeat });
    return;
  }

  const joinRoute = pathname.match(/^\/api\/matches\/([A-Z0-9]{6})\/join$/i);
  if (req.method === 'POST' && joinRoute) {
    const user = requireSession(req);
    const body = await readJson<{ deckOrder?: unknown }>(req);
    const deckOrder = parseDeckOrder(body.deckOrder);
    const match = matches.get(joinRoute[1].toUpperCase());
    if (!match) throw new HttpError(404, 'match_not_found');

    const seat = joinOrWatch(match, user, deckOrder);
    match.updatedAt = Date.now();
    persist();
    broadcastMatch(match);
    sendJson(res, 200, { match: toMatchSummary(match), seat });
    return;
  }

  const leaveRoute = pathname.match(/^\/api\/matches\/([A-Z0-9]{6})\/leave$/i);
  if (req.method === 'POST' && leaveRoute) {
    const user = requireSession(req);
    const match = matches.get(leaveRoute[1].toUpperCase());
    if (!match) throw new HttpError(404, 'match_not_found');

    const seat = getSeat(match, user.userId);
    if (!seat) throw new HttpError(409, 'not_a_player');

    const lifecycle = getMatchLifecycle(match);
    if (lifecycle === 'waiting') {
      match.players[seat] = null;
    } else if (lifecycle === 'playing') {
      match.state = forfeitBattle(match.state, seat);
    }
    match.updatedAt = Date.now();

    if (!match.players.A && !match.players.B) {
      matches.delete(match.id);
      persist();
      sendJson(res, 200, { removed: true });
      for (const socket of match.sockets) socket.close(4001, 'match_removed');
      return;
    }

    persist();
    broadcastMatch(match);
    sendJson(res, 200, { match: toMatchSummary(match), removed: false });
    return;
  }

  throw new HttpError(404, 'not_found');
}

function handleSocketMessage(socket: ClientSocket, raw: string) {
  const match = socket.matchId ? matches.get(socket.matchId) : undefined;
  if (!match || !socket.user) return;

  if (!withinMessageLimit(socket) || Buffer.byteLength(raw, 'utf8') > 4096) {
    send(socket, { type: 'error', error: 'rate_limited' });
    return;
  }

  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    send(socket, { type: 'error', error: 'bad_json' });
    return;
  }

  if (message.type === 'ping') {
    send(socket, { type: 'pong', sentAt: Number(message.sentAt) || Date.now() });
    return;
  }

  if (message.type !== 'battle:action' || !isBattleAction(message.action)) {
    send(socket, { type: 'error', error: 'invalid_action' });
    return;
  }

  const seat = getSeat(match, socket.user.userId);
  if (!seat) {
    send(socket, { type: 'error', error: 'spectator_cannot_act' });
    return;
  }
  if (getMatchLifecycle(match) === 'waiting') {
    send(socket, { type: 'error', error: 'match_not_ready' });
    return;
  }

  const result = applyAuthorizedAction(match.state, message.action, seat);
  if (!result.ok) {
    send(socket, { type: 'error', error: result.error });
    return;
  }

  match.state = result.state;
  match.updatedAt = Date.now();
  persist();
  broadcastMatch(match);

  if (message.action.type === 'confirmDefense') scheduleResolution(match);
}

function scheduleResolution(match: MatchRoom) {
  const existingTimer = resolutionTimers.get(match.id);
  if (existingTimer) clearTimeout(existingTimer);

  const duelStartedAt = match.state.duelStartedAt;
  if (getBattlePhase(match.state) !== 'duel' || duelStartedAt === null) return;

  const delay = Math.max(0, duelStartedAt + DUEL_DURATION_MS - Date.now());
  const timer = setTimeout(() => {
    resolutionTimers.delete(match.id);
    const currentMatch = matches.get(match.id);
    if (!currentMatch || getBattlePhase(currentMatch.state) !== 'duel') return;

    currentMatch.state = resolveBattle(currentMatch.state).state;
    currentMatch.updatedAt = Date.now();
    persist();
    broadcastMatch(currentMatch);
  }, delay);
  timer.unref();
  resolutionTimers.set(match.id, timer);
}

function createMatch(user: UserSession, deckOrder?: readonly DeckCardKey[]): MatchRoom {
  return {
    id: makeMatchId(),
    state: createInitialState('A', true, Math.random, deckOrder ? { A: deckOrder } : {}),
    players: { A: publicUser(user), B: null },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sockets: new Set(),
  };
}

function joinOrWatch(match: MatchRoom, user: UserSession, deckOrder?: readonly DeckCardKey[]): PlayerSeat | 'spectator' {
  const existing = getSeat(match, user.userId);
  if (existing) return existing;
  if (getMatchLifecycle(match) !== 'waiting') return 'spectator';

  if (!match.players.A) {
    match.players.A = publicUser(user);
    if (deckOrder) match.state = setPlayerDeckOrder(match.state, 'A', deckOrder);
    return 'A';
  }
  if (!match.players.B) {
    match.players.B = publicUser(user);
    if (deckOrder) match.state = setPlayerDeckOrder(match.state, 'B', deckOrder);
    return 'B';
  }
  return 'spectator';
}

function removeUserFromWaitingMatches(userId: string) {
  for (const match of matches.values()) {
    if (getMatchLifecycle(match) !== 'waiting') continue;
    const seat = getSeat(match, userId);
    if (!seat) continue;
    match.players[seat] = null;
    match.updatedAt = Date.now();
    broadcastMatch(match);
    if (!match.players.A && !match.players.B) matches.delete(match.id);
  }
}

function broadcastMatch(match: MatchRoom) {
  for (const socket of match.sockets) sendMatchUpdate(match, socket);
}

function sendMatchUpdate(match: MatchRoom, socket: ClientSocket) {
  const seat = socket.user ? getSeat(match, socket.user.userId) : null;
  send(socket, {
    type: 'match:update',
    match: toMatchSummary(match),
    state: stateForViewer(match.state, seat),
    seat: seat ?? 'spectator',
  });
}

function stateForViewer(state: BattleState, seat: PlayerSeat | null): BattleState {
  return {
    ...state,
    localPlayer: seat ?? state.currentTurn,
    cards: state.cards.map((card) => redactCard(card, seat)),
  };
}

function redactCard(card: BattleCard, seat: PlayerSeat | null): BattleCard {
  if (card.owner === seat || card.revealed) return card;
  return { ...card, name: '未知', kind: 'rank', rank: null };
}

function toMatchSummary(match: MatchRoom): MatchSummary {
  return {
    id: match.id,
    players: match.players,
    presence: {
      A: isUserOnline(match, match.players.A?.userId),
      B: isUserOnline(match, match.players.B?.userId),
    },
    status: getMatchLifecycle(match),
    winner: match.state.winner,
    createdAt: match.createdAt,
    updatedAt: match.updatedAt,
  };
}

function isUserOnline(match: MatchRoom, userId: string | undefined): boolean {
  if (!userId) return false;
  return [...match.sockets].some((socket) => socket.user?.userId === userId && socket.readyState === WebSocket.OPEN);
}

function getSeat(match: MatchRecord, userId: string): PlayerSeat | null {
  if (match.players.A?.userId === userId) return 'A';
  if (match.players.B?.userId === userId) return 'B';
  return null;
}

function publicUser(user: UserSession): PublicUser {
  return { userId: user.userId, name: user.name };
}

function requireSession(req: http.IncomingMessage): UserSession {
  const user = getSession(getBearerToken(req));
  if (!user) throw new HttpError(401, 'unauthorized');
  return user;
}

function getSession(token: string): UserSession | null {
  const user = sessions.get(token);
  if (!user) return null;
  if (user.expiresAt <= Date.now()) {
    sessions.delete(token);
    persist();
    return null;
  }
  return user;
}

function getBearerToken(req: http.IncomingMessage): string {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function persist() {
  const snapshot: PersistedSnapshot = {
    version: 1,
    sessions: [...sessions.values()],
    matches: [...matches.values()].map(({ sockets: _sockets, ...match }) => match),
  };
  store.save(snapshot);
}

function pruneExpiredData(): boolean {
  const now = Date.now();
  let changed = false;

  for (const [token, session] of sessions) {
    if (session.expiresAt > now) continue;
    sessions.delete(token);
    changed = true;
  }

  for (const [id, match] of matches) {
    if (match.sockets.size > 0) continue;
    const lifecycle = getMatchLifecycle(match);
    const ttl = lifecycle === 'waiting' ? WAITING_MATCH_TTL_MS : FINISHED_MATCH_TTL_MS;
    if (now - match.updatedAt <= ttl) continue;
    matches.delete(id);
    changed = true;
  }
  return changed;
}

function withinMessageLimit(socket: ClientSocket): boolean {
  const now = Date.now();
  if (!socket.messageWindowStartedAt || now - socket.messageWindowStartedAt > 10_000) {
    socket.messageWindowStartedAt = now;
    socket.messageCount = 1;
    return true;
  }
  socket.messageCount = (socket.messageCount ?? 0) + 1;
  return socket.messageCount <= 40;
}

function matchSortScore(match: MatchSummary): number {
  if (match.status === 'waiting') return 0;
  if (match.status === 'playing') return 1;
  return 2;
}

function makeMatchId(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  do {
    const bytes = randomBytes(6);
    id = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
  } while (matches.has(id));
  return id;
}

function normalizePlayerName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const name = value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 20);
  return /[\u0000-\u001f\u007f]/.test(name) ? '' : name;
}

function parseDeckOrder(value: unknown): DeckCardKey[] | undefined {
  if (value === undefined) return undefined;
  if (!isValidDeckOrder(value)) throw new HttpError(400, 'invalid_deck_order');
  return [...value];
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 16_384) throw new HttpError(413, 'payload_too_large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {} as T;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    throw new HttpError(400, 'bad_json');
  }
}

async function serveApp(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(404, 'not_found');
  if (pathname === '/') {
    res.writeHead(302, { Location: `${APP_BASE}/` });
    res.end();
    return;
  }
  if (pathname === APP_BASE) {
    res.writeHead(302, { Location: `${APP_BASE}/` });
    res.end();
    return;
  }
  if (!pathname.startsWith(`${APP_BASE}/`)) throw new HttpError(404, 'not_found');

  const relativePath = decodeURIComponent(pathname.slice(APP_BASE.length)).replace(/^\/+/, '');
  let filePath = path.resolve(DIST_DIR, relativePath || 'index.html');
  if (!filePath.startsWith(`${DIST_DIR}${path.sep}`)) throw new HttpError(404, 'not_found');

  let fileExists = await isFile(filePath);
  if (!fileExists && !path.extname(relativePath)) {
    filePath = path.join(DIST_DIR, 'index.html');
    fileExists = await isFile(filePath);
  }
  if (!fileExists) throw new HttpError(503, 'app_not_built');

  const content = await readFile(filePath);
  const isAsset = filePath.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    'Content-Type': contentType(filePath),
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else res.end(content);
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  };
  return types[extension] ?? 'application/octet-stream';
}

function toApiPath(pathname: string): string | null {
  if (pathname === '/api' || pathname.startsWith('/api/')) return pathname;
  const baseApi = `${APP_BASE}/api`;
  if (pathname === baseApi || pathname.startsWith(`${baseApi}/`)) return pathname.slice(APP_BASE.length);
  return null;
}

function isWebSocketPath(pathname: string): boolean {
  return pathname === '/ws' || pathname === `${APP_BASE}/ws`;
}

function normalizeBasePath(value: string): string {
  const trimmed = `/${value}`.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  return trimmed || '/a-duel';
}

function setSecurityHeaders(res: http.ServerResponse) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'self'; frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
}

function setCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  const configured = (process.env.A_DUEL_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return configured.includes(origin.replace(/\/$/, ''));
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function shutdown() {
  clearInterval(heartbeat);
  clearInterval(cleanup);
  persist();
  await store.flush();
  await store.close?.();
  server.close();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
