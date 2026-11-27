// 型番ページの「対応するスタンド」「対応する壁掛け金具」を、JS が動くときだけタブにする。
// JS が無いときは、両方の一覧がページに並び、上のリンクはページ内リンクとして働く。
// ハッシュ：スタンドは #stands、壁掛け金具は #mounts（旧リンクの #wall も受け付ける）。

type Tab = { el: HTMLAnchorElement; key: string; hash: string; panel: HTMLElement; empty: boolean };

function setup(list: HTMLElement) {
  const tabs: Tab[] = [];
  for (const el of list.querySelectorAll<HTMLAnchorElement>('a[data-tab]')) {
    const key = el.dataset.tab!;
    const panel = document.querySelector<HTMLElement>(`[data-tab-panel="${key}"]`);
    if (!panel) return;
    tabs.push({ el, key, hash: el.dataset.hash ?? key, panel, empty: el.dataset.count === '0' });
  }
  if (tabs.length < 2) return;
  // 片方だけが0件のとき、0件のタブは押せないようにする（両方0件なら最初のタブで「登録されていません」を見せる）。
  const hasItems = tabs.some(tab => !tab.empty);
  const disabled = (tab: Tab) => hasItems && tab.empty;

  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', '対応する商品の種類');
  for (const tab of tabs) {
    tab.el.setAttribute('role', 'tab');
    tab.el.setAttribute('aria-controls', tab.panel.id);
    if (disabled(tab)) tab.el.setAttribute('aria-disabled', 'true');
    tab.panel.setAttribute('role', 'tabpanel');
    tab.panel.setAttribute('aria-labelledby', tab.el.id);
    tab.panel.tabIndex = 0;
  }

  const fromHash = (hash: string) => {
    const name = hash.replace(/^#/, '');
    const tab = tabs.find(item => item.hash === name || item.key === name || item.panel.id === name);
    return tab && !disabled(tab) ? tab : undefined;
  };

  const select = (next: Tab, { focus = false, updateHash = false } = {}) => {
    for (const tab of tabs) {
      const selected = tab === next;
      tab.el.setAttribute('aria-selected', String(selected));
      tab.el.tabIndex = selected ? 0 : -1;
      tab.panel.hidden = !selected;
    }
    if (focus) next.el.focus();
    if (updateHash && location.hash !== `#${next.hash}`) history.replaceState(history.state, '', `#${next.hash}`);
  };

  const initial = fromHash(location.hash) ?? tabs.find(tab => !disabled(tab)) ?? tabs[0]!;
  select(initial);
  list.classList.add('is-tabs');
  // 共有リンク（#mounts など）で開いたときは、タブが見える位置まで移動する。
  if (fromHash(location.hash)) list.scrollIntoView({ block: 'start' });

  const enabled = () => tabs.filter(tab => !disabled(tab));

  list.addEventListener('click', event => {
    const target = (event.target as Element).closest<HTMLAnchorElement>('a[role="tab"]');
    const tab = tabs.find(item => item.el === target);
    if (!tab) return;
    event.preventDefault();
    if (disabled(tab)) return;
    select(tab, { updateHash: true });
  });

  list.addEventListener('keydown', event => {
    const current = tabs.find(tab => tab.el === document.activeElement);
    if (!current) return;
    const options = enabled();
    const index = options.indexOf(current);
    let next: Tab | undefined;
    if (event.key === 'ArrowRight') next = options[(index + 1) % options.length];
    else if (event.key === 'ArrowLeft') next = options[(index - 1 + options.length) % options.length];
    else if (event.key === 'Home') next = options[0];
    else if (event.key === 'End') next = options.at(-1);
    else if (event.key === ' ') { event.preventDefault(); select(current, { updateHash: true }); return; }
    if (!next) return;
    event.preventDefault();
    select(next, { focus: true, updateHash: true });
  });

  window.addEventListener('hashchange', () => {
    const tab = fromHash(location.hash);
    if (tab) select(tab);
  });
}

for (const list of document.querySelectorAll<HTMLElement>('[data-product-tabs]')) setup(list);
