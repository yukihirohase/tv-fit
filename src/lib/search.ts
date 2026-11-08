import Fuse from 'fuse.js';
import { normalizeModel } from './normalize';

export interface SearchItem {
  id: string;
  manufacturer: string;
  model: string;
  url: string;
  screen_inches: number | null;
}

export type SearchMatch = 'exact' | 'prefix' | 'partial' | 'similar';
export interface SearchResult {
  item: SearchItem;
  match: SearchMatch;
}

interface IndexedItem {
  item: SearchItem;
  model: string;
  manufacturer: string;
}

const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 12;

/** Search-only normalization leaves every item's official model string intact. */
export function createSearch(items: readonly SearchItem[]) {
  const indexed: IndexedItem[] = items.map((item) => ({
    item,
    model: normalizeModel(item.model),
    manufacturer: normalizeModel(item.manufacturer),
  }));

  return (query: string, manufacturer = ''): SearchResult[] => {
    if (query.length > MAX_QUERY_LENGTH) return [];
    const normalizedQuery = normalizeModel(query);
    if (!normalizedQuery) return [];
    const normalizedManufacturer = normalizeModel(manufacturer);
    const pool = normalizedManufacturer
      ? indexed.filter((entry) => entry.manufacturer === normalizedManufacturer)
      : indexed;

    const direct: (SearchResult & { rank: number })[] = [];
    const remaining: IndexedItem[] = [];
    for (const entry of pool) {
      const { model, item } = entry;
      if (model === normalizedQuery) direct.push({ item, match: 'exact', rank: 0 });
      else if (model.startsWith(normalizedQuery)) direct.push({ item, match: 'prefix', rank: 1 });
      else if (model.includes(normalizedQuery)) direct.push({ item, match: 'partial', rank: 2 });
      else remaining.push(entry);
    }
    direct.sort((a, b) => a.rank - b.rank || a.item.model.localeCompare(b.item.model, 'ja') || a.item.id.localeCompare(b.item.id));
    const results: SearchResult[] = direct.map(({ item, match }) => ({ item, match }));
    if (normalizedQuery.length >= 3 && results.length < MAX_RESULTS && remaining.length) {
      const fuse = new Fuse(remaining, {
        keys: ['model'],
        includeScore: true,
        threshold: 0.28,
        ignoreLocation: true,
        minMatchCharLength: 2,
      });
      const fuzzy = fuse.search(normalizedQuery).sort((a, b) =>
        (a.score ?? 1) - (b.score ?? 1) || a.item.item.model.localeCompare(b.item.item.model, 'ja'),
      );
      results.push(...fuzzy.map(({ item }) => ({ item: item.item, match: 'similar' as const })));
    }
    return results.slice(0, MAX_RESULTS);
  };
}
