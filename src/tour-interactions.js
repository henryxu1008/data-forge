// Explicit allowlist: never click arbitrary buttons based on tour prose.
// These open existing local form dialogs only. Mutation/submission controls are not invoked.
export const safePreviews={
 projects:{button:'新建任务',inlineRoute:'task-plan',inline:'.p1-form'},
 labels:{button:'新建标签体系',dialog:'新建标签体系'},
 training:{button:'新建训练任务',dialog:'新建训练任务'},
 knowledge:{button:'接入知识文档',dialog:'接入知识文档'},
 ingestion:{inline:'.pv-ingestion-panel'},
 'work-orders':{inline:'.cl-page > .panel'},
 deliveries:{inline:'.cl-page > .panel'}
};
export function findSafeOpener(root,view){
 const config=safePreviews[view];
 if(!root||!config)return null;
 return Array.from(root.querySelectorAll('button')).find(el=>el.textContent.trim()===config.button&&!el.disabled&&!el.closest('[hidden], [aria-hidden="true"]')&&el.getClientRects().length);
}
export function inspectForm(dialog){
 if(!dialog)return [];
 return Array.from(dialog.querySelectorAll('.field')).filter(node=>node.getClientRects().length).map(node=>{
  const label=node.querySelector('.field-label')?.textContent?.replaceAll('*','').trim()||'配置字段';
  const input=node.querySelector('input,select,textarea');
  const required=!!node.querySelector('.required')||!!input?.required;
  const options=input?.tagName==='SELECT'?Array.from(input.options).filter(x=>x.value).slice(0,5).map(x=>x.textContent.trim()).join('、'):'';
  const maxLength=input?.maxLength>=0&&input?.maxLength<10000?'最多 '+input.maxLength+' 字':'';
  const range=input?.type==='number'?[input.min&&'最小值 '+input.min,input.max&&'最大值 '+input.max].filter(Boolean).join('，'):'';
  const locked=input?.readOnly?'系统只读':input?.disabled?'当前不可编辑':'';
  const hint=[node.querySelector('small')?.textContent?.trim(),options&&'可选：'+options,maxLength,range,locked].filter(Boolean).join('；');
  return {label,required,hint,node};
 }).filter(x=>x.node);
}
