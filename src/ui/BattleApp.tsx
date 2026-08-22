import { FormEvent, useEffect, useRef, useState } from 'react';
import { Crown, Gamepad2, LogOut, Radio, UserRound } from 'lucide-react';
import {
  BattleState,
  confirmAttack,
  confirmDefense,
  createInitialState,
  passTurn,
  resolveBattle,
  restartBattle,
  selectDefenseCard,
  selectAttacker,
  selectTarget,
  switchLocalPlayer,
} from '../engine/battle';
import { ApiError, createMatch, joinMatch, leaveMatch, listMatches, login, logout, restoreSession } from '../network/api';
import { ConnectionStatus, MatchConnection } from '../network/connection';
import { clearStoredSession, loadStoredSession, saveStoredSession } from '../network/session';
import type { BattleAction, MatchSummary, PlayerSeat, UserSession } from '../network/types';
import { BattleBoard } from './BattleBoard';
import { Lobby } from './Lobby';

type AppView = 'lobby' | 'local' | 'match';
type NoticeTone = 'info' | 'success' | 'warn' | 'error';
type Notice = { text: string; tone: NoticeTone } | null;

export function BattleApp() {
  const [view, setView] = useState<AppView>('lobby');
  const [state, setState] = useState<BattleState>(() => createInitialState('A', true));
  const [user, setUser] = useState<UserSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [activeMatch, setActiveMatch] = useState<MatchSummary | null>(null);
  const [seat, setSeat] = useState<PlayerSeat | 'spectator' | null>(null);
  const [joinCode, setJoinCode] = useState(() => matchCodeFromUrl());
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('offline');
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const connectionRef = useRef<MatchConnection | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stored = loadStoredSession();

    async function initialize() {
      if (stored) {
        try {
          const restored = await restoreSession(stored.token);
          if (!cancelled) {
            setUser(restored);
            setPlayerName(restored.name);
            saveStoredSession(restored);
          }
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            clearStoredSession();
          } else if (!cancelled) {
            setUser(stored);
            setPlayerName(stored.name);
          }
        }
      }
      if (!cancelled) {
        setAuthReady(true);
        await refreshMatches(false);
      }
    }

    void initialize();
    return () => {
      cancelled = true;
      connectionRef.current?.close();
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (view !== 'lobby') return;
    const timer = window.setInterval(() => void refreshMatches(false), 10_000);
    return () => window.clearInterval(timer);
  }, [view]);

  function showNotice(text: string, tone: NoticeTone = 'info', persist = false) {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setNotice({ text, tone });
    if (!persist) {
      noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4200);
    }
  }

  async function refreshMatches(reportError = true) {
    try {
      setMatches(await listMatches());
    } catch (error) {
      if (reportError) showNotice(apiErrorText(error), 'error');
    }
  }

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    if (!playerName.trim()) return;
    setBusy(true);
    try {
      const nextUser = await login(playerName);
      setUser(nextUser);
      setPlayerName(nextUser.name);
      saveStoredSession(nextUser);
      showNotice(`${nextUser.name}，歡迎進入大廳`, 'success');
      await refreshMatches(false);
    } catch (error) {
      showNotice(apiErrorText(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    const currentUser = user;
    connectionRef.current?.close();
    connectionRef.current = null;
    clearStoredSession();
    setUser(null);
    setActiveMatch(null);
    setSeat(null);
    setView('lobby');
    setConnectionStatus('offline');
    updateMatchUrl(null);
    if (currentUser) await logout(currentUser.token).catch(() => undefined);
    showNotice('已登出', 'info');
  }

  async function onCreateMatch() {
    if (!user) return showNotice('請先登入', 'warn');
    setBusy(true);
    try {
      const result = await createMatch(user.token);
      enterOnlineMatch(user, result.match, result.seat);
      showNotice(`對局 ${result.match.id} 已建立`, 'success');
    } catch (error) {
      showNotice(apiErrorText(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onJoinMatch(matchId = joinCode) {
    if (!user) return showNotice('請先登入', 'warn');
    const normalized = matchId.trim().toUpperCase();
    if (normalized.length !== 6) return showNotice('請輸入 6 碼對局代碼', 'warn');

    setBusy(true);
    try {
      const result = await joinMatch(user.token, normalized);
      enterOnlineMatch(user, result.match, result.seat);
      showNotice(result.seat === 'spectator' ? '已進入觀戰' : `已加入 Player ${result.seat}`, 'success');
    } catch (error) {
      showNotice(apiErrorText(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function enterOnlineMatch(nextUser: UserSession, match: MatchSummary, nextSeat: PlayerSeat | 'spectator') {
    connectionRef.current?.close();
    setActiveMatch(match);
    setSeat(nextSeat);
    setState(createInitialState(nextSeat === 'B' ? 'B' : 'A', true));
    setView('match');
    setJoinCode(match.id);
    updateMatchUrl(match.id);

    const connection = new MatchConnection(nextUser, match.id, {
      onMessage(message) {
        if (message.type === 'error') {
          showNotice(socketErrorText(message.error), 'error');
          return;
        }
        setActiveMatch(message.match);
        setSeat(message.seat);
        setState(message.state);
      },
      onStatus(status) {
        setConnectionStatus(status);
        if (status === 'reconnecting') showNotice('連線中斷，正在重新連線', 'warn', true);
        if (status === 'online') setNotice((current) => current?.text.includes('重新連線') ? null : current);
      },
    });
    connectionRef.current = connection;
    connection.connect();
  }

  async function onLeaveBattle() {
    if (view === 'local') {
      setView('lobby');
      setState(createInitialState('A', true));
      return;
    }
    if (!activeMatch) return;

    const isPlayer = seat === 'A' || seat === 'B';
    if (isPlayer && activeMatch.status === 'playing') {
      const confirmed = window.confirm('離開進行中的對局將視為投降，確定要離開嗎？');
      if (!confirmed) return;
    }

    setBusy(true);
    try {
      if (user && isPlayer) await leaveMatch(user.token, activeMatch.id);
      exitOnlineMatch();
      await refreshMatches(false);
    } catch (error) {
      showNotice(apiErrorText(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function exitOnlineMatch() {
    connectionRef.current?.close();
    connectionRef.current = null;
    setActiveMatch(null);
    setSeat(null);
    setConnectionStatus('offline');
    setState(createInitialState('A', true));
    setView('lobby');
    updateMatchUrl(null);
  }

  function startLocalBattle() {
    connectionRef.current?.close();
    connectionRef.current = null;
    setActiveMatch(null);
    setSeat(null);
    setConnectionStatus('offline');
    setState(createInitialState('A', true));
    setView('local');
    updateMatchUrl(null);
  }

  function dispatchBattleAction(action: BattleAction) {
    if (view === 'match') {
      if (!connectionRef.current?.sendAction(action)) showNotice('連線尚未就緒，操作未送出', 'warn');
      return;
    }
    setState((current) => applyLocalAction(current, action));
  }

  async function copyMatchLink() {
    if (!activeMatch) return;
    const url = new URL(import.meta.env.BASE_URL, window.location.origin);
    url.searchParams.set('match', activeMatch.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      showNotice('邀請連結已複製', 'success');
    } catch {
      showNotice(`對局代碼：${activeMatch.id}`, 'info', true);
    }
  }

  return (
    <div className="appRoot">
      <header className="appHeader">
        <button className="brandButton" type="button" onClick={() => view === 'lobby' && setView('lobby')} aria-label="A牌對決">
          <span className="brandMark"><Crown size={21} /></span>
          <span><strong>A牌對決</strong><small>A DUEL</small></span>
        </button>

        <nav className="modeSwitch" aria-label="遊戲模式">
          <button type="button" className={view === 'lobby' || view === 'match' ? 'active' : ''} onClick={() => setView('lobby')} disabled={view === 'match'}>
            <Radio size={17} />線上大廳
          </button>
          <button type="button" className={view === 'local' ? 'active' : ''} onClick={startLocalBattle} disabled={view === 'match'}>
            <Gamepad2 size={17} />本機對戰
          </button>
        </nav>

        <div className="accountArea">
          {user ? (
            <>
              <span className="accountName"><UserRound size={17} />{user.name}</span>
              <button className="iconButton" type="button" onClick={onLogout} title="登出" aria-label="登出"><LogOut size={18} /></button>
            </>
          ) : (
            <span className="guestLabel">訪客</span>
          )}
        </div>
      </header>

      {notice && <div className={`noticeBar ${notice.tone}`} role="status">{notice.text}</div>}

      {view === 'lobby' ? (
        <Lobby
          user={user}
          playerName={playerName}
          joinCode={joinCode}
          matches={matches}
          busy={busy}
          authReady={authReady}
          onPlayerNameChange={setPlayerName}
          onJoinCodeChange={setJoinCode}
          onLogin={onLogin}
          onCreateMatch={onCreateMatch}
          onJoinMatch={onJoinMatch}
          onRefresh={() => void refreshMatches()}
        />
      ) : (
        <BattleBoard
          state={state}
          match={activeMatch}
          seat={seat}
          connectionStatus={connectionStatus}
          online={view === 'match'}
          onAction={dispatchBattleAction}
          onLeave={() => void onLeaveBattle()}
          onCopyCode={() => void copyMatchLink()}
          onSwitchPerspective={() => setState(switchLocalPlayer)}
        />
      )}
    </div>
  );
}

function applyLocalAction(state: BattleState, action: BattleAction): BattleState {
  switch (action.type) {
    case 'selectAttacker':
      return selectAttacker(state, action.cardId);
    case 'selectTarget':
      return selectTarget(state, action.cardId);
    case 'confirmAttack':
      return confirmAttack(state);
    case 'selectDefenseCard':
      return selectDefenseCard(state, action.cardId);
    case 'confirmDefense':
      return confirmDefense(state);
    case 'resolve':
      return resolveBattle(state).state;
    case 'pass':
      return passTurn(state);
    case 'restart':
      return restartBattle(state, true);
  }
}

function matchCodeFromUrl(): string {
  return new URLSearchParams(window.location.search).get('match')?.toUpperCase().slice(0, 6) ?? '';
}

function updateMatchUrl(matchId: string | null) {
  const url = new URL(window.location.href);
  if (matchId) url.searchParams.set('match', matchId);
  else url.searchParams.delete('match');
  window.history.replaceState({}, '', url);
}

function apiErrorText(error: unknown): string {
  if (!(error instanceof ApiError)) return '無法連線伺服器，請稍後再試';
  const messages: Record<string, string> = {
    name_required: '請輸入玩家名稱',
    unauthorized: '登入已過期，請重新登入',
    match_not_found: '找不到這個對局',
    not_a_player: '你不是此對局的玩家',
    rate_limited: '操作太頻繁，請稍候',
    app_not_built: '前端尚未完成建置',
  };
  return messages[error.code] ?? '操作失敗，請稍後再試';
}

function socketErrorText(code: string): string {
  const messages: Record<string, string> = {
    spectator_cannot_act: '觀戰者不能操作牌局',
    match_not_ready: '等待另一位玩家加入',
    not_your_action: '目前不是你的操作階段',
    action_not_allowed: '這個動作目前不能執行',
    game_finished: '本局已經結束',
    game_in_progress: '對局進行中，不能重新開始',
    invalid_action: '無效的牌局操作',
    rate_limited: '操作太頻繁，請稍候',
    bad_server_message: '收到無法辨識的伺服器訊息',
    invalid_session_or_match: '登入或對局已失效，請返回大廳',
    match_removed: '此對局已關閉',
  };
  return messages[code] ?? '線上對局發生錯誤';
}
