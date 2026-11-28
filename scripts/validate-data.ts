import { loadCatalog } from '../src/lib/csv';
import { validateSpecFiles } from '../src/lib/specs';

try {
  const catalog = loadCatalog();
  console.log(`CSV検証成功: テレビ ${catalog.televisions.length}件 / 商品 ${catalog.stands.length}件 / 適合情報 ${catalog.compatibility.length}件`);
  // 比較表・独自情報用の仕様データ（data/stand-specs.csv・data/tv-details.csv）
  const specs = validateSpecFiles(catalog);
  if (specs.warnings.length) console.warn(`仕様データの注意 ${specs.warnings.length}件:\n  ${specs.warnings.slice(0, 20).join('\n  ')}${specs.warnings.length > 20 ? '\n  …' : ''}`);
  if (specs.errors.length) {
    console.error(`仕様データのエラー ${specs.errors.length}件:\n  ${specs.errors.join('\n  ')}`);
    process.exitCode = 1;
  } else if (Object.keys(specs.counts).length) {
    console.log(`仕様データ検証成功: ${Object.entries(specs.counts).map(([file, count]) => `${file} ${count}件`).join(' / ')}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
