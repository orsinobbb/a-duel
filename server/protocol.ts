import type { BattleState } from '../src/engine/battle';
import type { PublicUser, UserSession } from '../src/shared/protocol';

export type MatchRecord = {
  id: string;
  state: BattleState;
  players: {
    A: PublicUser | null;
    B: PublicUser | null;
  };
  createdAt: number;
  updatedAt: number;
};

export type PersistedSnapshot = {
  version: 1;
  sessions: UserSession[];
  matches: MatchRecord[];
};

export type {
  BattleAction,
  ClientMessage,
  LoginResponse,
  MatchLifecycle,
  MatchSummary,
  PlayerSeat,
  PublicUser,
  ServerMessage,
  UserSession,
} from '../src/shared/protocol';
