/**
 * The game's Ranked XP rules. The numbers are the contents of `data/onlinerankings/rankings.xml` of the game
 * (see docs/research/ranked-xp.md); the game itself computes XP and level and reports the total XP as the `score`
 * of a finished Ranked race. The server only reads it: level for display, expected change for plausibility checks.
 */

export const MIN_XP = 1;
export const MAX_XP = 80000;
export const MAX_LEVEL = 50;
export const LEVELS_PER_RANK = 10;

/** XP needed for level 1..50 (index 0 = level 1). */
export const LEVEL_XP = [1, 100, 200, 300, 400, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 7000, 8000, 9000, 10000, 11500, 13000, 14500, 16000, 17500, 19000, 20500, 22000, 23500, 25500, 27500, 29500, 31500, 33500, 35500, 37500, 39500, 41500, 43500, 46500, 49500, 52500, 55500, 58500, 61500, 64500, 67500, 70500, 75000] as const;

/** Share of the loss points that counts at a level (index 0 = level 1). */
export const LOSS_FACTOR = [0.0, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.25, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.25, 0.5, 0.5, 0.6, 0.6, 0.6, 0.6, 0.7, 0.7, 0.7, 0.25, 0.5, 0.5, 0.7, 0.7, 0.7, 0.7, 0.8, 0.8, 0.8, 0.25, 0.5, 0.5, 0.8, 0.8, 0.8, 0.8, 0.9, 0.9, 1.0] as const;

/** Win and loss points for a relative level (own level minus the opponent's) of -50..50. */
const WON = [75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 74, 74, 73, 72, 71, 70, 69, 67, 65, 63, 60, 57, 54, 50, 46, 43, 40, 37, 35, 33, 31, 30, 29, 28, 27, 26, 26, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25] as const;
const LOST = [-25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -26, -26, -27, -28, -29, -30, -31, -33, -35, -37, -40, -43, -46, -50, -54, -57, -60, -63, -65, -67, -69, -70, -71, -72, -73, -74, -74, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75, -75] as const;

/** Penalty in XP for 1..10 quits. */
export const QUIT_PENALTY = [-250, -750, -1000, -1250, -1500, -2000, -2100, -2200, -2500, -3000] as const;

export function levelOf(xp: number): number {
  let level = 1;
  for (let i = 0; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) level = i + 1;
  return level;
}

/** Rank tier 1..5 (ten levels each). */
export function rankOf(level: number): number {
  return Math.min(5, Math.max(1, Math.ceil(level / LEVELS_PER_RANK)));
}

/** Points for beating (`won`) or losing to (`lost`, negative) an opponent, by own level minus the opponent's. */
export function points(rel: number): { won: number; lost: number } {
  const i = Math.min(50, Math.max(-50, rel)) + 50;
  return { won: WON[i], lost: LOST[i] };
}

/**
 * XP after a race as the game computes it (PostRaceRankingUpdate): `opponents` are the other ranked players with
 * their level and whether the player finished ahead of them. Not covered: the 3-race immunity after a rank-up,
 * which keeps XP from falling, and quit penalties.
 */
export function expectedXp(xpBefore: number, opponents: { level: number; beaten: boolean }[]): number {
  const own = levelOf(xpBefore);
  let win = 0, loss = 0;
  for (const o of opponents) {
    const p = points(own - o.level);
    if (o.beaten) win += p.won; else loss += p.lost;
  }
  const xp = xpBefore + win + Math.trunc(loss * LOSS_FACTOR[own - 1]);
  return Math.min(MAX_XP, Math.max(LEVEL_XP[own - 1], xp));
}
