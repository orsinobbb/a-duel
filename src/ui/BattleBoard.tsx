import { useEffect, useState } from 'react';
import {
  Copy,
  Eye,
  Flag,
  Layers3,
  LogOut,
  RotateCcw,
  ShieldCheck,
  SkipForward,
  Swords,
} from 'lucide-react';
import {
  BattleCard,
  BattleState,
  DUEL_ANIMATION_MS,
  DUEL_DURATION_MS,
  Player,
  getAliveCards,
  getBattlePhase,
  getCardLabel,
  getCoverOptions,
  getDuelPreview,
  isRematchReady,
  labelPlayer,
  otherPlayer,
} from '../engine/battle';
import type { BattleAction, MatchSummary, PlayerSeat } from '../network/types';
import type { ConnectionStatus } from '../network/connection';
import { getCardArtworkUrl } from './cardArtwork';

type BattleBoardProps = {
  state: BattleState;
  match: MatchSummary | null;
  seat: PlayerSeat | 'spectator' | null;
  connectionStatus: ConnectionStatus;
  online: boolean;
  onAction(action: BattleAction): void;
  onLeave(): void;
  onCopyCode(): void;
  onSwitchPerspective(): void;
};

export function BattleBoard({
  state,
  match,
  seat,
  connectionStatus,
  online,
  onAction,
  onLeave,
  onCopyCode,
  onSwitchPerspective,
}: BattleBoardProps) {
  const phase = getBattlePhase(state);
  const [duelResultVisible, setDuelResultVisible] = useState(false);
  const coverOptions = new Set(getCoverOptions(state).map((card) => card.id));
  const bottomPlayer: Player = online ? (seat === 'B' ? 'B' : 'A') : state.localPlayer;
  const topPlayer = otherPlayer(bottomPlayer);
  const attacker = state.cards.find((card) => card.id === state.selectedAttackerId);
  const target = state.cards.find((card) => card.id === state.selectedTargetId);
  const defenseCard = state.defenseMode === 'cover'
    ? state.cards.find((card) => card.id === state.selectedCoverId)
    : target;
  const canUseOnlineControls = !online || (match?.status === 'playing' && connectionStatus === 'online');
  const playerSeat = seat === 'A' || seat === 'B' ? seat : null;
  const rematchPlayer = online ? playerSeat : state.localPlayer;
  const defender = otherPlayer(state.currentTurn);
  const canDefend = Boolean(
    target &&
      canUseOnlineControls &&
      phase === 'select-defense' &&
      (!online || playerSeat === defender),
  );
  const canAttack = canUseOnlineControls && (!online || playerSeat === state.currentTurn);
  const duelPreview = getDuelPreview(state);
  const showDefenseContext = Boolean(
    attacker &&
      target &&
      (phase === 'select-defense' || phase === 'duel'),
  );

  useEffect(() => {
    if (phase !== 'duel' || state.duelStartedAt === null) {
      setDuelResultVisible(false);
      return;
    }

    const revealAt = state.duelStartedAt + DUEL_ANIMATION_MS;
    const revealTimer = window.setTimeout(() => setDuelResultVisible(true), Math.max(0, revealAt - Date.now()));
    const resolveTimer = !online
      ? window.setTimeout(() => onAction({ type: 'resolve' }), Math.max(0, state.duelStartedAt + DUEL_DURATION_MS - Date.now()))
      : null;

    return () => {
      window.clearTimeout(revealTimer);
      if (resolveTimer !== null) window.clearTimeout(resolveTimer);
    };
  }, [phase, state.duelStartedAt, online, onAction]);

  function onCardClick(card: BattleCard) {
    if (!isCardActionable(card, state, online, playerSeat, match, connectionStatus, coverOptions)) return;

    if (phase === 'select-defense') {
      onAction({ type: 'selectDefenseCard', cardId: card.id });
    } else if (phase === 'select-attack') {
      onAction(card.owner === state.currentTurn ? { type: 'selectAttacker', cardId: card.id } : { type: 'selectTarget', cardId: card.id });
    }
  }

  return (
    <main className="gameView">
      {phase === 'duel' && attacker && defenseCard && (
        <section className={`duelOverlay ${duelResultVisible ? 'revealed' : ''}`} aria-live="assertive" aria-label="Duel animation">
          <div className="duelArena">
            <article className="duelFighter attacker">
              <span className="duelFighterRole">ATTACK</span>
              <span className="duelFighterIcon"><CardArtwork card={attacker} className="duelCardArtwork" /></span>
              <strong>{cardDisplayName(attacker)}</strong>
            </article>
            <div className="duelImpact" aria-hidden="true"><Swords size={32} /><span>VS</span></div>
            <article className="duelFighter defender">
              <span className="duelFighterRole">{state.defenseMode === 'cover' ? 'COVER' : 'FACE'}</span>
              <span className="duelFighterIcon"><CardArtwork card={defenseCard} className="duelCardArtwork" /></span>
              <strong>{cardDisplayName(defenseCard)}</strong>
            </article>
          </div>
          <div className="duelOverlayStatus">
            {duelResultVisible ? (
              <>
                <strong>對決結果</strong>
                {duelPreview.map((line) => <p key={line}>{line}</p>)}
              </>
            ) : (
              <>
                <strong>對決中</strong>
                <p>雙方牌面已鎖定</p>
              </>
            )}
          </div>
        </section>
      )}
      <section className="battleStage" aria-label="A牌對決戰場">
        <div className="matchToolbar">
          <div className="matchIdentity">
            <Swords size={18} />
            <div>
              <span>{online ? '線上對局' : '本機對戰'}</span>
              <strong>{online ? match?.id : 'HOT SEAT'}</strong>
            </div>
            {online && (
              <button className="iconButton compact" type="button" onClick={onCopyCode} title="複製邀請連結" aria-label="複製邀請連結">
                <Copy size={16} />
              </button>
            )}
          </div>

          <div className="matchTools">
            {online ? (
              <span className={`connectionBadge ${connectionStatus}`}><i />{connectionLabel(connectionStatus)}</span>
            ) : (
              <button type="button" onClick={onSwitchPerspective}>
                <Eye size={17} />
                視角 {labelPlayer(state.localPlayer)}
              </button>
            )}
            <button className="quietButton" type="button" onClick={onLeave}>
              <LogOut size={17} />
              {online && match?.status === 'playing' && playerSeat ? '投降離開' : '返回大廳'}
            </button>
          </div>
        </div>

        <PlayerRow
          player={topPlayer}
          state={state}
          match={match}
          online={online}
          seat={seat}
          coverOptions={coverOptions}
          isBottom={false}
          isActionable={(card) => isCardActionable(card, state, online, playerSeat, match, connectionStatus, coverOptions)}
          onCardClick={onCardClick}
        />

        <div className="battleCenter">
          <div className="duelLane" aria-live="polite">
          <div className="duelCardName left">
            <small>{attacker ? `Player ${attacker.owner} · ${cardReference(attacker)}` : 'ATTACK'}</small>
            <strong>{attacker ? cardDisplayName(attacker) : '尚未選牌'}</strong>
          </div>
          <div className="versusMark"><Swords size={20} /><span>VS</span></div>
          <div className="duelCardName right">
            <small>{target ? `Player ${target.owner} · ${cardReference(target)}` : 'TARGET'}</small>
            <strong>{target ? cardDisplayName(target) : '尚未選牌'}</strong>
          </div>
          </div>

          <BattleActions
            phase={phase}
            state={state}
            canAttack={canAttack}
            canDefend={canDefend}
            rematchPlayer={rematchPlayer}
            connectionStatus={connectionStatus}
            onAction={onAction}
          />
        </div>

        {false && phase === 'duel' && (
          <section className={`duelResult ${duelResultVisible ? 'revealed' : 'pending'}`} aria-live="assertive">
            {duelResultVisible ? (
              <>
                <strong>對決結果</strong>
                {duelPreview.map((line) => <p key={line}>{line}</p>)}
              </>
            ) : (
              <>
                <Swords className="duelPulse" size={22} aria-hidden="true" />
                <strong>對決中</strong>
                <p>操作已鎖定</p>
              </>
            )}
          </section>
        )}

        <PlayerRow
          player={bottomPlayer}
          state={state}
          match={match}
          online={online}
          seat={seat}
          coverOptions={coverOptions}
          isBottom
          isActionable={(card) => isCardActionable(card, state, online, playerSeat, match, connectionStatus, coverOptions)}
          onCardClick={onCardClick}
        />
      </section>

      <aside className="commandRail" aria-label="裁判控制台">
        <section className="turnPanel">
          <span className="sectionKicker">CURRENT PHASE</span>
          <div className="turnTitle">
            <span className={`turnEmblem player${state.currentTurn}`}>{state.currentTurn}</span>
            <div>
              <strong>{phaseTitle(state, match, seat)}</strong>
              <p>{phasePrompt(state, match, seat)}</p>
            </div>
          </div>
        </section>

        <section className="scorePanel" aria-label="存活牌數">
          <Score player="A" state={state} match={match} />
          <div className="scoreDivider" />
          <Score player="B" state={state} match={match} />
        </section>

        {state.gameStatus === 'finished' && (
          <section className="resultPanel">
            <Flag size={20} />
            <div>
              <span>對局結束</span>
              <strong>{state.winner ? `${playerName(state.winner, match)} 勝利` : '本局平手'}</strong>
              <div className="rematchVotes" aria-label="下一局同意狀態">
                {(['A', 'B'] as Player[]).map((player) => (
                  <span className={isRematchReady(state, player) ? 'ready' : ''} key={player}>
                    Player {player} · {isRematchReady(state, player) ? '已同意' : '等待確認'}
                  </span>
                ))}
              </div>
            </div>
          </section>
        )}

        {showDefenseContext && attacker && target && (
          <section className="defenseContext" aria-label="防守目標">
            <div className="defenseContextHeading">
              <span>防守確認</span>
              <strong>{playerName(attacker.owner, match)} 正在攻擊你的牌</strong>
            </div>
            <div className="defenseMatchup">
              <div className="contextCard attackerContext">
                <small>攻擊牌 · {cardReference(attacker)}</small>
                <strong>{cardDisplayName(attacker)}</strong>
              </div>
              <Swords className="defenseArrow" size={18} aria-hidden="true" />
              <div className="contextCard targetContext">
                <small>你的被攻擊牌 · {cardReference(target)}</small>
                <strong>{cardDisplayName(target)}</strong>
              </div>
            </div>
            <p>
              {phase === 'select-defense'
                ? '點選被攻擊牌代表直面，點選標示「可協防」的鄰牌代表協防。'
                : '攻防牌已選定，對決將自動結算。'}
            </p>
          </section>
        )}

        <section className={`controlSection attackSelection ${phase === 'select-attack' && canAttack ? 'active' : ''}`}>
          <span className="controlLabel">攻擊牌與目標</span>
          <p>
            {phase === 'select-attack'
              ? '可重選攻擊牌與目標，確認後才交給防守方。'
              : '攻方選擇已鎖定'}
          </p>
        </section>

        <section className={`controlSection defenseSelection ${canDefend ? 'active' : ''}`}>
          <span className="controlLabel">防守牌選擇</span>
          <p>
            {phase === 'select-defense'
              ? '可重選被攻擊牌或可協防的鄰牌，確認後才開始對決。'
              : state.defenseMode === 'face'
                ? '已選擇直面'
                : state.defenseMode === 'cover'
                  ? '已選擇協防牌'
                  : '等待防守方選牌'}
          </p>
        </section>

        <section className="battleActions railActions">
          {phase === 'select-attack' && (
            <button
              className="resolveButton"
              type="button"
              onClick={() => onAction({ type: 'confirmAttack' })}
              disabled={!state.selectedAttackerId || !state.selectedTargetId || !canAttack}
            >
              <Swords size={19} />
              確認攻擊
            </button>
          )}
          {phase === 'select-defense' && (
            <button
              className="resolveButton"
              type="button"
              onClick={() => onAction({ type: 'confirmDefense' })}
              disabled={state.defenseMode === 'none' || !canDefend}
            >
              <ShieldCheck size={19} />
              確認防守
            </button>
          )}
          <button
            type="button"
            onClick={() => onAction({ type: 'pass' })}
            disabled={phase !== 'select-attack' || !canAttack}
          >
            <SkipForward size={18} />
            Pass
          </button>
          <button
            type="button"
            onClick={() => onAction({ type: 'restart' })}
            disabled={phase !== 'finished' || !rematchPlayer || isRematchReady(state, rematchPlayer) || connectionStatus === 'reconnecting'}
          >
            <RotateCcw size={18} />
            {rematchPlayer && isRematchReady(state, rematchPlayer) ? '已同意，等待對手' : '同意再一局'}
          </button>
        </section>

        <section className="battleLog" aria-label="戰況紀錄">
          <div className="logHeading"><span>戰況</span><small>LIVE</small></div>
          <ol>
            {state.messages.map((message, index) => (
              <li key={`${message.text}-${index}`} className={message.kind}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <p>{message.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </main>
  );
}

type BattleActionsProps = {
  phase: ReturnType<typeof getBattlePhase>;
  state: BattleState;
  canAttack: boolean;
  canDefend: boolean;
  rematchPlayer: Player | null;
  connectionStatus: ConnectionStatus;
  onAction(action: BattleAction): void;
};

function BattleActions({
  phase,
  state,
  canAttack,
  canDefend,
  rematchPlayer,
  connectionStatus,
  onAction,
}: BattleActionsProps) {
  return (
    <section className="battleActions centerActions" aria-label="戰鬥操作">
      {phase === 'select-attack' && (
        <button
          className="resolveButton"
          type="button"
          onClick={() => onAction({ type: 'confirmAttack' })}
          disabled={!state.selectedAttackerId || !state.selectedTargetId || !canAttack}
        >
          <Swords size={19} />
          確認攻擊
        </button>
      )}
      {phase === 'select-defense' && (
        <button
          className="resolveButton"
          type="button"
          onClick={() => onAction({ type: 'confirmDefense' })}
          disabled={state.defenseMode === 'none' || !canDefend}
        >
          <ShieldCheck size={19} />
          確認防守
        </button>
      )}
      <button
        type="button"
        onClick={() => onAction({ type: 'pass' })}
        disabled={phase !== 'select-attack' || !canAttack}
      >
        <SkipForward size={18} />
        略過
      </button>
      <button
        type="button"
        onClick={() => onAction({ type: 'restart' })}
        disabled={phase !== 'finished' || !rematchPlayer || isRematchReady(state, rematchPlayer) || connectionStatus === 'reconnecting'}
      >
        <RotateCcw size={18} />
        {rematchPlayer && isRematchReady(state, rematchPlayer) ? '已同意，等待對手' : '同意再一局'}
      </button>
    </section>
  );
}

type PlayerRowProps = {
  player: Player;
  state: BattleState;
  match: MatchSummary | null;
  online: boolean;
  seat: PlayerSeat | 'spectator' | null;
  coverOptions: Set<string>;
  isBottom: boolean;
  isActionable(card: BattleCard): boolean;
  onCardClick(card: BattleCard): void;
};

function PlayerRow({ player, state, match, online, seat, coverOptions, isBottom, isActionable, onCardClick }: PlayerRowProps) {
  const cards = state.cards.filter((card) => card.owner === player).sort((left, right) => left.slot - right.slot);
  const isYou = online ? seat === player : state.localPlayer === player;

  return (
    <section className={`playerZone player${player} ${isBottom ? 'bottom' : 'top'}`} aria-label={playerName(player, match)}>
      <div className="playerZoneHeader">
        <div className="playerIdentity">
          <span className={`playerMark player${player}`}>{player}</span>
          <div>
            <strong>{playerName(player, match)}</strong>
            <small>{isYou ? '你的牌組' : online && seat === 'spectator' ? `Player ${player}` : '對手牌組'}</small>
          </div>
        </div>
        {online && match && <span className="presenceLabel"><i className={match.presence[player] ? 'online' : ''} />{match.presence[player] ? '在線' : '離線'}</span>}
      </div>
      <div className="cardLine">
        {cards.map((card) => (
          <BattleCardButton
            key={card.id}
            card={card}
            faceVisible={isFaceVisible(card, state, online, seat)}
            state={state}
            coverOptions={coverOptions}
            actionable={isActionable(card)}
            onClick={() => onCardClick(card)}
          />
        ))}
      </div>
    </section>
  );
}

type BattleCardButtonProps = {
  card: BattleCard;
  faceVisible: boolean;
  state: BattleState;
  coverOptions: Set<string>;
  actionable: boolean;
  onClick(): void;
};

function BattleCardButton({ card, faceVisible, state, coverOptions, actionable, onClick }: BattleCardButtonProps) {
  const classes = ['battleCard', `owner${card.owner}`];
  if (!faceVisible) classes.push('cardBack');
  if (faceVisible) classes.push('cardFace');
  if (card.revealed && faceVisible) classes.push('revealed');
  if (!card.alive) classes.push('defeated');
  if (actionable) classes.push('actionable');
  if (state.selectedAttackerId === card.id) classes.push('selectedAttacker');
  if (state.selectedTargetId === card.id) classes.push('selectedTarget');
  if (state.selectedCoverId === card.id) classes.push('selectedCover');
  if (coverOptions.has(card.id)) classes.push('coverOption');
  const roleLabel = state.selectedAttackerId === card.id
    ? '攻擊牌'
    : state.selectedTargetId === card.id
      ? '被攻擊牌'
      : state.selectedCoverId === card.id
        ? '協防牌'
        : coverOptions.has(card.id)
          ? '可協防'
        : null;

  return (
    <button
      type="button"
      className={classes.join(' ')}
      onClick={onClick}
      disabled={!card.alive || !actionable}
      aria-label={faceVisible ? `${cardDisplayName(card)}，${getCardLabel(card)}${roleLabel ? `，${roleLabel}` : ''}` : `${labelPlayer(card.owner)} 第 ${card.slot + 1} 張牌${roleLabel ? `，${roleLabel}` : ''}`}
    >
      <span className="cardIndex">{String(card.slot + 1).padStart(2, '0')}</span>
      {roleLabel && <span className={`cardRole ${roleLabel === '攻擊牌' ? 'attackerRole' : roleLabel === '被攻擊牌' ? 'targetRole' : 'coverRole'}`}>{roleLabel}</span>}
      {faceVisible ? (
        <>
          <CardArtwork card={card} className="cardFaceArtwork" />
          {card.revealed && card.alive && <span className="revealMark"><Eye size={11} />已揭露</span>}
        </>
      ) : (
        <>
          <span className="backMonogram">{card.owner}</span>
          <Layers3 className="backIcon" size={22} />
          <span className="cardMeta">{card.owner === 'A' ? 'BLUE DECK' : 'RED DECK'}</span>
        </>
      )}
      {!card.alive && <span className="defeatedMark">退場</span>}
    </button>
  );
}

function Score({ player, state, match }: { player: Player; state: BattleState; match: MatchSummary | null }) {
  return (
    <div className="scoreItem">
      <span>Player {player}</span>
      <strong>{getAliveCards(state, player).length}<small>/ 7</small></strong>
      <p>{playerName(player, match)}</p>
    </div>
  );
}

function isFaceVisible(card: BattleCard, state: BattleState, online: boolean, seat: PlayerSeat | 'spectator' | null): boolean {
  if (card.revealed) return true;
  if (online) return seat === card.owner;
  return state.localPlayer === card.owner;
}

function cardReference(card: BattleCard): string {
  return `第 ${card.slot + 1} 張`;
}

function cardDisplayName(card: BattleCard): string {
  return card.name === '未知' ? `${cardReference(card)}牌` : card.name;
}

function isCardActionable(
  card: BattleCard,
  state: BattleState,
  online: boolean,
  seat: PlayerSeat | null,
  match: MatchSummary | null,
  connectionStatus: ConnectionStatus,
  coverOptions: Set<string>,
): boolean {
  if (!card.alive || state.gameStatus === 'finished') return false;
  if (online && (match?.status !== 'playing' || connectionStatus !== 'online' || !seat)) return false;

  const phase = getBattlePhase(state);
  const attackerCanAct = !online || seat === state.currentTurn;
  const defenderCanAct = !online || seat === otherPlayer(state.currentTurn);

  if (phase === 'select-attack') {
    if (card.owner === state.currentTurn) return attackerCanAct && card.kind !== 'trap';
    return attackerCanAct && Boolean(state.selectedAttackerId);
  }
  if (phase === 'select-defense') {
    return defenderCanAct && (card.id === state.selectedTargetId || coverOptions.has(card.id));
  }
  return false;
}

function CardArtwork({ card, className }: { card: BattleCard; className: string }) {
  return <img className={className} src={getCardArtworkUrl(card)} alt="" draggable={false} aria-hidden="true" />;
}

function playerName(player: Player, match: MatchSummary | null): string {
  return match?.players[player]?.name ?? labelPlayer(player);
}

function phaseTitle(state: BattleState, match: MatchSummary | null, seat: PlayerSeat | 'spectator' | null): string {
  if (match?.status === 'waiting') return '等待對手加入';
  if (seat === 'spectator') return '觀戰模式';
  if (state.gameStatus === 'finished') return state.winner ? `${playerName(state.winner, match)} 勝利` : '本局平手';
  return `${playerName(state.currentTurn, match)} 的回合`;
}

function phasePrompt(state: BattleState, match: MatchSummary | null, seat: PlayerSeat | 'spectator' | null): string {
  if (match?.status === 'waiting') return '房間代碼可邀請另一位玩家';
  if (seat === 'spectator') return '雙方操作會即時同步';
  const phase = getBattlePhase(state);
  if (phase === 'select-attack') return '選擇攻擊牌與目標，確認後交給防守方';
  if (phase === 'select-defense') return `${playerName(otherPlayer(state.currentTurn), match)} 選擇防守牌`;
  if (phase === 'duel') return '四秒交鋒後顯示結果三秒，期間操作鎖定';

  const rematchPlayer = seat === 'A' || seat === 'B' ? seat : match ? null : state.localPlayer;
  if (!rematchPlayer) return '等待雙方玩家同意下一局';
  if (isRematchReady(state, rematchPlayer)) return '你已同意，等待另一位玩家確認';
  if (isRematchReady(state, otherPlayer(rematchPlayer))) return '對手已同意，等你確認後開始';
  return '雙方都同意後才會開始下一局';
}

function connectionLabel(status: ConnectionStatus): string {
  const labels: Record<ConnectionStatus, string> = {
    offline: '離線',
    connecting: '連線中',
    online: '已連線',
    reconnecting: '重新連線',
    closed: '已關閉',
    error: '連線異常',
  };
  return labels[status];
}
