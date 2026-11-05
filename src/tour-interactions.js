// Explicit allowlist: never click arbitrary buttons based on tour prose.
// These open existing local form dialogs only. Mutation/submission controls are not invoked.
export const safePreviews={
 projects:{button:'新建任务',dialog:'新建任务',help:'先填任务名称和场景，再指定责任成员。保存或创建并接入数据由用户退出导览后自行操作。'},
 labels:{button:'新建标签体系',dialog:'新建标签体系',help:'创建可复用的标签体系，注意必填名称和后续标签规范版本。'},
 training:{button:'新建训练任务',dialog:'新建训练任务',help:'绑定已发布数据版本，核对模型参数和资源条件；演示不会启动训练。'},
 knowledge:{button:'接入知识文档',dialog:'接入知识文档',help:'选择正文来源和项目，检查必填字段；演示不会解析或保存文档。'}
};
export function findSafeOpener(root,view){
 const config=safePreviews[view];
 if(!root||!config)return null;
 return Array.from(root.querySelectorAll('button')).find(el=>el.textContent.trim()===config.button&&!el.disabled&&!el.closest('[hidden], [aria-hidden="true"]')&&el.getClientRects().length);
}
export function inspectForm(dialog){
 if(!dialog)return [];
 return Array.from(dialog.querySelectorAll('.field')).filter(node=>node.getClientRects().length).map(node=>{
  const label=node.querySelector('.field-label')?.textContent?.trim()||'配置字段';
  const input=node.querySelector('input,select,textarea');
  const required=!!node.querySelector('.required')||!!input?.required;
  const hint=node.querySelector('small')?.textContent?.trim()||input?.getAttribute('placeholder')||'';
  return {label,required,hint,node};
 }).filter(x=>x.node);
}
