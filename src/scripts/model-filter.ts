import { matchesModelFilter, modelFilterKey } from '../lib/model-filter';

for (const root of document.querySelectorAll<HTMLElement>('[data-model-filter-root]')) {
  const input = root.querySelector<HTMLInputElement>('[data-model-filter-query]');
  const size = root.querySelector<HTMLSelectElement>('[data-model-filter-size]');
  const status = root.querySelector<HTMLElement>('[data-model-filter-status]');
  const empty = root.querySelector<HTMLElement>('[data-model-filter-empty]');
  const reset = root.querySelector<HTMLButtonElement>('[data-model-filter-reset]');
  const items = [...root.querySelectorAll<HTMLElement>('[data-model-item]')].map(element => ({
    element, key: modelFilterKey(element.dataset.model ?? ''), size: element.dataset.size ?? '',
  }));
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
  reset?.addEventListener('click', () => { input.value = ''; size.value = ''; apply(); input.focus(); });
  root.querySelector('form')?.addEventListener('submit', event => event.preventDefault());
  apply();
}
