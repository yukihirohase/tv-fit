import { createSearch, type SearchItem, type SearchResult } from '../lib/search';
import { trackEvent } from '../lib/analytics';

const matchLabels: Record<SearchResult['match'], string> = {
  exact: '完全一致',
  prefix: '前方一致',
  partial: '部分一致',
  similar: '類似型番・要確認',
};

for (const root of document.querySelectorAll<HTMLElement>('[data-search-root]')) {
  const form = root.querySelector<HTMLFormElement>('[data-search-form]');
  const input = root.querySelector<HTMLInputElement>('[data-search-model]');
  const manufacturer = root.querySelector<HTMLSelectElement>('[data-search-manufacturer]');
  const results = root.querySelector<HTMLUListElement>('[data-search-results]');
  const status = root.querySelector<HTMLElement>('[data-search-status]');
  const catalog = root.querySelector<HTMLScriptElement>('[data-search-catalog]');
  if (!form || !input || !manufacturer || !results || !status || !catalog) continue;
  let items: SearchItem[];
  try {
    items = JSON.parse(catalog.textContent ?? '[]') as SearchItem[];
  } catch {
    status.textContent = '検索データを読み込めませんでした。時間をおいて再度お試しください。';
    continue;
  }
  const search = createSearch(items);
  let composing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const render = (measure = false) => {
    const query = input.value;
    const matches = search(query, manufacturer.value);
    results.replaceChildren();
    results.hidden = matches.length === 0;
    if (!query.trim()) {
      status.textContent = items.length ? '型番を入力すると候補が表示されます。' : '確認済みの型番データを準備中です。現在、検索対象の型番は登録されていません。';
    } else if (matches.length === 0) {
      status.textContent = items.length
        ? '該当する型番は見つかりませんでした。背面ラベルの型番やメーカーを確認し、一部の文字で再検索してください。未登録の型番は対応を判断できません。'
        : 'この型番はまだ登録されていません。現在、確認済みデータを準備中です。適合状況はテレビと取り付け製品のメーカー公式情報でご確認ください。';
    } else {
      const exact = matches.some((result) => result.match === 'exact');
      status.textContent = exact
        ? `${matches.length} 件の候補が見つかりました。正式な型番を確認して選択してください。`
        : `${matches.length} 件の候補がありますが、完全一致する型番はありません。類似型番を同じ製品と判断しないでください。`;
      for (const { item, match } of matches) {
        // Catalog URLs are generated locally. Reject unexpected schemes and protocol-relative URLs defensively.
        if (!item.url.startsWith('/') || item.url.startsWith('//') || item.url.includes('\\')) continue;
        const row = document.createElement('li');
        const link = document.createElement('a');
        link.className = 'search-result';
        link.href = item.url;
        const text = document.createElement('span');
        const model = document.createElement('strong');
        model.className = 'search-result-model';
        model.textContent = item.model;
        const meta = document.createElement('span');
        meta.className = 'search-result-meta';
        meta.textContent = `${item.manufacturer}${item.screen_inches == null ? '' : ` ・ ${item.screen_inches}型`}`;
        text.append(model, meta);
        const badge = document.createElement('span');
        badge.className = `search-match search-match-${match}`;
        badge.textContent = matchLabels[match];
        link.append(text, badge);
        link.addEventListener('click', () => {
          trackEvent('tv_result_click', { tv_id: item.id, manufacturer: item.manufacturer, match });
        });
        row.append(link);
        results.append(row);
      }
    }
    if (measure && query.trim()) {
      trackEvent('tv_search', { query_length: Math.min(query.length, 100), manufacturer: manufacturer.value || 'all', result_count: matches.length });
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    if (!composing) timer = setTimeout(() => render(true), 250);
  };
  input.addEventListener('input', schedule);
  input.addEventListener('compositionstart', () => { composing = true; clearTimeout(timer); });
  input.addEventListener('compositionend', () => { composing = false; schedule(); });
  manufacturer.addEventListener('change', () => { clearTimeout(timer); render(true); });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearTimeout(timer);
    if (!composing) render(true);
    if (!input.value.trim()) input.focus();
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-manufacturer-pick]')) {
    button.addEventListener('click', () => {
      const value = button.dataset.manufacturerPick ?? '';
      const option = [...manufacturer.options].find((option) => option.value === value);
      if (option) manufacturer.value = option.value;
      render(false);
      input.focus({ preventScroll: true });
      root.scrollIntoView({ behavior: 'auto', block: 'center' });
    });
  }
}
