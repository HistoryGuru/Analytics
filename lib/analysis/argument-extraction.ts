/**
 * Turns raw OpenCaselist cite text (wiki-markdown headings like
 * "1AC - Structural Violence" or "1NC - Cap K") into normalized argument
 * tags we can aggregate stats over.
 *
 * This is intentionally simple pattern-matching, not ML. It's a starting
 * point you should tune against your own event's naming conventions -
 * LD case names and off-case positions don't follow one universal format.
 */

export interface ExtractedArgument {
  label: string;
  category: 'K' | 'DA' | 'CP' | 'Framework' | 'Case' | 'Theory' | 'Other';
  rawHeading: string;
}

const CATEGORY_PATTERNS: [RegExp, ExtractedArgument['category']][] = [
  [/\bK\b|kritik/i, 'K'],
  [/\bDA\b|disad/i, 'DA'],
  [/\bCP\b|counterplan/i, 'CP'],
  [/\bT\b|topicality|theory|condo|pics? bad/i, 'Theory'],
  [/framework|value|criterion|standard/i, 'Framework'],
  [/\b1AC\b|\b1NC\b|case\b|contention/i, 'Case'],
];

/**
 * Cite text on OpenCaselist is stored as their flavor of wiki markup.
 * Headings are the most reliable signal of "what argument is this" - typically
 * lines starting with `=`, `#`, or in ALL CAPS / Title Case standing alone.
 */
export function extractArguments(citeText: string): ExtractedArgument[] {
  if (!citeText) return [];

  const lines = citeText.split('\n').map((l) => l.trim());
  const headingLike = lines.filter((line) => {
    if (!line) return false;
    if (/^[=#*-]{1,4}\s*.+/.test(line)) return true; // markup heading
    if (line.length < 60 && /^[A-Z0-9][A-Za-z0-9 '"\-:.]+$/.test(line) && !line.endsWith('.')) return true; // short title-case line
    return false;
  });

  const seen = new Set<string>();
  const results: ExtractedArgument[] = [];

  for (const raw of headingLike) {
    const cleaned = raw.replace(/^[=#*-]+\s*/, '').replace(/\s*[=#*-]+$/, '').trim();
    if (!cleaned || cleaned.length > 80) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const category = CATEGORY_PATTERNS.find(([re]) => re.test(cleaned))?.[1] ?? 'Other';
    results.push({ label: cleaned, category, rawHeading: raw });
  }

  return results;
}
