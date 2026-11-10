import {
  csvColumns, validateCatalog, type Catalog, type CatalogOptions,
  type Television, type Stand, type Compatibility,
} from './data';

export const catalogCollections = ['televisions', 'stands', 'compatibility'] as const;
export type CmsCollection = typeof catalogCollections[number];
export interface CmsEntryRow { id?: string; data: unknown }
export type CmsCatalogRows = { [Collection in CmsCollection]: readonly CmsEntryRow[] };

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('CMSのコンテンツ項目はオブジェクトで指定してください。');
  }
  return value as Record<string, unknown>;
}

/**
 * EmDash reserves `id` and `status` for its own content lifecycle. Only the
 * catalog's explicit external ID and compatibility field may become CSV values.
 * System metadata and editor-only fields are deliberately ignored.
 */
export function toCatalogRecord(collection: CmsCollection, fields: unknown): Record<string, unknown> {
  const input = record(fields);
  return Object.fromEntries(csvColumns[collection].map(column => {
    const source = column === 'id' ? 'external_id'
      : collection === 'compatibility' && column === 'status' ? 'compatibility_status'
      : column;
    const value = input[source];
    return [column, column === 'notes' && (value === undefined || value === null) ? '' : value];
  }));
}

/** Convert a validated catalog row to fields accepted by the EmDash editor/API. */
export function toCmsRecord(collection: CmsCollection, row: Television | Stand | Compatibility): Record<string, unknown> {
  const input = row as unknown as Record<string, unknown>;
  return Object.fromEntries(csvColumns[collection].map(column => {
    const target = column === 'id' ? 'external_id'
      : collection === 'compatibility' && column === 'status' ? 'compatibility_status'
      : column;
    const value = input[column];
    if (collection === 'stands' && column === 'vesa_patterns' && Array.isArray(value)) {
      return [target, value.map(pattern => {
        const dimensions = record(pattern);
        return `${dimensions.width}x${dimensions.height}`;
      }).join(';')];
    }
    return [target, value];
  }));
}

/** Validate a complete set of EmDash entry wrappers as the existing catalog. */
export function cmsCatalogFromRows(rows: CmsCatalogRows, options: CatalogOptions = {}): Catalog {
  const data = Object.fromEntries(catalogCollections.map(collection => [
    collection,
    rows[collection].map(row => toCatalogRecord(collection, row.data)),
  ]));
  return validateCatalog(data, options);
}
