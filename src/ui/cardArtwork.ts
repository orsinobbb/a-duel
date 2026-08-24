import type { BattleCard, Player } from '../engine/battle';

import blueDuke from '../assets/cards/player-a/rank5.webp';
import blueMarquis from '../assets/cards/player-a/rank4.webp';
import blueCount from '../assets/cards/player-a/rank3.webp';
import blueViscount from '../assets/cards/player-a/rank2.webp';
import blueKnight from '../assets/cards/player-a/rank1.webp';
import blueExplosive from '../assets/cards/player-a/explosive.webp';
import blueTrap from '../assets/cards/player-a/trap.webp';
import redDuke from '../assets/cards/player-b/rank5.webp';
import redMarquis from '../assets/cards/player-b/rank4.webp';
import redCount from '../assets/cards/player-b/rank3.webp';
import redViscount from '../assets/cards/player-b/rank2.webp';
import redKnight from '../assets/cards/player-b/rank1.webp';
import redExplosive from '../assets/cards/player-b/explosive.webp';
import redTrap from '../assets/cards/player-b/trap.webp';

type ArtworkKey = 'rank5' | 'rank4' | 'rank3' | 'rank2' | 'rank1' | 'explosive' | 'trap';

const artwork: Record<Player, Record<ArtworkKey, string>> = {
  A: {
    rank5: blueDuke,
    rank4: blueMarquis,
    rank3: blueCount,
    rank2: blueViscount,
    rank1: blueKnight,
    explosive: blueExplosive,
    trap: blueTrap,
  },
  B: {
    rank5: redDuke,
    rank4: redMarquis,
    rank3: redCount,
    rank2: redViscount,
    rank1: redKnight,
    explosive: redExplosive,
    trap: redTrap,
  },
};

export function getCardArtworkUrl(card: BattleCard): string {
  const key: ArtworkKey = card.kind === 'rank' ? (`rank${card.rank}` as ArtworkKey) : card.kind;
  return artwork[card.owner][key];
}
