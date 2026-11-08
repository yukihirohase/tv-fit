import { isIndexableTelevision, manufacturerSlug, type Catalog, type Television } from './data';

export const commonManufacturers = ['SONY', 'Panasonic', 'SHARP', 'TVS REGZA', 'LG', 'Hisense', 'TCL'] as const;
const reservedSlugs = new Set(['about', 'privacy', 'guides', '404']);

export interface Manufacturer {
  name: string;
  slug: string;
  url: string;
  televisions: Television[];
}

/** Stable manufacturer list route; product model strings remain untouched. */
export function manufacturerPath(name: string): string {
  const slug = manufacturerSlug(name);
  if (reservedSlugs.has(slug)) throw new Error(`メーカーURLが固定ページと衝突しています: /${slug}/`);
  return `/${encodeURIComponent(slug)}/`;
}

/** Brand names are navigation labels only; no product records are synthesized. */
export function getManufacturers(televisions: readonly Television[]): Manufacturer[] {
  const groups = new Map<string, Manufacturer>();
  const add = (name: string): Manufacturer => {
    const slug = manufacturerSlug(name);
    const existing = groups.get(slug);
    if (existing) {
      if (existing.name.normalize('NFKC').trim().toLowerCase() !== name.normalize('NFKC').trim().toLowerCase()) {
        throw new Error(`メーカーURLが重複しています: ${existing.name} / ${name}`);
      }
      return existing;
    }
    const manufacturer: Manufacturer = { name, slug, url: manufacturerPath(name), televisions: [] };
    groups.set(slug, manufacturer);
    return manufacturer;
  };
  for (const name of commonManufacturers) add(name);
  for (const television of televisions) add(television.manufacturer).televisions.push(television);
  for (const manufacturer of groups.values()) {
    manufacturer.televisions.sort((a, b) => a.model.localeCompare(b.model, 'ja', { numeric: true }) || a.id.localeCompare(b.id));
  }
  const commonSlugs = new Set<string>(commonManufacturers.map(manufacturerSlug));
  return [
    ...commonManufacturers.map(name => groups.get(manufacturerSlug(name))!),
    ...[...groups.values()].filter(manufacturer => !commonSlugs.has(manufacturer.slug)).sort((a, b) => a.name.localeCompare(b.name, 'ja')),
  ];
}

/** Empty/thin lists do not become indexable simply because a brand is listed. */
export function isIndexableManufacturer(manufacturer: Manufacturer, catalog: Catalog): boolean {
  return manufacturer.televisions.some(television => isIndexableTelevision(television, catalog));
}
