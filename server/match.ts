import {
  BattleState,
  confirmRematch,
  confirmAttack,
  confirmDefense,
  getBattlePhase,
  otherPlayer,
  passTurn,
  resolveBattle,
  selectDefenseCard,
  selectAttacker,
  selectTarget,
} from '../src/engine/battle';
import type { BattleAction, MatchLifecycle, PlayerSeat } from '../src/shared/protocol';
import type { MatchRecord } from './protocol';

export type ActionResult =
  | { ok: true; state: BattleState }
  | { ok: false; error: string };

export function applyAuthorizedAction(state: BattleState, action: BattleAction, seat: PlayerSeat): ActionResult {
  const phase = getBattlePhase(state);

  if (action.type === 'restart') {
    if (phase !== 'finished') return { ok: false, error: 'game_in_progress' };
    return { ok: true, state: confirmRematch(state, seat, true) };
  }

  if (phase === 'finished') return { ok: false, error: 'game_finished' };

  const attacker = state.currentTurn;
  const defender = otherPlayer(attacker);
  const requiredSeat = action.type === 'selectDefenseCard' || action.type === 'confirmDefense' ? defender : attacker;
  if (seat !== requiredSeat) return { ok: false, error: 'not_your_action' };

  if (!isActionAllowedInPhase(action.type, phase)) {
    return { ok: false, error: 'action_not_allowed' };
  }

  return { ok: true, state: applyBattleAction(state, action) };
}

export function getMatchLifecycle(match: MatchRecord): MatchLifecycle {
  if (!match.players.A || !match.players.B) return 'waiting';
  return match.state.gameStatus === 'finished' ? 'finished' : 'playing';
}

export function isBattleAction(value: unknown): value is BattleAction {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  const action = value as Record<string, unknown>;

  if (action.type === 'confirmAttack' || action.type === 'confirmDefense' || action.type === 'resolve' || action.type === 'pass' || action.type === 'restart') return true;
  if (action.type === 'selectAttacker' || action.type === 'selectTarget' || action.type === 'selectDefenseCard') {
    return typeof action.cardId === 'string' && action.cardId.length > 0 && action.cardId.length <= 32;
  }
  return false;
}

function isActionAllowedInPhase(action: BattleAction['type'], phase: ReturnType<typeof getBattlePhase>): boolean {
  switch (action) {
    case 'selectAttacker':
      return phase === 'select-attack';
    case 'selectTarget':
      return phase === 'select-attack';
    case 'confirmAttack':
      return phase === 'select-attack';
    case 'selectDefenseCard':
      return phase === 'select-defense';
    case 'confirmDefense':
      return phase === 'select-defense';
    case 'resolve':
      return phase === 'duel';
    case 'pass':
      return phase === 'select-attack';
    case 'restart':
      return phase === 'finished';
  }
}

function applyBattleAction(state: BattleState, action: BattleAction): BattleState {
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
      return confirmRematch(state, state.localPlayer, true);
  }
}
