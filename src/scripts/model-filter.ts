import { compareModels, defaultModelSortOrder, isModelSortOrder, matchesModelFilter, modelFilterKey, releaseSortKey } from '../lib/model-filter';

for (const root of document.querySelectorAll<HTMLElement>('[data-model-filter-root]')) {
  const input = root.querySelector<HTMLInputElement>('[data-model-filter-query]');
  const size = root.querySelector<HTMLSelectElement>('[data-model-filter-size]');
  const status = root.querySelector<HTMLElement>('[data-model-filter-status]');
  const empty = root.querySelector<HTMLElement>('[data-model-filter-empty]');
  const reset = root.querySelector<HTMLButtonElement>('[data-model-filter-reset]');
  const sort = root.querySelector<HTMLSelectElement>('[data-model-filter-sort]');
  const list = root.querySelector<HTMLElement>('[data-model-list]');
  const items = [...root.querySelectorAll<HTMLElement>('[data-model-item]')].map(element => ({
    element, model: element.dataset.model ?? '', key: modelFilterKey(element.dataset.model ?? ''), size: element.dataset.size ?? '',
    sizeValue: element.dataset.size ? Number(element.dataset.size) : null, release: releaseSortKey(element.dataset.release),
    rank: element.dataset.rank ? Number(element.dataset.rank) : null,
  }));
  const reorder = () => {
    if (!list || !sort) return;
    const order = isModelSortOrder(sort.value) ? sort.value : defaultModelSortOrder;
    const sorted = [...items].sort((a, b) => compareModels({ model: a.model, size: a.sizeValue, release: a.release, rank: a.rank }, { model: b.model, size: b.sizeValue, release: b.release, rank: b.rank }, order));
    list.append(...sorted.map(item => item.element));
  };
  if (!input || !size || !status || !empty) continue;
  const total = items.length;
  const apply = () => {
    let shown = 0;
    for (const item of items) {
      const visible = matchesModelFilter(item, input.value, size.value);
      item.element.hidden = !visible;
      if (visible) shown += 1;
    }
    const filtered = input.value.trim() !== '' || size.value !== '';
    status.textContent = filtered ? `${total}件中 ${shown}件を表示しています。` : `${total}件の型番を表示しています。`;
    empty.hidden = shown > 0;
    if (reset) reset.hidden = !filtered;
  };
  input.addEventListener('input', apply);
  size.addEventListener('change', apply);
  sort?.addEventListener('change', reorder);
  reset?.addEventListener('click', () => { input.value = ''; size.value = ''; apply(); input.focus(); });
  root.querySelector('form')?.addEventListener('submit', event => event.preventDefault());
  apply();
}
