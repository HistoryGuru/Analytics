/**
 * Usage:
 *   npm run scrape:tabroom -- --search "Jane Smith"
 *   npm run scrape:tabroom -- --tourn 12345 --entry 67890 --name "Tournament Name"
 *
 * Two modes:
 *  1. --search: looks up a competitor by name and prints candidate entry
 *     links so you can pick the right tourn_id/entry_id (name search on
 *     Tabroom is ambiguous - lots of debaters share names).
 *  2. --tourn/--entry/--name: scrapes that specific entry's round-by-round
 *     results (with win/loss) and upserts them into TabroomResult, ready to
 *     be linked to OpenCaselist rounds via linkRoundsToTabroomResults().
 *
 * Read the header comment in lib/scrapers/tabroom-scraper.ts first - the
 * selectors are unverified against the live site and you WILL likely need
 * to tune them.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { scrapeEntryResults, searchCompetitor } from '../lib/scrapers/tabroom-scraper';

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  return {
    search: get('--search'),
    tourn: get('--tourn'),
    entry: get('--entry'),
    name: get('--name'),
  };
}

async function main() {
  const { search, tourn, entry, name } = parseArgs();

  if (search) {
    console.log(`Searching Tabroom for "${search}"...`);
    const links = await searchCompetitor(search);
    if (links.length === 0) {
      console.log('No candidate links found - the search page markup probably differs from what the scraper expects. Open the page manually and check lib/scrapers/tabroom-scraper.ts SELECTORS.');
    }
    for (const link of links) {
      console.log(`  ${link.text}  ->  ${link.href}`);
    }
    return;
  }

  if (tourn && entry && name) {
    console.log(`Scraping results for entry ${entry} at tournament ${tourn}...`);
    const results = await scrapeEntryResults(Number(tourn), Number(entry), name);
    console.log(`Found ${results.length} rounds.`);

    for (const r of results) {
      await prisma.tabroomResult.create({
        data: {
          tournament: r.tournament,
          tournamentId: r.tournamentId,
          round: r.round,
          side: r.side,
          opponentName: r.opponentName,
          judgeName: r.judgeName,
          win: r.win,
          decisionType: r.decisionType,
        },
      });
    }
    console.log('Saved. Next: run the linkRoundsToTabroomResults() helper for the relevant team to join this against their OpenCaselist disclosures.');
    return;
  }

  console.error('Usage: npm run scrape:tabroom -- --search "Name"');
  console.error('   or: npm run scrape:tabroom -- --tourn <id> --entry <id> --name "Tournament Name"');
  process.exit(1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
