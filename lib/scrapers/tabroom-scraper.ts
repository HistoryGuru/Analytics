/**
 * Tabroom scraper.
 *
 * IMPORTANT - read this before you run it:
 *
 * Tabroom has NO public API. `staging.tabroom.com` is the pre-release test
 * deployment of Tabroom's in-progress Node/Svelte rewrite (repos:
 * speechanddebate/indexcards + speechanddebate/schemats) - it is explicitly
 * unstable and not guaranteed to be live or to keep the same markup/routes.
 * The production site (tabroom.com) still runs the legacy Perl/Mason app.
 *
 * I (the assistant) can't reach either host from my sandbox to verify current
 * HTML structure, so the selectors below are best-effort based on Tabroom's
 * long-standing public page conventions (`index.tab?tourn_id=...`,
 * `results.tab`, `paradigm.tab`) and WILL need you to check them against the
 * live page once and adjust. To do that:
 *   1. Open the target page in your browser (staging.tabroom.com or
 *      tabroom.com), right-click a result row -> Inspect.
 *   2. Update the CSS selectors in `SELECTORS` below to match what you see.
 *   3. Run `npm run scrape:tabroom -- --tournament <id>` and check the output.
 *
 * ETIQUETTE / TERMS: Tabroom is free community infrastructure run by NSDA
 * volunteers. Keep SCRAPER_DELAY_MS conservative (1-2s+), set a real
 * identifying User-Agent (see .env), scrape only public result pages (never
 * try to log in or access judge/tab-room-only data), and cache aggressively
 * so you're not re-hitting the same pages every run.
 */

import * as cheerio from 'cheerio';

const BASE_URL = process.env.TABROOM_BASE_URL ?? 'https://staging.tabroom.com';
const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ?? 'debate-catalog-bot/0.1 (please replace with your contact info)';
const DELAY_MS = Number(process.env.SCRAPER_DELAY_MS ?? 1500);

// ---- Adjust these to match the live markup (see header comment) ----
const SELECTORS = {
  resultRow: 'table.results tr',
  round: 'td.round',
  side: 'td.side',
  opponent: 'td.opponent a',
  judge: 'td.judge a',
  decision: 'td.decision',
};

export interface ScrapedResult {
  tournament: string;
  tournamentId: number;
  round: string;
  side?: string;
  opponentName?: string;
  judgeName?: string;
  win?: boolean;
  decisionType?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(path: string): Promise<string> {
  await sleep(DELAY_MS);
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`Tabroom GET ${path} -> ${res.status}`);
  }
  return res.text();
}

/**
 * Parses a "results by entry" style page for one competitor/team at one
 * tournament into structured round-by-round results, INCLUDING win/loss -
 * this is the data OpenCaselist doesn't have, and is what lets us compute
 * "won X% of rounds when running argument Y" once joined with cites.
 *
 * `tournId` and `entryId` come from the tournament's public results index -
 * see `findEntry` below for how to locate them by competitor name.
 */
export async function scrapeEntryResults(
  tournId: number,
  entryId: number,
  tournamentName: string,
): Promise<ScrapedResult[]> {
  const html = await fetchHtml(`/index.tab?tourn_id=${tournId}&entry_id=${entryId}&page=results`);
  const $ = cheerio.load(html);
  const results: ScrapedResult[] = [];

  $(SELECTORS.resultRow).each((_, el) => {
    const row = $(el);
    const round = row.find(SELECTORS.round).text().trim();
    if (!round) return; // skip header/empty rows

    const decisionText = row.find(SELECTORS.decision).text().trim();
    results.push({
      tournament: tournamentName,
      tournamentId: tournId,
      round,
      side: row.find(SELECTORS.side).text().trim() || undefined,
      opponentName: row.find(SELECTORS.opponent).text().trim() || undefined,
      judgeName: row.find(SELECTORS.judge).text().trim() || undefined,
      win: parseWinLoss(decisionText),
      decisionType: decisionText || undefined,
    });
  });

  return results;
}

/**
 * Tabroom decision cells are typically rendered as "W" / "L" or a ballot
 * count like "2-1". Adjust this parser once you've seen a real page - it's
 * a reasonable guess, not a verified rule.
 */
function parseWinLoss(decisionText: string): boolean | undefined {
  const t = decisionText.toUpperCase();
  if (t.includes('W') && !t.includes('L')) return true;
  if (t.includes('L') && !t.includes('W')) return false;
  return undefined; // ambiguous (e.g. "2-1" without a W/L marker) - leave null, don't guess
}

/**
 * Searches Tabroom's public competitor/judge search for a name and returns
 * raw candidate links found on the page. Tabroom's search UI has shifted
 * around over the years, so this returns everything it finds rather than
 * assuming a fixed shape - inspect the output and refine the filter once you
 * see it against the live site.
 */
export async function searchCompetitor(name: string): Promise<{ text: string; href: string }[]> {
  const html = await fetchHtml(`/index.tab?search=${encodeURIComponent(name)}`);
  const $ = cheerio.load(html);
  const links: { text: string; href: string }[] = [];

  $('a').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const text = $(el).text().trim();
    if (href.includes('entry_id') || href.includes('paradigm.tab')) {
      links.push({ text, href });
    }
  });

  return links;
}
