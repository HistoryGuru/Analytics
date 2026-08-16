# Debate Catalog

Opponent scouting for LD: pulls disclosed rounds/arguments from OpenCaselist,
pulls win/loss from Tabroom, joins them, and helps you pick which of your own
files to read against a given opponent.

## Status of this build

This is **phase 1: the data pipeline**, per your priority. It's real, working
code against a verified live API (OpenCaselist) plus a scraper skeleton for
Tabroom that needs a few minutes of live tuning (see below - Tabroom has no
public API, so this part can't be pre-verified from a sandboxed environment).
The dashboard UI is intentionally minimal right now - phase 2.

## Before you touch code: two things worth knowing

1. **OpenCaselist requires your real, Tabroom-linked login.** There's no
   anonymous or API-key access - `POST /login` validates against Tabroom's
   own auth. Use your own account, don't share the session, and keep
   `SCRAPER_DELAY_MS` reasonable (default 1.5s). This is free infrastructure
   volunteers run for the debate community - don't hammer it.
2. **Check OpenCaselist's and Tabroom's terms before scraping at scale**,
   especially if you plan to run this against schools/teams other than your
   own or share the output publicly. Both sites exist because coaches and
   students voluntarily disclose - this tool is meant for personal prep, not
   redistribution. I haven't reviewed their current ToS for you; do that
   yourself before running this beyond your own scouting.

## Deploying to Render

The project targets Postgres (Render's disk isn't reliably persistent across
deploys, so SQLite doesn't work there - a managed Postgres is the right
call). A `render.yaml` blueprint is included that provisions both the web
service and a free Postgres database together.

**1. Push this to GitHub.** Render deploys from a repo, not a zip upload:

```bash
cd debate-catalog
git init
git add .
git commit -m "Initial commit"
gh repo create debate-catalog --private --source=. --push
# or manually: create a repo on github.com, then
# git remote add origin <your-repo-url> && git push -u origin main
```

**2. Deploy the blueprint.**
- Go to [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**
- Connect the GitHub repo you just pushed
- Render reads `render.yaml` and shows you two resources: the `debate-catalog`
  web service and the `debate-catalog-db` Postgres database. Click **Apply**.
- It builds and deploys automatically. First build takes a few minutes.

**3. Set the two secrets Render won't auto-fill.** In the web service's
**Environment** tab, fill in:
- `TABROOM_USERNAME`
- `TABROOM_PASSWORD`

(These are marked `sync: false` in the blueprint on purpose, so they aren't
committed anywhere - you type them once in the Render dashboard.)

**4. Run the data sync against the live database.** The sync/scrape scripts
are CLI tools, not web routes - they're not meant to run inside the web
dyno. Run them from your own machine, pointed at the production database:

```bash
# Render dashboard -> debate-catalog-db -> "External Database URL" -> copy it
export DATABASE_URL="<paste external connection string>"
export TABROOM_USERNAME=...
export TABROOM_PASSWORD=...
npm run sync:opencaselist -- --caselist hsld25
```

Your Render site shows the new data immediately - no redeploy needed, it's
reading the same database.

**5. Open your site.** Render gives you a URL like
`https://debate-catalog.onrender.com` - that's it, live.

### A few Render-specific notes

- **Free-tier web services spin down after inactivity** and take ~30-60s to
  wake back up on the next request. Fine for personal scouting use, worth
  knowing so it doesn't look broken.
- **`npm run build` runs `prisma db push --accept-data-loss` on every
  deploy** to keep the DB schema in sync automatically. Convenient for now,
  but it'll happily drop a column if you remove one from `schema.prisma` -
  switch to real Prisma Migrations (`prisma migrate dev` / `deploy`) before
  this holds data you can't afford to lose.
- Re-running the sync scripts is safe (they upsert on unique slugs), but
  nothing is scheduled - re-run manually, or turn
  `scripts/sync-opencaselist.ts` into a
  [Render Cron Job](https://render.com/docs/cronjobs) later if you want it
  automatic.

## Local development (without Render)

```bash
npm install
npx prisma generate
npx prisma db push      # creates tables in whatever DATABASE_URL points to
```

For local Postgres, either run one in Docker:
```bash
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=devpass postgres:16
# then set DATABASE_URL="postgresql://postgres:devpass@localhost:5432/postgres" in .env
```
or just point `DATABASE_URL` at your Render database's *external* connection
string and develop straight against the hosted DB.

Edit `.env` (already created, just fill in the blanks):
- `TABROOM_USERNAME` / `TABROOM_PASSWORD` - your real account, linked on opencaselist.com
- `SCRAPER_USER_AGENT` - put actual contact info in it, don't pretend to be a browser
- `SCRAPER_DELAY_MS` - leave at 1500+ unless you have a reason not to

## Running the pipeline

**1. Sync OpenCaselist** (arguments, no win/loss):

```bash
npm run sync:opencaselist -- --caselist hsld25
# or scope to one school while you're testing:
npm run sync:opencaselist -- --caselist hsld25 --school "SomeSchool"
```

Caselist slugs look like `hsld25` (event + 2-digit year). If you're not sure
of the slug, the script will print all available ones when you pass a slug
that doesn't match.

**2. Scrape Tabroom results** (win/loss, no arguments):

```bash
# find the right tourn_id/entry_id for a competitor:
npm run scrape:tabroom -- --search "Jane Smith"

# then pull their round-by-round results:
npm run scrape:tabroom -- --tourn 12345 --entry 67890 --name "Some Tournament"
```

**Read `lib/scrapers/tabroom-scraper.ts` first.** Tabroom has no public API.
`staging.tabroom.com` is the pre-release test build of their in-progress
rewrite and its markup isn't something I can verify from here - I built the
selectors from Tabroom's known long-standing URL/page conventions, but you
should open a real results page, inspect the HTML, and adjust the
`SELECTORS` object if rows don't come back. This is a 5-10 minute fix, not a
rewrite - the scraping/parsing logic around it is solid.

**3. Join the two datasets** for a team, so win-rates show up:

```ts
import { linkRoundsToTabroomResults } from './lib/analysis/opponent-report';
await linkRoundsToTabroomResults(teamId);
```

(Wire this into a script or an API route once you know your workflow - it's
exposed as a plain function on purpose.)

**4. View it**: `npm run dev` then open `http://localhost:3000`

## Why win-rate can show "—"

OpenCaselist's `Round` data has no outcome field - only tournament, side,
round, opponent, judge. Only Tabroom has win/loss. The two get joined by
matching tournament + opponent name + round label, which is inherently fuzzy
(OpenCaselist opponent names are free text; Tabroom's are canonical). Expect
some rounds to stay unlinked - that's the join failing to find a confident
match, not a bug eating your data.

## File organizer (your 1ACs/1NCs)

`lib/matching/file-matcher.ts` has the pieces:
- `extractTextFromDocx()` - pulls text out of uploaded .docx files (mammoth)
- `tagFile()` - runs the same argument-extraction heuristics used on cites
- `suggestFiles()` - ranks your files against a built `OpponentReport`,
  weighted by how often they run something and (when known) how well it's
  worked for them

There's no upload UI wired up yet (no page/API route) - the logic is ready,
plugging in a `<input type="file">` -> `/api/upload` route that calls these
is the natural phase-2 task. Say the word and I'll build that next.

**Known limitation, stated honestly:** matching right now is keyword/tag
based (shared argument labels), not semantic. It won't notice that your
"Set Col Bad" 1NC page answers their "Set Col K" 1AC unless the tags happen
to line up. A real v2 would embed file text and opponent argument text and
rank by cosine similarity - straightforward to add once you have enough real
files/cites to test against.

## Roadmap (not built yet - tell me which is next)

- Upload UI + `/api/upload` route for your files
- Embedding-based semantic file matching (v2 of the matcher above)
- Dashboard polish - search/filter across teams, trend charts over a season
- Scheduled re-sync (cron) instead of manual CLI runs
- Postgres instead of SQLite once this needs to run somewhere persistent

## Project layout

```
prisma/schema.prisma                  - data model (Caselist -> School -> Team -> Round -> Cite, TabroomResult, UserFile)
lib/scrapers/opencaselist-client.ts   - real OpenCaselist API client
lib/scrapers/tabroom-scraper.ts       - Tabroom HTML scraper (needs live tuning)
lib/analysis/argument-extraction.ts   - cite text -> normalized argument tags
lib/analysis/opponent-report.ts       - joins the two sources into per-argument stats
lib/matching/file-matcher.ts          - your files -> ranked suggestions vs an opponent
scripts/sync-opencaselist.ts          - CLI: pull one caselist into the DB
scripts/scrape-tabroom.ts             - CLI: pull one competitor's Tabroom results
app/                                   - minimal Next.js dashboard
```
