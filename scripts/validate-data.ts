import { loadCatalog } from '../src/lib/data';

try {
  const catalog = loadCatalog();
  console.log(`CSV検証成功: テレビ ${catalog.televisions.length}件 / 商品 ${catalog.stands.length}件 / 適合情報 ${catalog.compatibility.length}件`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
