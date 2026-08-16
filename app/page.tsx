import { PrismaClient } from '@prisma/client';
import Link from 'next/link';

const prisma = new PrismaClient();

export default async function HomePage() {
  const caselists = await prisma.caselist.findMany({
    include: { schools: { include: { teams: true } } },
    orderBy: { year: 'desc' },
  });

  const hasData = caselists.length > 0;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 font-sans">
      <header className="mb-10 border-b border-neutral-800 pb-6">
        <p className="text-xs uppercase tracking-widest text-neutral-500">Debate Catalog</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Opponent Scouting Pipeline</h1>
      </header>

      {!hasData && (
        <div className="rounded border border-dashed border-neutral-700 p-6 text-sm text-neutral-400">
          <p className="mb-2 font-medium text-neutral-200">No data synced yet.</p>
          <p>Run the pipeline first:</p>
          <pre className="mt-3 overflow-x-auto rounded bg-neutral-900 p-3 text-xs text-neutral-300">
{`npm run prisma:push
npm run sync:opencaselist -- --caselist hsld25`}
          </pre>
          <p className="mt-3">See README.md for the Tabroom step and full setup.</p>
        </div>
      )}

      {caselists.map((caselist) => (
        <section key={caselist.id} className="mb-8">
          <h2 className="text-lg font-medium">
            {caselist.name} <span className="text-neutral-500">· {caselist.event} {caselist.year}</span>
          </h2>
          <div className="mt-3 divide-y divide-neutral-800 rounded border border-neutral-800">
            {caselist.schools.flatMap((school) =>
              school.teams.map((team) => (
                <Link
                  key={team.id}
                  href={`/opponents/${team.id}`}
                  className="flex items-center justify-between px-4 py-3 text-sm hover:bg-neutral-900"
                >
                  <span>
                    {school.displayName} — {team.displayName}
                  </span>
                  <span className="text-neutral-500">View report →</span>
                </Link>
              )),
            )}
            {caselist.schools.every((s) => s.teams.length === 0) && (
              <p className="px-4 py-3 text-sm text-neutral-500">No teams synced for this caselist yet.</p>
            )}
          </div>
        </section>
      ))}
    </main>
  );
}
