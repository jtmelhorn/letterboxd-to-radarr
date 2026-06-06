/** Stable identity for a film across RSS guids, review URLs, and title/year fallbacks. */
export function canonicalFilmGuid(input: {
  title: string;
  year?: number | null;
  letterboxdUrl?: string | null;
  guid?: string | null;
}): string {
  const candidates = [input.letterboxdUrl, input.guid].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );

  for (const value of candidates) {
    const filmMatch = value.match(/\/film\/([^/?#]+)/i);
    if (filmMatch) return `film:${filmMatch[1].toLowerCase()}`;
  }

  const title = input.title.trim().toLowerCase();
  const year = input.year ?? "unknown";
  return `film:${title}-${year}`;
}
