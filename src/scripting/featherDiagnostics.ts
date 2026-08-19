import type { FeatherDiagnostic } from './featherParser';

/**
 * Parser/compiler "warning" that must still block applying a script to the visual graph.
 *
 * Unsupported statements currently compile into comment nodes. Treating those as success made
 * FeatherScript look like it ran when the line was silently dropped. The missing `blueprint Name`
 * header is the one advisory we keep non-blocking (the graph still compiles).
 */
export const isBlockingFeatherWarning = (diagnostic: FeatherDiagnostic): boolean =>
  diagnostic.severity === 'warning' && !diagnostic.message.startsWith('Add a blueprint declaration at the top');

/** Tiny Levenshtein — used to hint `print` when the user typed `prnt`. */
export function suggestIdentifier(input: string, candidates: Iterable<string>): string | undefined {
  const needle = input.toLowerCase();
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const distance = levenshtein(needle, candidate.toLowerCase());
    if (distance > 0 && distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) >= 3) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = next;
    }
  }
  return row[b.length] ?? 3;
}
