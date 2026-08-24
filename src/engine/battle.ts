export type Player = 'A' | 'B';
export type GameStatus = 'playing' | 'finished';
export type DefenseMode = 'none' | 'face' | 'cover';
export type MessageKind = 'info' | 'warn' | 'error';
export type CardKind = 'rank' | 'explosive' | 'trap';
export type BattlePhase = 'select-attack' | 'select-defense' | 'duel' | 'finished';

export const DUEL_ANIMATION_MS = 4000;
export const DUEL_RESULT_REVEAL_MS = 5000;
export const DUEL_DURATION_MS = DUEL_ANIMATION_MS + DUEL_RESULT_REVEAL_MS;

export type BattleCard = {
  id: string;
  owner: Player;
  slot: number;
  name: string;
  kind: CardKind;
  rank: number | null;
  alive: boolean;
  revealed: boolean;
};

export type BattleMessage = {
  kind: MessageKind;
  text: string;
};

export type BattleState = {
  cards: BattleCard[];
  currentTurn: Player;
  localPlayer: Player;
  selectedAttackerId: string | null;
  selectedTargetId: string | null;
  attackConfirmed: boolean;
  defenseMode: DefenseMode;
  selectedCoverId: string | null;
  defenseConfirmed: boolean;
  duelStartedAt: number | null;
  messages: BattleMessage[];
  gameStatus: GameStatus;
  winner: Player | null;
  rematchReady: Record<Player, boolean>;
};

export type ResolveOutcome = {
  state: BattleState;
  lines: string[];
};

const roster: Array<Omit<BattleCard, 'id' | 'owner' | 'slot' | 'alive' | 'revealed'>> = [
  { name: '公爵', kind: 'rank', rank: 5 },
  { name: '侯爵', kind: 'rank', rank: 4 },
  { name: '伯爵', kind: 'rank', rank: 3 },
  { name: '子爵', kind: 'rank', rank: 2 },
  { name: '騎士', kind: 'rank', rank: 1 },
  { name: '炸藥', kind: 'explosive', rank: null },
  { name: '陷阱', kind: 'trap', rank: null },
];

export function otherPlayer(player: Player): Player {
  return player === 'A' ? 'B' : 'A';
}

export function createInitialState(localPlayer: Player = 'A', shuffle = false, random: () => number = Math.random): BattleState {
  const rosterA = shuffle ? shuffleRoster(roster, random) : roster;
  const rosterB = shuffle ? shuffleRoster(roster, random) : roster;

  return {
    cards: [
      ...rosterA.map((card, index) => makeCard('A', index, card)),
      ...rosterB.map((card, index) => makeCard('B', index, card)),
    ],
    currentTurn: 'A',
    localPlayer,
    selectedAttackerId: null,
    selectedTargetId: null,
    attackConfirmed: false,
    defenseMode: 'none',
    selectedCoverId: null,
    defenseConfirmed: false,
    duelStartedAt: null,
    messages: [{ kind: 'info', text: 'Player A 選擇攻擊牌' }],
    gameStatus: 'playing',
    winner: null,
    rematchReady: { A: false, B: false },
  };
}

export function selectAttacker(state: BattleState, cardId: string): BattleState {
  const blocked = blockIfFinished(state);
  if (blocked) return blocked;
  if (getBattlePhase(state) !== 'select-attack') {
    return addMessage(state, 'warn', '攻擊牌已鎖定，請等待防守方操作');
  }

  const card = findCard(state, cardId);
  if (!card || !card.alive || card.owner !== state.currentTurn) {
    return addMessage(state, 'error', '只能選擇當前回合玩家的可戰鬥牌');
  }

  if (card.kind === 'trap') {
    return addMessage(state, 'error', '陷阱不能主動攻擊');
  }

  return {
    ...state,
    selectedAttackerId: cardId,
    defenseMode: 'none',
    selectedCoverId: null,
    defenseConfirmed: false,
    duelStartedAt: null,
    messages: [{ kind: 'info', text: `${labelPlayer(state.currentTurn)} 已選擇攻擊牌，請選擇攻擊目標` }],
  };
}

export function selectTarget(state: BattleState, cardId: string): BattleState {
  const blocked = blockIfFinished(state);
  if (blocked) return blocked;
  if (getBattlePhase(state) !== 'select-attack') {
    return addMessage(state, 'warn', '攻擊目標已鎖定，請由防守方選擇防禦方式');
  }

  if (!state.selectedAttackerId) {
    return addMessage(state, 'warn', '尚未選擇攻擊牌');
  }

  const card = findCard(state, cardId);
  if (!card || !card.alive || card.owner === state.currentTurn) {
    return addMessage(state, 'error', '只能選擇對手的可戰鬥牌作為目標');
  }

  return {
    ...state,
    selectedTargetId: cardId,
    defenseMode: 'none',
    selectedCoverId: null,
    defenseConfirmed: false,
    duelStartedAt: null,
    messages: [{ kind: 'info', text: `${labelPlayer(card.owner)} 選擇直面或鄰牌掩護` }],
  };
}

export function confirmAttack(state: BattleState): BattleState {
  const blocked = blockIfFinished(state);
  if (blocked) return blocked;
  if (getBattlePhase(state) !== 'select-attack') {
    return addMessage(state, 'warn', '攻擊階段已確認，等待防守方選牌');
  }

  const attacker = findCard(state, state.selectedAttackerId);
  const target = findCard(state, state.selectedTargetId);
  if (!attacker || !attacker.alive || attacker.owner !== state.currentTurn || attacker.kind === 'trap') {
    return addMessage(state, 'warn', '請先選擇可攻擊的牌');
  }
  if (!target || !target.alive || target.owner === state.currentTurn) {
    return addMessage(state, 'warn', '請先選擇對手的一張存活牌');
  }

  return {
    ...state,
    attackConfirmed: true,
    defenseMode: 'face',
    selectedCoverId: null,
    defenseConfirmed: false,
    duelStartedAt: null,
    messages: [{ kind: 'info', text: `${labelPlayer(target.owner)} 請選擇直面或協防牌` }],
  };
}

export function selectDefenseCard(state: BattleState, cardId: string): BattleState {
  const blocked = blockIfFinished(state);
  if (blocked) return blocked;
  if (getBattlePhase(state) !== 'select-defense') {
    return addMessage(state, 'warn', '防禦牌已鎖定，請確認目前的戰鬥');
  }

  const target = findCard(state, state.selectedTargetId);
  if (!target || !target.alive) {
    return addMessage(state, 'warn', '尚未選擇攻擊目標');
  }

  if (cardId === target.id) {
  return {
    ...state,
    defenseMode: 'face',
    selectedCoverId: null,
    defenseConfirmed: false,
    duelStartedAt: null,
      messages: [{ kind: 'info', text: '防守方選擇直面承受，可繼續更換或確認防守' }],
    };
  }

  const cover = getCoverOptions(state).find((card) => card.id === cardId);
  if (!cover) return addMessage(state, 'error', '只能選擇被攻擊牌或可協防的鄰牌');

  return {
    ...state,
    defenseMode: 'cover',
    selectedCoverId: cardId,
    defenseConfirmed: false,
    duelStartedAt: null,
    messages: [{ kind: 'info', text: `${labelPlayer(cover.owner)} 已選擇鄰牌協防，可繼續更換或確認防守` }],
  };
}

export function confirmDefense(state: BattleState, now = Date.now()): BattleState {
  const blocked = blockIfFinished(state);
  if (blocked) return blocked;
  if (getBattlePhase(state) !== 'select-defense') {
    return addMessage(state, 'warn', '防守階段已確認，正在對決');
  }
  if (state.defenseMode === 'none') {
    return addMessage(state, 'warn', '請先選擇直面或協防牌');
  }
  if (state.defenseMode === 'cover' && !state.selectedCoverId) {
    return addMessage(state, 'warn', '請先選擇協防牌');
  }

  return {
    ...state,
    defenseConfirmed: true,
    duelStartedAt: now,
    messages: [{ kind: 'info', text: '攻防牌已鎖定，對決即將開始' }],
  };
}

export function passTurn(state: BattleState): BattleState {
  const blocked = blockIfFinished(state);
  if (blocked) return blocked;

  const nextTurn = otherPlayer(state.currentTurn);
  return {
    ...clearSelections(state),
    currentTurn: nextTurn,
    messages: [{ kind: 'info', text: `Pass，回合交給 ${labelPlayer(nextTurn)}` }],
  };
}

export function resolveBattle(state: BattleState): ResolveOutcome {
  const blocked = blockIfFinished(state);
  if (blocked) return { state: blocked, lines: blocked.messages.map((message) => message.text) };

  if (getBattlePhase(state) !== 'duel' || !canResolve(state)) {
    const next = addMessage(state, 'warn', '對決尚未完成，系統會自動結算');
    return { state: next, lines: next.messages.map((message) => message.text) };
  }

  const attacker = findCard(state, state.selectedAttackerId);
  const target = findCard(state, state.selectedTargetId);

  if (!attacker || !attacker.alive) {
    const next = addMessage(state, 'warn', '尚未選擇攻擊牌');
    return { state: next, lines: next.messages.map((message) => message.text) };
  }

  if (!target || !target.alive) {
    const next = addMessage(state, 'warn', '尚未選擇攻擊目標');
    return { state: next, lines: next.messages.map((message) => message.text) };
  }

  if (state.defenseMode === 'none') {
    const next = addMessage(state, 'warn', '尚未選擇防守方式');
    return { state: next, lines: next.messages.map((message) => message.text) };
  }

  const defender = target.owner;
  const cover = state.defenseMode === 'cover' ? findCard(state, state.selectedCoverId) : null;

  if (state.defenseMode === 'cover' && (!cover || !cover.alive)) {
    const next = addMessage(state, 'warn', '尚未選擇掩護牌');
    return { state: next, lines: next.messages.map((message) => message.text) };
  }

  const battleTarget = cover ?? target;
  const result = resolveClash(attacker, battleTarget);
  let cards = state.cards.map((card) => ({ ...card }));
  cards = applyDeaths(cards, result.deadIds);
  cards = revealSurvivors(cards, [attacker.id, battleTarget.id]);

  const nextTurn = defender;
  let nextState: BattleState = {
    ...clearSelections({ ...state, cards }),
    currentTurn: nextTurn,
    messages: [],
  };
  nextState = applyEndState(nextState);

  const lines = [
    `${labelPlayer(attacker.owner)} 使用 ${attacker.name} 攻擊 ${labelPlayer(target.owner)} 的 ${target.name}`,
    cover ? `${labelPlayer(defender)} 使用 ${cover.name} 進行鄰牌掩護` : `${labelPlayer(defender)} 選擇直面承受`,
    result.text,
    nextState.gameStatus === 'finished'
      ? nextState.winner
        ? `${labelPlayer(nextState.winner)} 獲勝`
        : '雙方同歸於盡，本局平手'
      : `回合交給 ${labelPlayer(nextTurn)}`,
  ];

  nextState = {
    ...nextState,
    messages: lines.map((text) => ({ kind: 'info', text })),
  };

  return { state: nextState, lines };
}

export function restartBattle(state: BattleState, shuffle = false): BattleState {
  return {
    ...createInitialState(state.localPlayer, shuffle),
    messages: [{ kind: 'info', text: '重新開始一局，Player A 選擇攻擊牌' }],
  };
}

export function confirmRematch(state: BattleState, player: Player, shuffle = false): BattleState {
  if (state.gameStatus !== 'finished') {
    return addMessage(state, 'warn', '對局尚未結束，不能開始下一局');
  }

  const rematchReady = {
    A: state.rematchReady?.A ?? false,
    B: state.rematchReady?.B ?? false,
    [player]: true,
  };

  if (rematchReady.A && rematchReady.B) {
    return {
      ...restartBattle(state, shuffle),
      messages: [{ kind: 'info', text: '雙方已同意，開始新的一局' }],
    };
  }

  return {
    ...state,
    rematchReady,
    messages: [{ kind: 'info', text: `${labelPlayer(player)} 已同意再來一局，等待 ${labelPlayer(otherPlayer(player))}` }],
  };
}

export function isRematchReady(state: BattleState, player: Player): boolean {
  return state.rematchReady?.[player] ?? false;
}

export function forfeitBattle(state: BattleState, player: Player): BattleState {
  if (state.gameStatus === 'finished') return state;

  const winner = otherPlayer(player);
  return {
    ...clearSelections(state),
    gameStatus: 'finished',
    winner,
    rematchReady: { A: false, B: false },
    messages: [{ kind: 'warn', text: `${labelPlayer(player)} 已投降，${labelPlayer(winner)} 獲勝` }],
  };
}

export function switchLocalPlayer(state: BattleState): BattleState {
  return {
    ...state,
    localPlayer: otherPlayer(state.localPlayer),
  };
}

export function getAliveCards(state: BattleState, player: Player): BattleCard[] {
  return state.cards.filter((card) => card.owner === player && card.alive);
}

export function getBattlePhase(state: BattleState): BattlePhase {
  if (state.gameStatus === 'finished') return 'finished';
  if (!state.attackConfirmed) return 'select-attack';
  if (!state.defenseConfirmed) return 'select-defense';
  return 'duel';
}

export function getCoverOptions(state: BattleState): BattleCard[] {
  const target = findCard(state, state.selectedTargetId);
  if (!target || !target.alive) return [];

  const aliveCards = state.cards
    .filter((card) => card.owner === target.owner && card.alive && card.id !== target.id)
    .sort((a, b) => a.slot - b.slot);

  const left = aliveCards.filter((card) => card.slot < target.slot).pop();
  const right = aliveCards.find((card) => card.slot > target.slot);

  return [left, right]
    .filter((card): card is BattleCard => Boolean(card))
    .filter(canCover);
}

export function canResolve(state: BattleState, now = Date.now()): boolean {
  if (state.gameStatus === 'finished') return false;
  if (getBattlePhase(state) !== 'duel') return false;
  if (!state.selectedAttackerId || !state.selectedTargetId || state.defenseMode === 'none') return false;
  if (state.defenseMode === 'cover' && !state.selectedCoverId) return false;
  return state.duelStartedAt !== null && now >= state.duelStartedAt + DUEL_DURATION_MS;
}

export function getDuelPreview(state: BattleState): string[] {
  const attacker = findCard(state, state.selectedAttackerId);
  const target = findCard(state, state.selectedTargetId);
  if (!attacker || !target || state.defenseMode === 'none') return [];

  const cover = state.defenseMode === 'cover' ? findCard(state, state.selectedCoverId) : null;
  if (state.defenseMode === 'cover' && !cover) return [];

  const battleTarget = cover ?? target;
  const result = resolveClash(attacker, battleTarget);
  return [
    `${labelPlayer(attacker.owner)} ${attacker.name} 攻擊 ${labelPlayer(target.owner)} ${target.name}`,
    cover ? `${labelPlayer(target.owner)} 使用 ${cover.name} 協防` : `${labelPlayer(target.owner)} 直面承受`,
    result.text,
  ];
}

export function labelPlayer(player: Player): string {
  return `Player ${player}`;
}

export function getCardLabel(card: BattleCard): string {
  if (card.kind === 'rank') return `階級 ${card.rank}`;
  if (card.kind === 'explosive') return '特殊：攻擊後退場';
  return '特殊：被攻擊時觸發';
}

function makeCard(
  owner: Player,
  slot: number,
  card: Omit<BattleCard, 'id' | 'owner' | 'slot' | 'alive' | 'revealed'>,
): BattleCard {
  return {
    id: `${owner}-${slot}`,
    owner,
    slot,
    ...card,
    alive: true,
    revealed: false,
  };
}

function shuffleRoster<T>(items: readonly T[], random: () => number): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function findCard(state: BattleState, cardId: string | null): BattleCard | undefined {
  if (!cardId) return undefined;
  return state.cards.find((card) => card.id === cardId);
}

function resolveClash(attacker: BattleCard, defender: BattleCard): { deadIds: string[]; text: string } {
  if (defender.kind === 'trap') {
    return {
      deadIds: [attacker.id, defender.id],
      text: `${defender.name} 觸發，${attacker.name} 與 ${defender.name} 一起退場`,
    };
  }

  if (attacker.kind === 'trap') {
    return { deadIds: [attacker.id], text: `${attacker.name} 不能主動攻擊並退場` };
  }

  if (attacker.kind === 'explosive') {
    return {
      deadIds: [attacker.id, defender.id],
      text: `${attacker.name} 引爆，無視階級擊破 ${defender.name}，使用後退場`,
    };
  }

  if (defender.kind === 'explosive') {
    return { deadIds: [defender.id], text: `${defender.name} 被擊破` };
  }

  if (beats(attacker, defender)) {
    return { deadIds: [defender.id], text: `${defender.name} 被擊破` };
  }

  if (beats(defender, attacker)) {
    return { deadIds: [attacker.id], text: `${attacker.name} 攻勢失利並退場` };
  }

  return { deadIds: [attacker.id, defender.id], text: `${attacker.name} 與 ${defender.name} 同歸於盡，雙方退場` };
}

function beats(attacker: BattleCard, defender: BattleCard): boolean {
  if (attacker.kind !== 'rank' || defender.kind !== 'rank') return false;
  if (attacker.name === '騎士' && defender.name === '公爵') return true;
  if (attacker.name === '公爵' && defender.name === '騎士') return false;
  return attacker.rank! > defender.rank!;
}

function canCover(card: BattleCard): boolean {
  return card.kind !== 'trap';
}

function applyDeaths(cards: BattleCard[], deadIds: string[]): BattleCard[] {
  const dead = new Set(deadIds);
  return cards.map((card) => (dead.has(card.id) ? { ...card, alive: false } : card));
}

function revealSurvivors(cards: BattleCard[], participantIds: string[]): BattleCard[] {
  const participants = new Set(participantIds);
  return cards.map((card) => (participants.has(card.id) && card.alive ? { ...card, revealed: true } : card));
}

function addMessage(state: BattleState, kind: MessageKind, text: string): BattleState {
  return {
    ...state,
    messages: [{ kind, text }],
  };
}

function clearSelections(state: BattleState): BattleState {
  return {
    ...state,
    selectedAttackerId: null,
    selectedTargetId: null,
    attackConfirmed: false,
    defenseMode: 'none',
    selectedCoverId: null,
    defenseConfirmed: false,
    duelStartedAt: null,
  };
}

function applyEndState(state: BattleState): BattleState {
  const aCanFight = getAliveCards(state, 'A').some((card) => card.kind !== 'trap');
  const bCanFight = getAliveCards(state, 'B').some((card) => card.kind !== 'trap');

  if (!aCanFight && !bCanFight) {
    return { ...state, gameStatus: 'finished', winner: null };
  }

  if (!aCanFight) {
    return { ...state, gameStatus: 'finished', winner: 'B' };
  }

  if (!bCanFight) {
    return { ...state, gameStatus: 'finished', winner: 'A' };
  }

  return { ...state, gameStatus: 'playing', winner: null };
}

function blockIfFinished(state: BattleState): BattleState | null {
  if (state.gameStatus !== 'finished') return null;
  return addMessage(state, 'warn', '遊戲已結束，請重新開始一局');
}
