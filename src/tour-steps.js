// Page-level anchor preferences for the guided product walkthrough.
// Each stage uses existing UI elements; it never invokes a business action.
export const tourDetails={
 workbench:['打开数据接入或运营恢复。','查看待办和项目进度。'],
 projects:['点击「新建任务」。','查看任务状态和负责人。'],
 definitions:['打开任务模板或任务定义。','核对产出和验收指标。'],
 labels:['点击「新建标签体系」。','核对标签结构和规范版本。'],
 governance:['核对项目、来源许可和验收条件。','查看治理记录和证据。'],
 ingestion:['选择数据源并预览。','核对校验结果和目标数据集。'],
 processing:['选择清洗规则和增强方式。','比较处理前后差异和质量。'],
 'work-orders':['指定生产人、审核人和期限。','查看工单状态和复核记录。'],
 'ai-annotation':['选择预标注模型和数据版本。','查看预标注结果和人工复核入口。'],
 review:['选择样本并核对标签。','查看质检和复核记录。'],
 datasets:['打开数据集版本。','核对来源、状态和质量记录。'],
 models:['选择模型和版本。','核对模型的数据来源。'],
 training:['新建训练任务并选择数据版本。','查看训练状态、产物和日志。'],
 evaluation:['打开评测任务。','核对指标和发布阈值。'],
 deployments:['选择服务和发布版本。','查看部署状态和回滚入口。'],
 testing:['输入测试内容。','查看模拟输出和来源。'],
 knowledge:['点击「接入知识文档」。','查看文档来源和索引状态。'],
 agents:['选择项目并绑定知识来源。','查看智能体配置和执行记录。'],
 canvas:['选择画布节点。','核对节点配置和连接。'],
 feedback:['选择调用记录并填写反馈。','查看修订和复测结果。'],
 marketplace:['选择成果并设置授权范围和期限。','查看授权状态和使用记录。'],
 deliveries:['选择交付版本和验收人。','查看签收、拒收和补交记录。'],
 operations:['打开告警或恢复入口。','查看运行记录和会话快照。'],
 'settings-general':['选择要查看的设置项。','核对当前配置。']
};
export const tourStageLabels=['模块目标','关键操作','结果与追溯'];
export const tourTargets={
 intro:['.page-heading','.st-heading','.pv-section-heading','.cl-page > h1','.gov-page > h1','h1','h2'],
 action:['.page-heading .page-actions','.pv-list-toolbar','.pv-stepbar-wrap','.cl-toolbar','.mv-detail-actions','.ai-actions','.gov-actions','.tabs','.cl-actions','.panel .panel-heading','.panel button','.cl-page .button'],
 result:['.mv-summary-grid','.pv-table-wrap','.dv-section','.cl-stat-grid','.gov-grid','.cl-grid','.mv-list-panel','.panel','.st-shell','.table-wrap','table']
};
export function buildTourSteps(track){
 return track.steps.flatMap(([view,title],sectionIndex)=>{
  const details=tourDetails[view]||[];
  return [
   {view,sectionIndex,stage:0,title,stageLabel:tourStageLabels[0]},
   {view,sectionIndex,stage:1,title,description:details[0],stageLabel:tourStageLabels[1]},
   {view,sectionIndex,stage:2,title,description:details[1],stageLabel:tourStageLabels[2]}
  ];
 });
}
// Resolve only rendered/visible content in the active main viewport, never the side navigation.
// Some sections are conditional on actor permissions, sample data, or selected tabs.
export function findTourTarget(root,stage){
 if(!root)return null;
 const queries=tourTargets[stage===0?'intro':stage===1?'action':'result'];
 for(const query of queries){
  const elements=root.querySelectorAll(query);
  for(const element of elements){
   if(element.closest('[hidden], [aria-hidden="true"]'))continue;
   if(!element.getClientRects().length)continue;
   const style=window.getComputedStyle(element);
   if(style.visibility==='hidden'||style.display==='none')continue;
   const rect=element.getBoundingClientRect();
   if(rect.width<=0||rect.height<=0)continue;
   if(stage===1&&!element.innerText?.trim()){
    const controls=element.matches('button,input,select,textarea,a[href]')?[element]:
     Array.from(element.querySelectorAll('button,input,select,textarea,a[href]'));
    if(!controls.some(control=>{
     const box=control.getBoundingClientRect();
     return !control.closest('[hidden],[aria-hidden="true"]')&&box.width>0&&box.height>0&&
      window.getComputedStyle(control).visibility!=='hidden';
    }))continue;
   }
   return element;
  }
 }
 return null;
}
