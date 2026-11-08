import {selectForComparison} from '../lib/comparison';
document.querySelectorAll<HTMLElement>('[data-comparison-root]').forEach(root=>{
  const boxes=[...root.querySelectorAll<HTMLInputElement>('[data-compare-check]')];
  const rows=[...root.querySelectorAll<HTMLTableRowElement>('[data-compare-row]')];
  const compare=root.querySelector<HTMLButtonElement>('[data-compare-selected]');
  const reset=root.querySelector<HTMLButtonElement>('[data-compare-reset]');
  const status=root.querySelector<HTMLElement>('[data-compare-status]');
  if(!compare||!reset||!status)return;
  let selected:string[]=[];
  let filtered=false;
  const update=()=>{
    compare.disabled=selected.length===0;
    boxes.forEach(box=>{box.checked=selected.includes(box.dataset.compareCheck??'');});
    rows.forEach(row=>{row.hidden=filtered&&!selected.includes(row.dataset.compareRow??'');});
    status.textContent=selected.length ? `${selected.length}件選択中${filtered?'・選択した商品を表示しています。':'（最大4件）。'}`:'商品を選択してください（最大4件）。';
  };
  boxes.forEach(box=>box.addEventListener('change',()=>{
    const id=box.dataset.compareCheck;
    if(!id)return;
    const atLimit=box.checked&&!selected.includes(id)&&selected.length>=4;
    selected=selectForComparison(selected,id,box.checked);
    if(!selected.length)filtered=false;
    update();
    if(atLimit)status.textContent='比較できるのは最大4件です。選択済みの商品を外してください。';
  }));
  compare.addEventListener('click',()=>{filtered=true;update();});
  reset.addEventListener('click',()=>{filtered=false;selected=[];update();});
});
