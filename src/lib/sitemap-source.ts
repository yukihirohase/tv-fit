import { getPublishedCatalog } from './cms-catalog';
import { getCompatibilitySummary, summaryFromCatalog, type CompatibilitySummary } from './compatibility-summary';
import type { Television } from './data';

/**
 * サイトマップ・llms.txt 用のデータ。テレビ（約440件）は EmDash から読み、
 * 適合情報は D1 の集計1回で済ませる。集計が使えないときだけ従来どおり全件を読む。
 */
export async function getSitemapSource(): Promise<{ televisions: Television[]; summary: CompatibilitySummary }> {
  const summary = await getCompatibilitySummary();
  if (summary) {
    const { televisions } = await getPublishedCatalog({ compatibility: 'none' });
    return { televisions, summary };
  }
  const catalog = await getPublishedCatalog();
  return { televisions: catalog.televisions, summary: summaryFromCatalog(catalog) };
}
