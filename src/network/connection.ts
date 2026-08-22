import type { BattleAction, ServerMessage, UserSession } from './types';

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting' | 'closed' | 'error';
type MatchEvent = Exclude<ServerMessage, { type: 'pong' }>;

type ConnectionHandlers = {
  onMessage(message: MatchEvent): void;
  onStatus(status: ConnectionStatus): void;
};

export class MatchConnection {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectAttempts = 0;
  private intentionallyClosed = false;

  constructor(
    private readonly user: UserSession,
    private readonly matchId: string,
    private readonly handlers: ConnectionHandlers,
  ) {}

  connect() {
    this.intentionallyClosed = false;
    this.openSocket();
  }

  sendAction(action: BattleAction): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type: 'battle:action', action }));
    return true;
  }

  close() {
    this.intentionallyClosed = true;
    this.clearTimers();
    this.socket?.close(1000, 'client_closed');
    this.socket = null;
    this.handlers.onStatus('closed');
  }

  private openSocket() {
    this.clearReconnectTimer();
    this.handlers.onStatus(this.reconnectAttempts === 0 ? 'connecting' : 'reconnecting');
    const url = makeWebSocketUrl();
    url.searchParams.set('token', this.user.token);
    url.searchParams.set('matchId', this.matchId);

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.reconnectAttempts = 0;
      this.handlers.onStatus('online');
      this.startHeartbeat();
    });

    socket.addEventListener('message', (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        this.handlers.onMessage({ type: 'error', error: 'bad_server_message' });
        return;
      }
      if (message.type !== 'pong') this.handlers.onMessage(message);
    });

    socket.addEventListener('error', () => {
      if (this.socket === socket) this.handlers.onStatus('error');
    });

    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return;
      this.stopHeartbeat();
      this.socket = null;
      if (this.intentionallyClosed) return;
      if (event.code === 1008 || event.code === 4001) {
        this.intentionallyClosed = true;
        this.handlers.onStatus('error');
        this.handlers.onMessage({
          type: 'error',
          error: event.code === 4001 ? 'match_removed' : 'invalid_session_or_match',
        });
        return;
      }
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    this.reconnectAttempts += 1;
    this.handlers.onStatus('reconnecting');
    const delay = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 10_000);
    this.reconnectTimer = window.setTimeout(() => this.openSocket(), delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'ping', sentAt: Date.now() }));
      }
    }, 20_000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearTimers() {
    this.clearReconnectTimer();
    this.stopHeartbeat();
  }
}

function makeWebSocketUrl(): URL {
  const configured = import.meta.env.VITE_A_DUEL_WS_BASE;
  if (configured) {
    const url = new URL(configured);
    if (url.pathname === '/') url.pathname = '/ws';
    return url;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  return new URL(`${protocol}//${window.location.host}${basePath}/ws`);
}
