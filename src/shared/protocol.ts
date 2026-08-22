import type { BattleState, Player } from '../engine/battle';

export type PlayerSeat = Player;
export type MatchLifecycle = 'waiting' | 'playing' | 'finished';

export type PublicUser = {
  userId: string;
  name: string;
};

export type UserSession = PublicUser & {
  token: string;
  expiresAt: number;
};

export type MatchSummary = {
  id: string;
  players: {
    A: PublicUser | null;
    B: PublicUser | null;
  };
  presence: {
    A: boolean;
    B: boolean;
  };
  status: MatchLifecycle;
  winner: Player | null;
  createdAt: number;
  updatedAt: number;
};

export type BattleAction =
  | { type: 'selectAttacker'; cardId: string }
  | { type: 'selectTarget'; cardId: string }
  | { type: 'confirmAttack' }
  | { type: 'selectDefenseCard'; cardId: string }
  | { type: 'confirmDefense' }
  | { type: 'resolve' }
  | { type: 'pass' }
  | { type: 'restart' };

export type ClientMessage =
  | { type: 'battle:action'; action: BattleAction }
  | { type: 'ping'; sentAt: number };

export type ServerMessage =
  | {
      type: 'match:update';
      match: MatchSummary;
      state: BattleState;
      seat: PlayerSeat | 'spectator';
    }
  | { type: 'error'; error: string }
  | { type: 'pong'; sentAt: number };

export type LoginResponse = {
  user: UserSession;
};
