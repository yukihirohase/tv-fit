import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { csvColumns, type Catalog } from '../src/lib/data';
import { catalogCollections, cmsCatalogFromRows } from '../src/lib/cms-mapping';
import { listExistingCmsRows } from './cms-import';

function cell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Preserve the original three CSV contracts, not the CMS system IDs/status. */
export function catalogCsvFiles(catalog: Catalog): Record<string, string> {
  return Object.fromEntries(catalogCollections.map(collection => {
    const columns = csvColumns[collection];
    const records = catalog[collection].map(row => columns.map(column => {
      const value = (row as unknown as Record<string, unknown>)[column];
      return column === 'vesa_patterns' && Array.isArray(value)
        ? value.map(pattern => `${pattern.width}x${pattern.height}`).join(';') : value;
    }));
    const csv = [columns, ...records].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
    return [`${collection}.csv`, csv];
  }));
}

export async function runCmsExport(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (args.length !== 2 || args[0] !== '--out' || !args[1] || args[1].startsWith('--')) {
    throw new Error('使用方法: npm run cms:export -- --out work/cms-export');
  }
  const directory = resolve(args[1]);
  if (existsSync(directory)) throw new Error('書出し先が既に存在します。既存CSVを上書きしないよう、別のディレクトリを指定してください。');
  if (!env.EMDASH_BASE_URL || !env.EMDASH_API_TOKEN) throw new Error('EMDASH_BASE_URLとEMDASH_API_TOKENが必要です。');
  const rows = await listExistingCmsRows({ origin: env.EMDASH_BASE_URL, token: env.EMDASH_API_TOKEN }, 'published');
  const catalog = cmsCatalogFromRows(rows);
  const files = catalogCsvFiles(catalog);
  mkdirSync(directory, { recursive: true });
  for (const [name, csv] of Object.entries(files)) writeFileSync(resolve(directory, name), csv, { flag: 'wx' });
  console.log(`公開済みカタログの書出し完了: テレビ ${catalog.televisions.length}件 / スタンド ${catalog.stands.length}件 / 適合 ${catalog.compatibility.length}件`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCmsExport(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : '書出しに失敗しました。');
    process.exitCode = 1;
  });
}
