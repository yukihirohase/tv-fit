import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { csvColumns, validateCatalog, type Catalog, type CatalogOptions } from './data';

/** Read only the explicitly selected directory; fixture directories are never auto-loaded. */
export function loadCatalog(directory = resolve(process.cwd(), 'data'), options: CatalogOptions = {}): Catalog {
  const read = (name: keyof typeof csvColumns) => {
    const filename = resolve(directory, `${name}.csv`);
    const input = readFileSync(filename, 'utf8');
    let headerSeen = false;
    const records = parse(input, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      columns: (header: string[]) => {
        headerSeen = true;
        if (header.length !== csvColumns[name].length || header.some((column, index) => column !== csvColumns[name][index])) {
          throw new Error(`${name}.csv: ヘッダーがスキーマと一致しません (${csvColumns[name].join(',')})`);
        }
        return header;
      },
    }) as unknown[];
    if (!headerSeen) throw new Error(`${name}.csv: ヘッダーがありません`);
    return records;
  };
  return validateCatalog({ televisions: read('televisions'), stands: read('stands'), compatibility: read('compatibility') }, options);
}

