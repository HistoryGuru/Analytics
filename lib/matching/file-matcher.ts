import mammoth from 'mammoth';
import { extractArguments } from '../analysis/argument-extraction';
import type { OpponentReport } from '../analysis/opponent-report';

export interface FileTagResult {
  filename: string;
  fileType: string;
  extractedText: string;
  tags: string[]; // labels from extractArguments, lowercased
}

/** Pulls plain text out of an uploaded .docx (1AC/1NC/blocks are almost always Word docs). */
export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

export function tagFile(filename: string, fileType: string, text: string): FileTagResult {
  const tags = extractArguments(text).map((a) => a.label.toLowerCase());
  return { filename, fileType, extractedText: text, tags };
}

export interface FileSuggestion {
  filename: string;
  fileType: string;
  score: number;
  reasons: string[];
}

/**
 * Given a set of your tagged files and a scouted opponent report, ranks your
 * files by how relevant they are to read against that opponent.
 *
 * Simple heuristic v1:
 *  - Your 1NC/blocks score higher when they tag-match arguments the opponent
 *    runs frequently and (if we have win data) that have beaten similar
 *    positions before.
 *  - Your 1AC/aff-side files score higher when the opponent's neg strategy
 *    (their tagged neg-side arguments) suggests specific answers your case
 *    already covers - flagged via shared framework/theory tags, since direct
 *    case-vs-answer matching needs semantic similarity beyond keyword tags
 *    (see README "Roadmap" for the embedding-based v2 plan).
 */
export function suggestFiles(files: FileTagResult[], opponent: OpponentReport): FileSuggestion[] {
  const opponentTagFrequency = new Map<string, number>();
  const opponentTagWinRate = new Map<string, number | null>();

  for (const stat of opponent.argumentStats) {
    const key = stat.label.toLowerCase();
    opponentTagFrequency.set(key, stat.timesRun);
    opponentTagWinRate.set(key, stat.winRate);
  }

  const suggestions: FileSuggestion[] = files.map((file) => {
    let score = 0;
    const reasons: string[] = [];

    for (const tag of file.tags) {
      const freq = opponentTagFrequency.get(tag);
      if (freq) {
        // Weight by how often the opponent actually runs this
        const weight = Math.min(freq, 5);
        score += weight;
        reasons.push(`Matches "${tag}" - opponent has run this ${freq}x`);

        const winRate = opponentTagWinRate.get(tag);
        if (winRate !== null && winRate !== undefined) {
          if (winRate > 0.6) {
            score += 2;
            reasons.push(`"${tag}" has a high win rate for them (${Math.round(winRate * 100)}%) - prioritize a strong answer`);
          } else if (winRate < 0.4) {
            score -= 1;
            reasons.push(`"${tag}" has a low win rate for them (${Math.round(winRate * 100)}%) - lower priority`);
          }
        }
      }
    }

    return { filename: file.filename, fileType: file.fileType, score, reasons };
  });

  return suggestions.sort((a, b) => b.score - a.score);
}
