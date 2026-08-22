import { describe, expect, it } from 'vitest';
import { confirmAttack, confirmDefense, createInitialState, selectAttacker, selectDefenseCard, selectTarget } from '../../src/engine/battle';
import { applyAuthorizedAction, getMatchLifecycle, isBattleAction } from '../match';
import type { MatchRecord } from '../protocol';

describe('online match rules', () => {
  it('only lets the active player select an attacker', () => {
    const state = createInitialState();

    expect(applyAuthorizedAction(state, { type: 'selectAttacker', cardId: 'A-0' }, 'B')).toEqual({
      ok: false,
      error: 'not_your_action',
    });
    expect(applyAuthorizedAction(state, { type: 'selectAttacker', cardId: 'A-0' }, 'A').ok).toBe(true);
  });

  it('hands defense decisions to the defending player', () => {
    let state = createInitialState();
    state = selectAttacker(state, 'A-0');
    state = selectTarget(state, 'B-0');
    state = confirmAttack(state);

    expect(applyAuthorizedAction(state, { type: 'selectDefenseCard', cardId: 'B-0' }, 'A')).toEqual({
      ok: false,
      error: 'not_your_action',
    });
    expect(applyAuthorizedAction(state, { type: 'selectDefenseCard', cardId: 'B-0' }, 'B').ok).toBe(true);
  });

  it('lets the attacker revise selections until attack confirmation', () => {
    let state = createInitialState();
    state = selectAttacker(state, 'A-0');
    state = selectTarget(state, 'B-0');

    expect(applyAuthorizedAction(state, { type: 'selectTarget', cardId: 'B-1' }, 'A').ok).toBe(true);
    expect(applyAuthorizedAction(state, { type: 'confirmAttack' }, 'B')).toEqual({
      ok: false,
      error: 'not_your_action',
    });

    state = confirmAttack(state);

    expect(applyAuthorizedAction(state, { type: 'selectTarget', cardId: 'B-1' }, 'A')).toEqual({
      ok: false,
      error: 'action_not_allowed',
    });
    expect(applyAuthorizedAction(state, { type: 'selectDefenseCard', cardId: 'B-0' }, 'B').ok).toBe(true);
  });

  it('blocks resolution until defense is complete', () => {
    let state = createInitialState();
    state = selectAttacker(state, 'A-0');
    state = selectTarget(state, 'B-0');
    state = confirmAttack(state);

    expect(applyAuthorizedAction(state, { type: 'resolve' }, 'A')).toEqual({
      ok: false,
      error: 'action_not_allowed',
    });

    state = selectDefenseCard(state, state.selectedTargetId!);
    state = confirmDefense(state, 0);
    expect(applyAuthorizedAction(state, { type: 'resolve' }, 'A').ok).toBe(true);
  });

  it('derives waiting, playing and finished room states', () => {
    const match: MatchRecord = {
      id: 'ABC234',
      state: createInitialState(),
      players: { A: { userId: 'a', name: 'A' }, B: null },
      createdAt: 1,
      updatedAt: 1,
    };

    expect(getMatchLifecycle(match)).toBe('waiting');
    match.players.B = { userId: 'b', name: 'B' };
    expect(getMatchLifecycle(match)).toBe('playing');
    match.state = { ...match.state, gameStatus: 'finished', winner: 'A' };
    expect(getMatchLifecycle(match)).toBe('finished');
  });

  it('requires both seats to approve a rematch', () => {
    const finished = {
      ...createInitialState(),
      gameStatus: 'finished' as const,
      winner: 'A' as const,
    };

    const firstVote = applyAuthorizedAction(finished, { type: 'restart' }, 'A');
    expect(firstVote.ok).toBe(true);
    if (!firstVote.ok) return;
    expect(firstVote.state.gameStatus).toBe('finished');
    expect(firstVote.state.rematchReady).toEqual({ A: true, B: false });

    const secondVote = applyAuthorizedAction(firstVote.state, { type: 'restart' }, 'B');
    expect(secondVote.ok).toBe(true);
    if (!secondVote.ok) return;
    expect(secondVote.state.gameStatus).toBe('playing');
    expect(secondVote.state.rematchReady).toEqual({ A: false, B: false });
  });

  it('rejects malformed actions at the socket boundary', () => {
    expect(isBattleAction({ type: 'selectTarget', cardId: '' })).toBe(false);
    expect(isBattleAction({ type: 'selectDefenseCard', cardId: '' })).toBe(false);
    expect(isBattleAction({ type: 'confirmAttack' })).toBe(true);
    expect(isBattleAction({ type: 'confirmDefense' })).toBe(true);
    expect(isBattleAction({ type: 'pass' })).toBe(true);
  });
});
