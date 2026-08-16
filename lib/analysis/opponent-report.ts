import { PrismaClient } from '@prisma/client';
import { extractArguments } from './argument-extraction';

const prisma = new PrismaClient();

export interface ArgumentStat {
  label: string;
  category: string;
  timesRun: number;
  timesWithKnownResult: number;
  wins: number;
  losses: number;
  /** null when we have no matched Tabroom result for any instance of this argument */
  winRate: number | null;
  sampleTournaments: string[];
}

export interface OpponentReport {
  teamDisplayName: string;
  totalRoundsDisclosed: number;
  roundsWithMatchedResult: number;
  argumentStats: ArgumentStat[];
  affVsNegSplit: { aff: number; neg: number };
}

/**
 * Builds a scouting report for one team: what they run, how often, and -
 * where we could match a disclosed round to a Tabroom result by
 * tournament + round + opponent name - how often it won.
 *
 * Matching rounds across the two sources is fuzzy by nature (OpenCaselist
 * opponent names are self-entered free text, Tabroom names are canonical).
 * `matchConfidenceThreshold` controls how lenient the name match is.
 */
export async function buildOpponentReport(teamId: number): Promise<OpponentReport> {
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: teamId },
    include: {
      rounds: { include: { cites: true, tabroomResult: true } },
    },
  });

  const statMap = new Map<string, ArgumentStat>();
  let aff = 0;
  let neg = 0;
  let matched = 0;

  for (const round of team.rounds) {
    if (/aff|gov|pro/i.test(round.side)) aff++;
    else neg++;

    if (round.tabroomResult) matched++;

    for (const cite of round.cites) {
      const args = extractArguments(cite.citesText);
      for (const arg of args) {
        const key = `${arg.category}::${arg.label.toLowerCase()}`;
        const existing = statMap.get(key) ?? {
          label: arg.label,
          category: arg.category,
          timesRun: 0,
          timesWithKnownResult: 0,
          wins: 0,
          losses: 0,
          winRate: null,
          sampleTournaments: [],
        };

        existing.timesRun += 1;
        if (!existing.sampleTournaments.includes(round.tournament)) {
          existing.sampleTournaments.push(round.tournament);
        }

        if (round.tabroomResult?.win === true) {
          existing.timesWithKnownResult += 1;
          existing.wins += 1;
        } else if (round.tabroomResult?.win === false) {
          existing.timesWithKnownResult += 1;
          existing.losses += 1;
        }

        statMap.set(key, existing);
      }
    }
  }

  const argumentStats = Array.from(statMap.values())
    .map((s) => ({
      ...s,
      winRate: s.timesWithKnownResult > 0 ? s.wins / s.timesWithKnownResult : null,
    }))
    .sort((a, b) => b.timesRun - a.timesRun);

  return {
    teamDisplayName: team.displayName,
    totalRoundsDisclosed: team.rounds.length,
    roundsWithMatchedResult: matched,
    argumentStats,
    affVsNegSplit: { aff, neg },
  };
}

/**
 * Attempts to link OpenCaselist Rounds to TabroomResults for a team by
 * matching on tournament name (loosely) + opponent name (loosely). Run this
 * after syncing both data sources. Returns how many links it made.
 */
export async function linkRoundsToTabroomResults(teamId: number): Promise<number> {
  const rounds = await prisma.round.findMany({ where: { teamId, tabroomResultId: null } });
  const results = await prisma.tabroomResult.findMany();
  let linked = 0;

  for (const round of rounds) {
    const candidate = results.find(
      (r) =>
        normalize(r.tournament) === normalize(round.tournament) &&
        normalize(r.opponentName ?? '') === normalize(round.opponent ?? '') &&
        normalize(r.round) === normalize(round.roundLabel),
    );
    if (candidate) {
      await prisma.round.update({ where: { id: round.id }, data: { tabroomResultId: candidate.id } });
      linked++;
    }
  }

  return linked;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
