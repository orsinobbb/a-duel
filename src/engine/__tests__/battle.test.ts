import { describe, expect, it } from 'vitest';
import {
  BattleState,
  DEFAULT_DECK_ORDER,
  DUEL_ANIMATION_MS,
  DUEL_DURATION_MS,
  DUEL_RESULT_REVEAL_MS,
  canResolve,
  confirmAttack,
  confirmDefense,
  confirmRematch,
  createInitialState,
  forfeitBattle,
  getBattlePhase,
  getCoverOptions,
  isValidDeckOrder,
  passTurn,
  resolveBattle,
  restartBattle,
  selectAttacker,
  selectDefenseCard,
  selectTarget,
  setPlayerDeckOrder,
} from '../battle';

function prepareDuel(attackerId: string, targetId: string, defenseId = targetId): BattleState {
  let state = createInitialState();
  state = selectAttacker(state, attackerId);
  state = selectTarget(state, targetId);
  state = confirmAttack(state);
  state = selectDefenseCard(state, defenseId);
  return confirmDefense(state, 0);
}

describe('battle engine', () => {
  it('removes both cards when equal ranks clash face to face', () => {
    const outcome = resolveBattle(prepareDuel('A-2', 'B-2'));

    expect(outcome.state.cards.find((card) => card.id === 'A-2')?.alive).toBe(false);
    expect(outcome.state.cards.find((card) => card.id === 'B-2')?.alive).toBe(false);
    expect(outcome.lines[2]).toContain('同歸於盡');
  });

  it('finishes the game when one side has no battle-ready cards', () => {
    const state: BattleState = {
      ...createInitialState(),
      cards: [
        { id: 'A-0', owner: 'A', slot: 0, name: '公爵', kind: 'rank', rank: 5, alive: true, revealed: false },
        { id: 'B-0', owner: 'B', slot: 0, name: '子爵', kind: 'rank', rank: 2, alive: true, revealed: false },
      ],
    };

    let next = selectAttacker(state, 'A-0');
    next = selectTarget(next, 'B-0');
    next = confirmAttack(next);
    next = selectDefenseCard(next, next.selectedTargetId!);
    next = confirmDefense(next, 0);

    const outcome = resolveBattle(next);

    expect(outcome.state.gameStatus).toBe('finished');
    expect(outcome.state.winner).toBe('A');
    expect(outcome.lines[outcome.lines.length - 1]).toBe('Player A 獲勝');
  });

  it('blocks actions after the game is finished until restart', () => {
    const finished: BattleState = {
      ...createInitialState(),
      gameStatus: 'finished',
      winner: 'A',
    };

    const blocked = passTurn(finished);
    expect(blocked.currentTurn).toBe('A');
    expect(blocked.messages[0].text).toContain('遊戲已結束');

    const restarted = restartBattle(blocked);
    expect(restarted.gameStatus).toBe('playing');
    expect(restarted.winner).toBeNull();
  });

  it('holds the result for five seconds after the four-second duel animation', () => {
    expect(DUEL_ANIMATION_MS).toBe(4000);
    expect(DUEL_RESULT_REVEAL_MS).toBe(5000);
    expect(DUEL_DURATION_MS).toBe(9000);
  });

  it('starts a rematch only after both players agree', () => {
    const finished: BattleState = {
      ...createInitialState(),
      gameStatus: 'finished',
      winner: 'A',
    };

    const playerAReady = confirmRematch(finished, 'A');
    expect(playerAReady.gameStatus).toBe('finished');
    expect(playerAReady.rematchReady).toEqual({ A: true, B: false });

    const restarted = confirmRematch(playerAReady, 'B');
    expect(restarted.gameStatus).toBe('playing');
    expect(restarted.winner).toBeNull();
    expect(restarted.rematchReady).toEqual({ A: false, B: false });
  });

  it('skips defeated cards when finding adjacent cover options', () => {
    const state: BattleState = {
      ...createInitialState(),
      selectedTargetId: 'B-2',
      cards: createInitialState().cards.map((card) =>
        card.id === 'B-1' || card.id === 'B-3' ? { ...card, alive: false } : card,
      ),
    };

    expect(getCoverOptions(state).map((card) => card.id)).toEqual(['B-0', 'B-4']);
  });

  it('does not skip over a trap to find a cover card two slots away', () => {
    const state: BattleState = {
      ...createInitialState(),
      selectedTargetId: 'B-1',
      cards: createInitialState().cards.map((card) =>
        card.id === 'B-2' ? { ...card, name: '陷阱', kind: 'trap', rank: null } : card,
      ),
    };

    expect(getCoverOptions(state).map((card) => card.id)).toEqual(['B-0']);
  });

  it('lets knight beat duke as the rank exception', () => {
    const outcome = resolveBattle(prepareDuel('A-4', 'B-0'));

    expect(outcome.state.cards.find((card) => card.id === 'A-4')?.alive).toBe(true);
    expect(outcome.state.cards.find((card) => card.id === 'B-0')?.alive).toBe(false);
  });

  it('removes both cards when an explosive attacks', () => {
    const outcome = resolveBattle(prepareDuel('A-5', 'B-0'));

    expect(outcome.state.cards.find((card) => card.id === 'A-5')?.alive).toBe(false);
    expect(outcome.state.cards.find((card) => card.id === 'B-0')?.alive).toBe(false);
    expect(outcome.lines[2]).toContain('同歸於盡');
  });

  it('removes both cards when an explosive is attacked', () => {
    const outcome = resolveBattle(prepareDuel('A-0', 'B-5'));

    expect(outcome.state.cards.find((card) => card.id === 'A-0')?.alive).toBe(false);
    expect(outcome.state.cards.find((card) => card.id === 'B-5')?.alive).toBe(false);
    expect(outcome.lines[2]).toContain('同歸於盡');
  });

  it('prevents traps from attacking or covering', () => {
    let state = createInitialState();
    state = selectAttacker(state, 'A-6');

    expect(state.selectedAttackerId).toBeNull();
    expect(state.messages[0].text).toContain('陷阱不能主動攻擊');

    const coverState: BattleState = {
      ...createInitialState(),
      selectedTargetId: 'B-5',
    };

    expect(getCoverOptions(coverState).map((card) => card.id)).toEqual(['B-4']);
  });

  it('triggers traps when they are attacked', () => {
    const outcome = resolveBattle(prepareDuel('A-0', 'B-6'));

    expect(outcome.state.cards.find((card) => card.id === 'A-0')?.alive).toBe(false);
    expect(outcome.state.cards.find((card) => card.id === 'B-6')?.alive).toBe(false);
    expect(outcome.lines[2]).toContain('觸發');
  });

  it('keeps surviving battle participants revealed after face defense', () => {
    const outcome = resolveBattle(prepareDuel('A-0', 'B-1'));

    expect(outcome.state.cards.find((card) => card.id === 'A-0')?.revealed).toBe(true);
    expect(outcome.state.cards.find((card) => card.id === 'B-1')?.revealed).toBe(false);
  });

  it('reveals the surviving cover card but not the covered target', () => {
    const outcome = resolveBattle(prepareDuel('A-3', 'B-2', 'B-1'));

    expect(outcome.state.cards.find((card) => card.id === 'B-2')?.revealed).toBe(false);
    expect(outcome.state.cards.find((card) => card.id === 'B-1')?.revealed).toBe(true);
  });

  it('keeps selections editable until each player confirms their phase', () => {
    let state = createInitialState();
    expect(getBattlePhase(state)).toBe('select-attack');
    state = selectAttacker(state, 'A-0');
    state = selectTarget(state, 'B-0');
    state = selectAttacker(state, 'A-1');
    state = selectTarget(state, 'B-1');
    expect(state.selectedAttackerId).toBe('A-1');
    expect(state.selectedTargetId).toBe('B-1');
    expect(getBattlePhase(state)).toBe('select-attack');
    state = confirmAttack(state);
    expect(getBattlePhase(state)).toBe('select-defense');
    state = selectDefenseCard(state, 'B-1');
    state = selectDefenseCard(state, 'B-0');
    expect(state.selectedCoverId).toBe('B-0');
    state = confirmDefense(state, 1000);
    expect(getBattlePhase(state)).toBe('duel');
    expect(canResolve(state, 9999)).toBe(false);
    expect(canResolve(state, 10000)).toBe(true);
  });

  it('locks attack selections after the attacker confirms', () => {
    let state = createInitialState();
    state = selectAttacker(state, 'A-0');
    state = selectTarget(state, 'B-0');
    state = confirmAttack(state);

    expect(selectAttacker(state, 'A-1').messages[0].text).toContain('攻擊牌已鎖定');
    expect(selectTarget(state, 'B-1').messages[0].text).toContain('攻擊目標已鎖定');
  });

  it('defaults the defender to face the attacked card', () => {
    let state = createInitialState();
    state = selectAttacker(state, 'A-0');
    state = selectTarget(state, 'B-0');
    state = confirmAttack(state);

    expect(state.defenseMode).toBe('face');
    expect(state.selectedCoverId).toBeNull();
    expect(getBattlePhase(state)).toBe('select-defense');
  });

  it('ends the game when a player only has traps remaining', () => {
    const initial = createInitialState();
    const state: BattleState = {
      ...initial,
      cards: initial.cards
        .filter((card) => ['A-0', 'A-1', 'B-0', 'B-6'].includes(card.id)),
    };

    let next = selectAttacker(state, 'A-0');
    next = selectTarget(next, 'B-0');
    next = confirmAttack(next);
    next = selectDefenseCard(next, 'B-0');
    next = confirmDefense(next, 0);
    const outcome = resolveBattle(next);

    expect(outcome.state.gameStatus).toBe('finished');
    expect(outcome.state.winner).toBe('A');
  });

  it('shuffles card positions without leaking the original roster order through ids', () => {
    const state = createInitialState('A', true, () => 0);
    const playerA = state.cards.filter((card) => card.owner === 'A');

    expect(playerA.map((card) => card.name)).not.toEqual(['公爵', '侯爵', '伯爵', '子爵', '騎士', '炸藥', '陷阱']);
    expect(playerA.map((card) => card.id)).toEqual(['A-0', 'A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6']);
  });

  it('creates a player deck in the requested order', () => {
    const order = ['trap', 'rank1', 'explosive', 'rank2', 'rank3', 'rank4', 'rank5'] as const;
    const state = createInitialState('A', true, () => 0, { A: order });
    const playerA = state.cards.filter((card) => card.owner === 'A').sort((left, right) => left.slot - right.slot);

    expect(playerA.map((card) => card.name)).toEqual(['陷阱', '騎士', '炸藥', '子爵', '伯爵', '侯爵', '公爵']);
    expect(state.deckOrders.A).toEqual(order);
  });

  it('validates and applies a complete deck order without duplicates', () => {
    const order = [...DEFAULT_DECK_ORDER].reverse();
    const initial = createInitialState();
    const arranged = setPlayerDeckOrder(initial, 'B', order);

    expect(isValidDeckOrder(order)).toBe(true);
    expect(isValidDeckOrder([...order.slice(0, -1), order[0]])).toBe(false);
    expect(arranged.deckOrders.B).toEqual(order);
    expect(arranged.cards.filter((card) => card.owner === 'B').map((card) => card.name)).toEqual([
      '陷阱',
      '炸藥',
      '騎士',
      '子爵',
      '伯爵',
      '侯爵',
      '公爵',
    ]);
  });

  it('finishes the battle when a player forfeits', () => {
    const state = forfeitBattle(createInitialState(), 'A');

    expect(state.gameStatus).toBe('finished');
    expect(state.winner).toBe('B');
    expect(state.messages[0].text).toContain('投降');
  });
});
