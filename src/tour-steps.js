// Page-level anchor preferences for the guided product walkthrough.
// Each stage uses existing UI elements; it never invokes a business action.
export const tourDetails={
 workbench:['从工作台的入口进入数据接入或运营恢复，了解待办与项目进度如何汇总。','查看当前空间的指标和待办，确认下一步需要处理的任务。'],
 projects:['点击“新建任务”可建立业务项目，明确责任人与所属空间。','在任务列表中查看状态和负责人，之后进入任务定义。'],
 definitions:['从任务模板或任务定义入口确认输入、输出和目标。','检查任务规范与验收指标，供下游生产引用。'],
 labels:['通过“新建标签体系”维护分类与标注规则。','检查标签结构与规范版本，避免标注人员使用不一致的口径。'],
 governance:['进入治理操作区确认项目、许可和验收的前置条件。','查看治理记录与证据；权限不足时不应绕过门禁。'],
 ingestion:['在接入向导中选择数据源，填写必要信息并预览。','检查校验结果，再确认接入到对应数据集。'],
 processing:['选择清洗规则与增强方式，预览处理前后的变化。','检查差异和质量结果，保留来源与处理版本。'],
 'work-orders':['工单入口用于分派生产、审核人员、期限及抽检策略。','在工单列表查看领取、返工、审核与仲裁状态。'],
 'ai-annotation':['配置预标注模型与任务，确认绑定的数据和模型版本。','查看预标注结果与人工接管流程，不能直接视作验收通过。'],
 review:['选择待审核样本，核对标签并记录审核结论。','检查批次质检、复核历史和可发布条件。'],
 datasets:['查看数据集版本、生产批次与质量记录。','检查版本状态、来源及下游可复用的冻结产物。'],
 models:['从模型仓库选择模型和对应版本。','核对模型和数据来源关联，确认下一步训练所需版本。'],
 training:['通过训练任务入口设置数据版本和模拟训练参数。','检查任务状态、产物与日志；当前不调用真实 GPU。'],
 evaluation:['查看评测任务和质量指标，对照发布阈值。','核对评测证据与失败原因，确认是否满足发布门禁。'],
 deployments:['在服务发布区查看发布条件、版本与部署状态。','检查已发布服务的状态和下线/回滚路径。'],
 testing:['使用在线测试区输入测试内容并检查模拟输出。','查看结果与来源记录，不将演示结果等同真实模型效果。'],
 knowledge:['选择接入文档或新建知识库，检查解析和问答整理。','核对知识版本、索引状态与文档来源。'],
 agents:['选定项目并创建或管理智能体及其知识来源。','查看智能体配置和现有执行记录。'],
 canvas:['进入流程画布查看节点及节点之间的逻辑。','检查节点配置、连接关系及流程产出。'],
 feedback:['提交已有调用的反馈并创建改进任务。','核对修订、复测、追溯和关闭的结果。'],
 marketplace:['选择可上架成果并配置授权用途和期限。','查看授权状态、使用记录以及下架后的限制。'],
 deliveries:['登记交付单及冻结版本，指定验收人与交付证据。','查看客户签收、拒收、补交和售后纠错历史。'],
 operations:['从运营入口查看告警、权限与恢复功能。','检查运行记录、会话快照和异常恢复证据。'],
 'settings-general':['查看基础设置中的空间、成员和治理参数入口。','检查实际配置内容；导览不保存任何设置。']
};
export const tourStageLabels=['模块目标','关键操作','结果与追溯'];
export const tourTargets={
 intro:['.page-heading','.st-heading','.pv-section-heading','.cl-page > h1','.gov-page > h1','h1','h2'],
 action:['.page-heading .page-actions','.pv-list-toolbar','.pv-stepbar-wrap','.cl-toolbar','.mv-detail-actions','.ai-actions','.gov-actions','.tabs','.cl-actions','.panel .panel-heading','.panel button','.cl-page .button'],
 result:['.mv-summary-grid','.pv-table-wrap','.dv-section','.cl-stat-grid','.gov-grid','.cl-grid','.mv-list-panel','.panel','.st-shell','.table-wrap','table']
};
export function buildTourSteps(track){
 return track.steps.flatMap(([view,title,description],sectionIndex)=>{
  const details=tourDetails[view]||['查看当前模块主要操作入口。','检查本模块产出和可追溯记录。'];
  return [
   {view,sectionIndex,stage:0,title,description,stageLabel:tourStageLabels[0]},
   {view,sectionIndex,stage:1,title:title+' · 操作入口',description:details[0],stageLabel:tourStageLabels[1]},
   {view,sectionIndex,stage:2,title:title+' · 结果检查',description:details[1],stageLabel:tourStageLabels[2]}
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
   return element;
  }
 }
 return null;
}
