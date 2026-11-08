/** Keep an explicit, bounded selection; unknown IDs are filtered by the caller. */
export function selectForComparison(selected: string[], id: string, checked: boolean, max = 4): string[] {
  const unique = [...new Set(selected)];
  if (!checked) return unique.filter(value => value !== id);
  if (unique.includes(id) || unique.length >= max) return unique;
  return [...unique, id];
}
