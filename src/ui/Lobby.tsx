import { FormEvent } from 'react';
import { ArrowRight, Clock3, DoorOpen, LogIn, Plus, RefreshCw, Swords, UserRound } from 'lucide-react';
import type { MatchSummary, UserSession } from '../network/types';

type LobbyProps = {
  user: UserSession | null;
  playerName: string;
  joinCode: string;
  matches: MatchSummary[];
  busy: boolean;
  authReady: boolean;
  onPlayerNameChange(value: string): void;
  onJoinCodeChange(value: string): void;
  onLogin(event: FormEvent): void;
  onCreateMatch(): void;
  onJoinMatch(matchId?: string): void;
  onRefresh(): void;
};

export function Lobby({
  user,
  playerName,
  joinCode,
  matches,
  busy,
  authReady,
  onPlayerNameChange,
  onJoinCodeChange,
  onLogin,
  onCreateMatch,
  onJoinMatch,
  onRefresh,
}: LobbyProps) {
  return (
    <main className="lobbyView">
      <section className="lobbyActions" aria-label="對局操作">
        <div className="sectionHeading">
          <div>
            <span className="sectionKicker">ONLINE LOBBY</span>
            <h1>尋找下一場對決</h1>
          </div>
          <button className="iconButton" type="button" onClick={onRefresh} title="更新對局" aria-label="更新對局">
            <RefreshCw size={18} />
          </button>
        </div>

        {!authReady ? (
          <div className="authLoading"><span className="spinner" />正在恢復登入狀態</div>
        ) : !user ? (
          <form className="loginBlock" onSubmit={onLogin}>
            <label htmlFor="player-name">玩家名稱</label>
            <div className="fieldWithIcon">
              <UserRound size={18} />
              <input
                id="player-name"
                value={playerName}
                maxLength={20}
                autoComplete="nickname"
                onChange={(event) => onPlayerNameChange(event.target.value)}
                placeholder="輸入暱稱"
              />
            </div>
            <button className="primaryButton" type="submit" disabled={busy || !playerName.trim()}>
              <LogIn size={18} />
              進入大廳
            </button>
          </form>
        ) : (
          <div className="onlineActions">
            <button className="primaryButton createButton" type="button" onClick={onCreateMatch} disabled={busy}>
              <Plus size={18} />
              建立新對局
            </button>
            <div className="joinBlock">
              <label htmlFor="match-code">對局代碼</label>
              <div className="joinControls">
                <input
                  id="match-code"
                  value={joinCode}
                  maxLength={6}
                  inputMode="text"
                  autoCapitalize="characters"
                  onChange={(event) => onJoinCodeChange(normalizeCode(event.target.value))}
                  placeholder="ABC234"
                />
                <button type="button" onClick={() => onJoinMatch()} disabled={busy || joinCode.length !== 6}>
                  <DoorOpen size={18} />
                  加入
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="roomSection" aria-label="公開對局">
        <div className="roomHeader">
          <div>
            <span className="sectionKicker">MATCHES</span>
            <h2>公開對局</h2>
          </div>
          <span className="roomCount">{matches.length} 場</span>
        </div>

        {matches.length === 0 ? (
          <div className="emptyRooms">
            <Swords size={32} strokeWidth={1.5} />
            <strong>目前沒有公開對局</strong>
          </div>
        ) : (
          <div className="roomTable" role="table" aria-label="對局清單">
            <div className="roomTableHead" role="row">
              <span role="columnheader">狀態</span>
              <span role="columnheader">代碼</span>
              <span role="columnheader">Player A</span>
              <span role="columnheader">Player B</span>
              <span role="columnheader">更新</span>
              <span aria-hidden="true" />
            </div>
            {matches.map((match) => (
              <div className="roomRow" role="row" key={match.id}>
                <span role="cell"><MatchStatus match={match} /></span>
                <strong className="matchCode" role="cell">{match.id}</strong>
                <PlayerCell name={match.players.A?.name} online={match.presence.A} />
                <PlayerCell name={match.players.B?.name} online={match.presence.B} />
                <span className="updatedCell" role="cell"><Clock3 size={14} />{formatRelativeTime(match.updatedAt)}</span>
                <button
                  className="joinRoomButton"
                  type="button"
                  onClick={() => onJoinMatch(match.id)}
                  disabled={!user || busy}
                  aria-label={`加入對局 ${match.id}`}
                  title={match.status === 'waiting' ? '加入對局' : '觀戰'}
                >
                  <ArrowRight size={18} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function MatchStatus({ match }: { match: MatchSummary }) {
  const labels = { waiting: '等待中', playing: '對戰中', finished: '已結束' } as const;
  return <span className={`statusPill ${match.status}`}>{labels[match.status]}</span>;
}

function PlayerCell({ name, online }: { name?: string; online: boolean }) {
  return (
    <span className="playerCell" role="cell">
      <i className={online ? 'presenceDot online' : 'presenceDot'} />
      {name ?? '空位'}
    </span>
  );
}

function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function formatRelativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return '剛剛';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分鐘`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小時`;
  return `${Math.floor(elapsed / 86_400_000)} 天`;
}
