import { buildOpponentReport } from '@/lib/analysis/opponent-report';
import Link from 'next/link';

export default async function OpponentReportPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const report = await buildOpponentReport(Number(teamId));

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 font-sans">
      <Link href="/" className="text-xs text-neutral-500 hover:text-neutral-300">
        ← All teams
      </Link>

      <header className="mb-8 mt-2 border-b border-neutral-800 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{report.teamDisplayName}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {report.totalRoundsDisclosed} rounds disclosed · {report.roundsWithMatchedResult} matched to a
          Tabroom result ({report.affVsNegSplit.aff} Aff / {report.affVsNegSplit.neg} Neg)
        </p>
        {report.roundsWithMatchedResult === 0 && (
          <p className="mt-2 text-xs text-amber-500">
            No Tabroom results linked yet — win rates below will show as "—". Run the Tabroom scraper and
            linkRoundsToTabroomResults() for this team to populate them.
          </p>
        )}
      </header>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="py-2 pr-4">Argument</th>
            <th className="py-2 pr-4">Type</th>
            <th className="py-2 pr-4">Times run</th>
            <th className="py-2 pr-4">Win rate</th>
          </tr>
        </thead>
        <tbody>
          {report.argumentStats.map((stat) => (
            <tr key={stat.label} className="border-b border-neutral-900">
              <td className="py-2 pr-4">{stat.label}</td>
              <td className="py-2 pr-4 text-neutral-500">{stat.category}</td>
              <td className="py-2 pr-4">{stat.timesRun}</td>
              <td className="py-2 pr-4">
                {stat.winRate === null ? '—' : `${Math.round(stat.winRate * 100)}% (${stat.wins}-${stat.losses})`}
              </td>
            </tr>
          ))}
          {report.argumentStats.length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-neutral-500">
                No arguments extracted yet. Cites may be empty or the extraction heuristics need tuning for
                this team's formatting — see lib/analysis/argument-extraction.ts.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
