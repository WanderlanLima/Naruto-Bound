import type { NinjaRosterEntry } from '../types/shinobi';

export const TEAM_SIZE = 3;

/** How many times the same ninja may appear in one team (repeats only when the roster is too small) */
export function maxCopiesPerTeam(rosterSize: number, teamSize = TEAM_SIZE): number {
  return Math.max(1, Math.ceil(teamSize / Math.max(1, rosterSize)));
}

/**
 * Counts chase links inside a team: every time a ninja can cause a state that
 * some chase skill in the squad (its own or an ally's) is able to follow up.
 * Links between different slots weigh more, since they build the longer chains.
 */
export function scoreTeamSynergy(team: NinjaRosterEntry[]): number {
  let score = 0;
  team.forEach((source, i) => {
    const kit = source.combat;
    const caused = [
      kit.attack.causesState,
      kit.skill.causesState,
      kit.ultimate.causesState,
      ...kit.chasers.map((c) => c.causesState),
    ];
    team.forEach((follower, j) => {
      for (const chaser of follower.combat.chasers) {
        if (chaser.requiresStates.some((s) => caused.includes(s))) {
          score += i === j ? 1 : 2;
        }
      }
    });
  });
  return score;
}

/**
 * AI squad selection: every legal trio is rated by chase synergy and variety of
 * roles/natures. A random bonus keeps the AI from always fielding the same team.
 */
export function pickAiTeam(roster: NinjaRosterEntry[], teamSize = TEAM_SIZE): NinjaRosterEntry[] {
  if (roster.length === 0) return [];
  const maxCopies = maxCopiesPerTeam(roster.length, teamSize);

  let best: NinjaRosterEntry[] = [];
  let bestScore = -Infinity;

  const build = (start: number, team: NinjaRosterEntry[]) => {
    if (team.length === teamSize) {
      const roles = new Set(team.map((n) => n.combat.role)).size;
      const natures = new Set(team.map((n) => n.combat.nature)).size;
      const score = scoreTeamSynergy(team) + roles * 1.5 + natures + Math.random() * 8;
      if (score > bestScore) {
        bestScore = score;
        best = [...team];
      }
      return;
    }
    for (let i = start; i < roster.length; i++) {
      if (team.filter((n) => n.id === roster[i].id).length >= maxCopies) continue;
      team.push(roster[i]);
      build(i, team);
      team.pop();
    }
  };

  build(0, []);

  // Lineup order drives both turn order and chase priority, so shuffle it
  for (let i = best.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [best[i], best[j]] = [best[j], best[i]];
  }
  return best;
}
