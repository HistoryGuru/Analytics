/**
 * Usage:
 *   npm run sync:opencaselist -- --caselist hsld25 --school "MyOpponentSchool"
 *
 * Syncs one caselist (optionally scoped to one school) from OpenCaselist into
 * the local DB: schools -> teams -> rounds -> cites. Safe to re-run; it
 * upserts on the unique slugs/ids from the API.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { OpenCaselistClient } from '../lib/scrapers/opencaselist-client';

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  return {
    caselist: get('--caselist'),
    school: get('--school'),
    archived: args.includes('--archived'),
  };
}

async function main() {
  const { caselist: caselistSlug, school: schoolFilter, archived } = parseArgs();
  if (!caselistSlug) {
    console.error('Usage: npm run sync:opencaselist -- --caselist <slug> [--school <name>] [--archived]');
    console.error('Add --archived when pulling a past/ended season (e.g. hsld25) - those are archived on OpenCaselist.');
    process.exit(1);
  }

  const username = process.env.TABROOM_USERNAME;
  const password = process.env.TABROOM_PASSWORD;
  if (!username || !password) {
    throw new Error('Set TABROOM_USERNAME and TABROOM_PASSWORD in .env - see the comments there.');
  }

  const client = new OpenCaselistClient({ username, password, delayMs: Number(process.env.SCRAPER_DELAY_MS ?? 1500) });
  console.log('Logging in to OpenCaselist...');
  await client.login();

  const remoteCaselists = await client.getCaselists(archived);
  const remoteCaselist = remoteCaselists.find((c) => c.name === caselistSlug);
  if (!remoteCaselist) {
    console.error(`Caselist "${caselistSlug}" not found. Available: ${remoteCaselists.map((c) => c.name).join(', ')}`);
    process.exit(1);
  }

  const caselist = await prisma.caselist.upsert({
    where: { slug: remoteCaselist.name },
    create: {
      slug: remoteCaselist.name,
      name: remoteCaselist.display_name,
      event: remoteCaselist.event,
      year: remoteCaselist.year,
      archived: remoteCaselist.archived,
      syncedAt: new Date(),
    },
    update: { syncedAt: new Date() },
  });

  console.log(`Syncing schools for ${caselist.slug}...`);
  const schools = await client.getSchools(caselistSlug);
  const filteredSchools = schoolFilter
    ? schools.filter((s) => s.name === schoolFilter || s.displayName === schoolFilter)
    : schools;

  for (const remoteSchool of filteredSchools) {
    const school = await prisma.school.upsert({
      where: { caselistId_name: { caselistId: caselist.id, name: remoteSchool.name } },
      create: {
        caselistId: caselist.id,
        name: remoteSchool.name,
        displayName: remoteSchool.displayName,
        state: remoteSchool.state ?? null,
      },
      update: { displayName: remoteSchool.displayName, state: remoteSchool.state ?? null },
    });

    const teams = await client.getTeams(caselistSlug, remoteSchool.name);
    for (const remoteTeam of teams) {
      const team = await prisma.team.upsert({
        where: { schoolId_name: { schoolId: school.id, name: remoteTeam.name } },
        create: {
          schoolId: school.id,
          name: remoteTeam.name,
          displayName: remoteTeam.display_name,
          notes: remoteTeam.notes,
          debater1First: remoteTeam.debater1_first,
          debater1Last: remoteTeam.debater1_last,
          debater2First: remoteTeam.debater2_first,
          debater2Last: remoteTeam.debater2_last,
        },
        update: {
          displayName: remoteTeam.display_name,
          notes: remoteTeam.notes,
        },
      });

      console.log(`  Syncing rounds for ${school.displayName} / ${team.displayName}...`);
      const rounds = await client.getRounds(caselistSlug, remoteSchool.name, remoteTeam.name);
      const cites = await client.getCites(caselistSlug, remoteSchool.name, remoteTeam.name);

      // Cites carry a round_id that should match a round's external_id.
      // In practice some deployments have returned null/undefined external_id
      // on list responses - if you see 0 cites linking up after a sync, log
      // both arrays and confirm the field is populated for your caselist.
      for (const remoteRound of rounds) {
        const round = await prisma.round.create({
          data: {
            teamId: team.id,
            tournament: remoteRound.tournament,
            side: remoteRound.side,
            roundLabel: remoteRound.round,
            opponent: remoteRound.opponent,
            judge: remoteRound.judge,
            report: remoteRound.report,
            tournId: remoteRound.tourn_id,
          },
        });

        const matchingCites = cites.filter((c) => c.round_id === remoteRound.external_id);
        for (const cite of matchingCites) {
          await prisma.cite.create({
            data: {
              externalId: cite.cite_id,
              roundId: round.id,
              teamId: team.id,
              title: cite.title,
              citesText: cite.cites ?? '',
            },
          });
        }
      }
    }
  }

  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());