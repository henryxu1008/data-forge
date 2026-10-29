import DeliveryView from './DeliveryView.jsx';
import {applyWorkspaceDelivery} from './delivery-platform.js';
import {uniqueId} from './unique-id.js';
import React,{useState,useEffect,useRef,useCallback,useMemo} from 'react';
import {IconLayoutDashboard,IconLayersIntersect,IconDatabase,IconCube,IconStack2,IconSettings,IconChevronDown,IconChevronRight,IconSearch,IconMenu2,IconX,IconCheck,IconAlertCircle,IconHistory} from '@tabler/icons-react';
import {Button,Modal,Empty,downloadText} from './ui.jsx';
import DataViews,{initialDatasets,initialVersions,initialReviewTasks} from './DataViews.jsx';
import ProductionViews,{productionSeed} from './ProductionViews.jsx';
import ModelViews from './ModelViews.jsx';
import SettingsApp,{settingsPages} from './settings/SettingsApp.jsx';
import {initialBasicState} from './settings/SettingsBasic.jsx';
import {initialResourceState} from './settings/SettingsResources.jsx';
import {initialSecurityState} from './settings/SettingsSecurity.jsx';
import {createReviewState,transitionReviewState} from './review-state.js';
import {createTextBatch,applyTextBatchAction,textBatchCounts} from './text-production-state.js';
import {createModelLifecycleState,applyModelLifecycleAction,modelLifecycleHasWork} from './model-lifecycle-state.js';
import {createImageBatch,createDemoImageRecords,defaultImageSpec,applyImageBatchAction,imageBatchCounts} from './image-production-state.js';
import {createCompletionState,applyCompletionAction} from './completion-state.js';
import {clone,canAccess,permissionFor,workspaceVersions,visibleWorkspace,authorizeAction} from './platform-policy.js';
import {loadSaved,saveCurrent,encodeSnapshot,decodeSnapshot} from './persistence.js';
import {KnowledgeView,AgentsView,FeedbackView,MarketplaceView,OperationsView,WorkbenchView,ReviewAssignmentPanel} from './CompletionViews.jsx';
import {createProductionFlowState,applyProductionFlowAction} from './p1-production-flow.js';
import {bindTaskPlan} from './p1-quality.js';
import {TaskPlanningView,ProductionFlowView,BatchRulePanel,TaskPlanStamp} from './P1FlowViews.jsx';
import {PRODUCT_NAME} from './product-brand.js';
import {createAIAnnotationState,applyAIAnnotationAction} from './ai-annotation-state.js';
import AIAnnotationView from './AIAnnotationView.jsx';
import GovernanceView,{GovernanceEntry} from './GovernanceViews.jsx';
import {createGovernanceState,enableGovernance,applyGovernanceAction,checkGovernanceAction,recordGovernanceUse,makeEvaluationAcceptance,haltGovernedWork} from './governance-state.js';
import './data-views.css';import './production-views.css';import './model-views.css';
const groups=[
 {id:'workbench',label:'工作台',icon:IconLayoutDashboard},
 {id:'projects',label:'任务建模中心',icon:IconLayersIntersect,children:[['projects','场景与项目'],['definitions','任务定义'],['labels','标签与规范'],['governance','立项与验收治理']]},
 {id:'datasets',label:'数据生产中心',icon:IconDatabase,children:[['ingestion','数据接入'],['processing','清洗与增强'],['ai-annotation','AI 标注'],['review','标注与审核'],['datasets','数据集']]},
 {id:'models',label:'模型生产中心',icon:IconCube,children:[['models','模型仓库'],['training','训练任务'],['evaluation','评测任务'],['deployments','服务发布'],['testing','在线测试']]},
 {id:'knowledge',label:'应用服务中心',icon:IconCube,children:[['knowledge','知识生产与索引'],['agents','智能体'],['canvas','流程画布'],['feedback','反馈与改进']]},
 {id:'marketplace',label:'数模服务中心',icon:IconStack2,children:[['marketplace','成果市场与授权'],['deliveries','交付与验收']]}
];
const titles=Object.fromEntries(groups.flatMap(g=>[[g.id,g.label],...(g.children||[])]));Object.assign(titles,{'task-plan':'任务需求与指标',pipeline:'生产衔接',datasets:'数据集',models:'模型仓库',quality:'质量检查',operations:'运营与恢复'});settingsPages.forEach(p=>titles[`settings-${p.id}`]=p.title);
const productionViews=['projects','definitions','labels','ingestion','processing'];
const modelViews=['models','training','evaluation','deployments','testing'];
function makeWorkspace(seed=true){
 const images=seed?{defects:createImageBatch({datasetId:'defects',name:'工业缺陷图片集',projectId:'PRJ-003',projectName:'工业缺陷图片集',specSnapshot:defaultImageSpec,records:createDemoImageRecords(),at:new Date().toISOString()})}:{};
 return {datasets:seed?clone(initialDatasets).map(d=>d.id==='knowledge'?{...d,total:0,status:'production',description:'接入实际正文，整理问答并发布知识来源。'}:d):[],selectedId:seed?'customer':'',versions:seed?clone(initialVersions):[],reviewState:createReviewState(seed?clone(initialReviewTasks):[],seed?{todo:120,review:60,rework:20,approved:960}:{todo:0,review:0,rework:0,approved:0}),textBatches:{},imageBatches:images,modelState:createModelLifecycleState(),completion:createCompletionState(),production:productionSeed(!seed),flow:createProductionFlowState(),aiAnnotation:createAIAnnotationState(),governance:createGovernanceState(),events:[]};
}
function makePlatform(){
 const settings=clone({...initialBasicState,...initialResourceState,...initialSecurityState,audit:[]});
 const remap={industrial:'PRJ-003',customer:'PRJ-001',knowledge:'PRJ-002'};
 settings.projects=settings.projects.filter(p=>p.spaceId!=='demo').concat(productionSeed().projects.map(p=>({id:p.id,name:p.name,spaceId:'demo',ownerId:'henry'})));
 settings.members=settings.members.map(m=>({...m,projectIds:m.projectIds.map(id=>remap[id]||id)}));
 settings.quotas=settings.quotas.map(q=>({...q,usedGpu:0,usedConcurrency:0,usedStorageGB:0,concurrency:q.spaceId==='demo'?2:q.concurrency}));settings.resourceTasks=[];
 return {schemaVersion:2,activeSpaceId:'demo',actorId:'henry',settings,workspaces:{demo:makeWorkspace(),quality:makeWorkspace(false)}};
}
function firstView(){const p=window.location.hash.replace(/^#settings\//,'');return settingsPages.some(s=>s.id===p)?`settings-${p}`:'datasets'}
function projectForAction(w,kind,a){
 if(kind==='data')return (w.textBatches[a.datasetId]||w.imageBatches[a.datasetId])?.projectId;
 if(kind==='model')return w.modelState.trainings.find(t=>t.id===a.trainingId)?.dataVersion.projectId||w.modelState.models.find(m=>m.id===a.modelVersionId)?.projectId||w.modelState.services.find(s=>s.id===a.serviceId)?.modelSnapshot.projectId||workspaceVersions(w).find(v=>v.id===a.dataVersionId)?.projectId;
 const s=w.completion;
 return a.projectId||s.documents.find(d=>d.id===a.documentId)?.projectId||s.qas.find(q=>q.id===a.qaId)?.projectId||s.agents.find(g=>g.id===a.agentId)?.projectId||s.sourceVersions.find(v=>v.id===a.sourceVersionId)?.projectId||s.indexes.find(i=>i.id===a.indexId)?.sourceSnapshot.projectId||s.libraries.find(l=>l.id===a.libraryId)?.sourceVersionId&&s.sourceVersions.find(v=>v.id===s.libraries.find(l=>l.id===a.libraryId)?.sourceVersionId)?.projectId;
}
function resourceTasks(w,spaceId){return [...w.modelState.trainings.map(t=>({id:t.id,spaceId,name:t.name,status:t.status==='queued'?'waiting':t.status,resource:t.status==='running'?'GPU 1 张':'未占用',submitted:new Date(t.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})})),...w.completion.indexes.map(i=>({id:i.id,spaceId,name:`知识索引 ${i.id}`,status:i.status==='queued'?'waiting':i.status,resource:i.status==='running'?'CPU 任务':'未占用',submitted:new Date(i.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}))];}
function failureTransitions(previous,w){
 const result=[];
 for(const [key,type,source]of [['documents','document','completion'],['indexes','index','completion'],['trainings','training','modelState'],['evaluations','evaluation','modelState'],['services','deployment','modelState']]){
  for(const x of w[source][key]){if(!['failed','error'].includes(x.status)||previous[source][key].find(p=>p.id===x.id)?.status===x.status)continue;result.push({type,id:x.id,libraryId:x.libraryId,reason:x.lastError||x.error||x.attempts?.at(-1)?.reason||'模拟评测未达标'})}
 }
 return result;
}
export function App(){
 const [platform,setPlatform]=useState(makePlatform),ref=useRef(platform),[loaded,setLoaded]=useState(false),[saveStatus,setSaveStatus]=useState('正在读取本地会话'),[view,setView]=useState(firstView),[expanded,setExpanded]=useState('datasets'),[seen,setSeen]=useState(['datasets']),[productionView,setProductionView]=useState('projects'),[resetKey,setResetKey]=useState(0),[request,setRequest]=useState(null),[datasetRequest,setDatasetRequest]=useState(null),[ingestionRequest,setIngestionRequest]=useState(null),[toast,setToast]=useState(null),[mobileNav,setMobileNav]=useState(false),[demoInfo,setDemoInfo]=useState(false),[globalSearch,setGlobalSearch]=useState('');
 const timer=useRef(),sequence=useRef(0),undo=useRef(null),[canUndo,setCanUndo]=useState(false),saveGeneration=useRef(0),[isMobile,setIsMobile]=useState(()=>window.matchMedia('(max-width:820px)').matches);
 const commit=useCallback(next=>{ref.current=next;setPlatform(next)},[]);
 const notify=useCallback((text,tone='success')=>{setToast({text,tone});clearTimeout(timer.current);timer.current=setTimeout(()=>setToast(null),5000)},[]);
 const p=platform,spaceId=p.activeSpaceId,raw=p.workspaces[spaceId],w=visibleWorkspace(raw,p.settings,p.actorId,spaceId),settingsActive=view.startsWith('settings-');
 const space=p.settings.spaces.find(s=>s.id===spaceId),actor=p.settings.users.find(u=>u.id===p.actorId);
 const defaultBrandLogo=initialBasicState.platform.logo;
 const brand={...p.settings.platform,name:PRODUCT_NAME,logo:/^\/assets\/brand-mark\.png$/.test(p.settings.platform.logo||'')?defaultBrandLogo:p.settings.platform.logo};
 const allVersions=workspaceVersions(w),selectedId=w.datasets.some(d=>d.id===raw.selectedId)?raw.selectedId:w.datasets[0]?.id||'',modelRequest=request?.target===view?request:null;
 const group=settingsActive?{id:'settings',label:'系统设置'}:groups.find(g=>(view==='pipeline'&&g.id==='datasets')||(view==='task-plan'&&g.id==='projects')||g.id===view||g.children?.some(c=>c[0]===view)||(g.id==='datasets'&&view==='quality'))||{id:'operations',label:'运营与恢复'};
 const record=(event,base=ref.current)=>({id:`BUSINESS-${Date.now()}-${++sequence.current}`,at:new Date().toISOString(),actor:base.settings.users.find(u=>u.id===base.actorId)?.name||base.actorId,spaceId:base.activeSpaceId,space:base.settings.spaces.find(s=>s.id===base.activeSpaceId)?.name,result:'成功',before:{},after:{},...event});
 function ctx(base=ref.current,working=base.workspaces[base.activeSpaceId]){const q=base.settings.quotas.find(q=>q.spaceId===base.activeSpaceId);return {versions:workspaceVersions(working),acceptanceFactory:(model,source,action)=>makeEvaluationAcceptance(working,model,source,action),modelState:working.modelState,textBatches:working.textBatches,imageBatches:working.imageBatches,apps:base.settings.apiApps,spaceId:base.activeSpaceId,concurrency:q?.concurrency??0,gpu:q?.gpu??0}}
 function saveWorkspace(next,events=[],base=ref.current,alerts=true,workspaceId=base.activeSpaceId){
  const previous=base.workspaces[workspaceId];let completion=next.completion,settings=base.settings;
  if(alerts)for(const failure of failureTransitions(previous,next)){
   const alertResult=applyCompletionAction(completion,{type:'recordAlert',target:failure,reason:failure.reason,at:new Date().toISOString()},ctx(base,next));completion=alertResult.state;
   const eventName={training:'训练任务失败',deployment:'服务部署失败',evaluation:'评测失败',index:'知识索引失败',document:'文档解析失败'}[failure.type];
   const deliveries=[];
   for(const rule of settings.notificationRules.filter(r=>r.enabled&&r.spaceId===workspaceId&&(r.event===eventName||r.event==='任务失败'))){
    const last=settings.notificationDeliveries.find(d=>d.ruleId===rule.id&&d.target?.id===failure.id&&!d.test);if(last&&Date.now()-Date.parse(last.at)<rule.interval*60000)continue;
    const channel=settings.notificationChannels.find(c=>c.id===rule.channelId);deliveries.push({id:`NOTICE-${Date.now()}-${++sequence.current}`,ruleId:rule.id,spaceId:workspaceId,at:new Date().toISOString(),event:eventName,rule:rule.name,space:base.settings.spaces.find(s=>s.id===workspaceId)?.name,object:failure.id,recipient:rule.recipient,channel:channel?.name||rule.channelId,result:channel?.tested?'模拟成功':'模拟失败',status:channel?.tested?'success':'failed',reason:channel?.tested?'本地模拟通知；未发送邮件':'通知渠道尚未通过本地验证',test:false,target:failure});
   }
   if(deliveries.length)settings={...settings,notificationDeliveries:[...deliveries,...settings.notificationDeliveries]};
  }
  const knowledgeSources=completion.sourceVersions;const documentSet=completion.documents;
  const updated={...next,datasets:next.datasets.map(d=>d.id==='knowledge'?{...d,total:documentSet.length,status:knowledgeSources.length?'published':documentSet.some(d=>d.status==='failed')?'cleaning':'production',version:knowledgeSources[0]?.version||'未发布'}:d),completion,events:[...events.map(e=>record(e,{...base,activeSpaceId:workspaceId})),...next.events]};
  commit({...base,settings,workspaces:{...base.workspaces,[workspaceId]:updated}});return updated;
 }
 function denied(error,action='业务操作'){
  const base=ref.current,old=base.workspaces[base.activeSpaceId];saveWorkspace(old,[{action,object:'当前业务范围',result:'拒绝',details:error}],base,false);notify(error,'warning');return {ok:false,error};
 }
 function gate(permission,projectId){const base=ref.current;const a=canAccess(base.settings,base.actorId,base.activeSpaceId,permission,projectId);if(!a.ok)denied(a.error,`权限检查：${permission}`);return a.ok}
 const navigate=useCallback((target,context={})=>{
  const base=ref.current,working=base.workspaces[base.activeSpaceId];const prepared=target==='datasets'&&context.versionId&&working.flow?.versions.find(v=>v.id===context.versionId);if(prepared){target='pipeline';context={...context,jobId:prepared.jobId,mode:working.flow.jobs.find(j=>j.id===prepared.jobId)?.kind||'aggregation'}}if(context.datasetId)commit({...base,workspaces:{...base.workspaces,[base.activeSpaceId]:{...working,selectedId:context.datasetId}}});
  setView(target);setSeen(old=>old.includes(target)?old:[...old,target]);if(productionViews.includes(target))setProductionView(target);
  const key=++sequence.current;setRequest({...context,target,key});setDatasetRequest(target==='datasets'&&(context.tab||context.versionId)?{...context,key}:null);if(target==='ingestion')setIngestionRequest({...context,key});
  const g=groups.find(g=>(target==='pipeline'&&g.id==='datasets')||(target==='task-plan'&&g.id==='projects')||g.id===target||g.children?.some(c=>c[0]===target)||(g.id==='datasets'&&target==='quality'));if(g?.children)setExpanded(g.id);setGlobalSearch('');setMobileNav(false);window.scrollTo({top:0,behavior:'instant'});try{history.replaceState(null,'',target.startsWith('settings-')?`#settings/${target.slice(9)}`:location.pathname+location.search)}catch{}
 },[commit]);
 function onDeliveryAction(action){
  const base=ref.current,old=base.workspaces[base.activeSpaceId];
  const r=applyWorkspaceDelivery(old,base.settings,base.actorId,base.activeSpaceId,action);
  if(!r.ok)return denied(r.error,'交付：'+action.type);
  saveWorkspace(r.workspace,[{action:'交付：'+action.type,object:r.order.id,after:{status:r.order.status,versionId:r.order.versionId}}],base);return r;
 }
 function onModelAction(action,internal=false){
  const base=ref.current,old=base.workspaces[base.activeSpaceId];let authorization;if(!internal){const access=authorizeAction(base.settings,base.actorId,base.activeSpaceId,old,'model',action);if(!access.ok)return denied(access.error,action.type);authorization=access;}
  const environment=ctx(base,old);environment.externalRunning=old.completion.indexes.filter(i=>i.status==='running').length;
  const result=applyModelLifecycleAction(old.modelState,{...action,at:new Date().toISOString()},environment);
  if(result.state&&result.state!==old.modelState)saveWorkspace(recordGovernanceUse({...old,modelState:result.state},'model',action,authorization?.governance,result.entity,new Date().toISOString()),result.events,base);else if(result.events?.length)saveWorkspace(old,result.events,base);
  return result;
 }
 function onFlowAction(action){
   const base=ref.current,old=base.workspaces[base.activeSpaceId];const access=authorizeAction(base.settings,base.actorId,base.activeSpaceId,old,'flow',action);if(!access.ok)return denied(access.error,action.type);
   const result=applyProductionFlowAction(old,{...action,at:new Date().toISOString()},{spaceId:base.activeSpaceId,actorId:base.actorId,actorName:base.settings.users.find(u=>u.id===base.actorId)?.name});
   if(!result.ok)return denied(result.error,action.type);
   const added=result.workspace.production.projects.filter(pr=>!base.settings.projects.some(p=>p.id===pr.id&&p.spaceId===base.activeSpaceId));
   const settings=added.length?{...base.settings,projects:[...base.settings.projects,...added.map(pr=>({id:pr.id,name:pr.name,spaceId:base.activeSpaceId,ownerId:base.actorId}))],members:base.settings.members.map(m=>m.userId===base.actorId&&m.spaceId===base.activeSpaceId?{...m,projectIds:[...new Set([...m.projectIds,...added.map(pr=>pr.id)])]}:m)}:base.settings;
   saveWorkspace(recordGovernanceUse(result.workspace,'flow',action,access.governance,result.entity,new Date().toISOString()),result.events,{...base,settings});return result;
  }
 function onGovernanceAction(action){
  const base=ref.current,old=base.workspaces[base.activeSpaceId],access=authorizeAction(base.settings,base.actorId,base.activeSpaceId,old,'governance',action);if(!access.ok)return denied(access.error,action.type);
  const result=applyGovernanceAction(old,{...action,at:new Date().toISOString()},{actorId:base.actorId,actorName:base.settings.users.find(u=>u.id===base.actorId)?.name,isAdmin:['platform-admin','space-admin'].includes(access.role?.id),users:base.settings.users.filter(u=>canAccess(base.settings,u.id,base.activeSpaceId,'view').ok),canApproveUser:(id,projectId)=>canAccess(base.settings,id,base.activeSpaceId,'approve',projectId).ok});if(!result.ok)return denied(result.error,action.type);if(result.workspace!==old)saveWorkspace(result.workspace,result.events,base);return result;
 }
 function onAIAction(action){
  const base=ref.current,old=base.workspaces[base.activeSpaceId];const access=authorizeAction(base.settings,base.actorId,base.activeSpaceId,old,'annotation',action);if(!access.ok)return denied(access.error,action.type);
  const result=applyAIAnnotationAction(old,{...action,at:new Date().toISOString()},{actorId:base.actorId,actorName:base.settings.users.find(u=>u.id===base.actorId)?.name,roleId:access.role?.id,canRun:(projectId,actorId)=>canAccess(base.settings,actorId,base.activeSpaceId,'run',projectId).ok});
  if(!result.ok)return denied(result.error,action.type);if(result.workspace!==old)saveWorkspace(recordGovernanceUse(result.workspace,'annotation',action,access.governance,result.entity,new Date().toISOString()),result.events,base);return result;
 }
  function onAction(action,internal=false){
  const base=ref.current,old=base.workspaces[base.activeSpaceId];let authorization;if(!internal){const access=authorizeAction(base.settings,base.actorId,base.activeSpaceId,old,'completion',action);if(!access.ok)return denied(access.error,action.type);authorization=access;}
  const environment=ctx(base,old);environment.externalRunning=old.modelState.trainings.filter(t=>t.status==='running').length;
  const result=applyCompletionAction(old.completion,{...action,at:new Date(Date.now()+old.completion.clockOffset).toISOString()},environment);
  if(result.state!==old.completion)saveWorkspace(recordGovernanceUse({...old,completion:result.state},'completion',action,authorization?.governance,result.entity,new Date().toISOString()),result.events,base);else if(!result.ok)saveWorkspace(old,[{action:action.type,result:'拒绝',details:result.error}],base,false);
  return result;
 }
 function onDataAction(kind,datasetId,action){
  const base=ref.current,old=base.workspaces[base.activeSpaceId],key=kind==='image'?'imageBatches':'textBatches',batch=old[key][datasetId];
  const authorization=authorizeAction(base.settings,base.actorId,base.activeSpaceId,old,'data',{...action,datasetId});if(!authorization.ok)return denied(authorization.error,action.type);
  if(!batch)return denied('批次不存在。',action.type);for(const projectId of batch.sourceProjects||[])if(!gate(permissionFor('data',action.type),projectId))return {ok:false,error:'父来源项目不在授权范围。'};
   if(!gate(permissionFor('data',action.type),batch?.projectId))return {ok:false,error:'当前成员没有执行此操作的权限。'};
  if(action.type==='selectQualityRules'){const rule=action.ruleVersionId?old.flow?.ruleVersions.find(r=>r.id===action.ruleVersionId&&r.projectId===batch.projectId):null;if(action.ruleVersionId&&!rule)return denied('所选规则不属于本项目。',action.type);const next={...batch,ruleModuleSnapshot:rule?clone(rule):null,revision:batch.revision+1,quality:batch.quality?{...batch.quality,status:'stale'}:null};saveWorkspace({...old,[key]:{...old[key],[datasetId]:next}},[{action:'选择批次质量规则',object:batch.name,after:{规则版本:rule?.id||'基础规则'}}],base);return {ok:true,batch:next};}
   // Non-manager editors operate only on records assigned to their simulated identity.
  const access=canAccess(base.settings,base.actorId,base.activeSpaceId,'edit',batch?.projectId);
  const row=batch?.records.find(r=>r.id===(action.recordId||action.taskId)),name=base.settings.users.find(u=>u.id===base.actorId)?.name;
  if(['saveDraft','submit','resubmit'].includes(action.type)&&access.role?.id==='annotator'&&(row?.annotator||row?.assignee)!==name)return denied('此样本未分配给当前标注员。',action.type);
  if(['approve','reject'].includes(action.type)&&canAccess(base.settings,base.actorId,base.activeSpaceId,'approve',batch?.projectId).role?.preventSelfReview&&(row?.annotator||row?.assignee)===name)return denied('当前规范禁止审核本人标注的样本。',action.type);
  if(action.type==='assign'&&!canAccess(base.settings,base.actorId,base.activeSpaceId,'members',batch?.projectId).ok&&access.role?.id!=='project-manager')return denied('只有项目负责人或管理员可以分配任务。',action.type);
  const role=base.settings.roles.find(r=>r.id===base.settings.members.find(m=>m.userId===base.actorId&&m.spaceId===base.activeSpaceId)?.roleId);
  if(['approve','reject'].includes(action.type)&&role?.sampleScope==='assigned'&&row?.reviewerId!==base.actorId)return denied('此样本未分配给当前审核员。',action.type);
  if(action.type==='assignReviewer'){
   if(!canAccess(base.settings,base.actorId,base.activeSpaceId,'members',batch?.projectId).ok&&role?.id!=='project-manager')return denied('只有项目负责人或管理员可以分配审核员。',action.type);
   if(!canAccess(base.settings,action.reviewerId,base.activeSpaceId,'approve',batch?.projectId).ok)return denied('所选成员没有该项目的审核权限。',action.type);
   const next={...batch,revision:batch.revision+1,quality:batch.quality?{...batch.quality,status:'stale'}:null,records:batch.records.map(r=>({...r,reviewerId:action.reviewerId}))};saveWorkspace({...old,[key]:{...old[key],[datasetId]:next}},[{action:'分配审核员',object:batch.name,after:{审核员:action.reviewerId}}],base);return {ok:true,batch:next};
  }
  const result=(kind==='image'?applyImageBatchAction:applyTextBatchAction)(batch,{...action,actor:name,at:new Date().toISOString()});
  let next=result.batch||batch;if(result.ok&&action.type==='assign')next={...next,records:next.records.map(r=>({...r,reviewerId:r.reviewerId||base.actorId}))};const count=kind==='image'?imageBatchCounts(next):textBatchCounts(next);
  const datasets=result.ok?old.datasets.map(d=>d.id===datasetId?{...d,total:kind==='image'||next.stage==='cleaned'?next.records.length:next.rawRecords.length,status:next.stage==='ingested'?'cleaning':next.versions.some(v=>v.sourceRevision===next.revision)?'published':count.approved===count.total&&count.total?'ready':'production',version:next.versions[0]?.version||'未发布'}:d):old.datasets;
  saveWorkspace(recordGovernanceUse({...old,datasets,[key]:{...old[key],[datasetId]:next}},'data',{...action,datasetId},authorization.governance,result.version||next,new Date().toISOString()),[{action:`${kind==='image'?'图片':'文本'} · ${action.type}`,object:batch?.name,result:result.ok?'成功':'拒绝',details:result.error||action.note||'',after:{项目编号:next?.projectId,批次编号:next?.batchId,版本编号:result.version?.id,修订:next?.revision,冻结记录:result.version?.count}}],base);return result;
 }
 function createDataset(data,kind='text'){
  const base=ref.current,old=base.workspaces[base.activeSpaceId];if(!gate('edit',data.projectId))return null;
  const id=`${kind}-${base.activeSpaceId}-${uniqueId()}`,at=new Date().toISOString();let batch;
  try{data=bindTaskPlan(old,data,kind,data.sourceKind||(kind==='image'?(data.records?.some(r=>r.source==='upload')?'local':'demo'):data.importReport?'local':'demo'));batch=kind==='image'?createImageBatch({...data,datasetId:id,at}):createTextBatch({...data,datasetId:id,at})}catch(error){notify(error.message,'warning');return null}
  const key=kind==='image'?'imageBatches':'textBatches',total=kind==='image'?batch.records.length:batch.rawRecords.length;
  saveWorkspace({...old,selectedId:id,[key]:{...old[key],[id]:batch},datasets:[...old.datasets,{id,name:batch.name,type:kind,total,status:kind==='image'?'production':'cleaning',owner:base.settings.users.find(u=>u.id===base.actorId)?.name,version:'未发布',description:'实际接入记录、生产任务和发布版本使用同一来源。'}]},[{action:`接入${kind==='image'?'图片':'文本'}批次`,object:batch.name,after:{项目编号:batch.projectId,批次编号:batch.batchId,记录数量:total}}],base);return id;
 }
 function onImproveFeedback(feedbackId){
  const base=ref.current,old=base.workspaces[base.activeSpaceId],f=old.completion.feedback.find(f=>f.id===feedbackId);
  if(!f||f.status!=='open')return {ok:false,error:'反馈已进入处理，不能重复建立改进批次。'};
  const origin=f.originSnapshot,service=old.modelState.services.find(s=>s.id===origin.serviceId),snapshot=service?.dataVersion;
  const spec=snapshot?.specSnapshot||old.production.projects.find(p=>p.id==='PRJ-001')?.specSnapshot;
  if(snapshot?.type==='image'){
   if(!spec.labels.some(l=>(typeof l==='string'?l:l.name)===f.expected)&&f.expected!=='无缺陷')return {ok:false,error:'图像反馈的正确结果请选择冻结规范中的缺陷类别，或填写“无缺陷”。'};
   const source=snapshot.records.find(r=>r.id===f.input)||snapshot.records[0];
   const datasetId=createDataset({name:`图像反馈改进 ${f.id}`,projectId:snapshot.projectId,projectName:snapshot.projectName,specSnapshot:spec,records:[{...clone(source),feedbackId:f.id,originSnapshot:clone(f.originSnapshot)}]},'image');
   if(!datasetId)return {ok:false,error:'图片改进批次未能创建。'};return onAction({type:'linkFeedbackBatch',feedbackId:f.id,datasetId});
  }
  if(!spec?.labels.some(l=>(typeof l==='string'?l:l.name)===f.expected))return {ok:false,error:'正确结果必须是来源分类规范中的标签；知识问答请使用“进入知识改进问答”。'};
  const datasetId=createDataset({name:`反馈改进 ${f.id}`,projectId:snapshot?.projectId||'PRJ-001',projectName:snapshot?.projectName||'客户反馈意图分类',specSnapshot:spec,rawRecords:[{id:`${f.id}-sample`,text:f.input,referenceLabel:f.expected,feedbackId:f.id,originSnapshot:clone(f.originSnapshot)}]});
  if(!datasetId)return {ok:false,error:'改进批次创建失败。'};
  return onAction({type:'linkFeedbackBatch',feedbackId:f.id,datasetId});
 }
 const onProductionChange=useCallback(next=>{
  const base=ref.current,old=base.workspaces[base.activeSpaceId];next={...next,projects:[...old.production.projects.filter(pr=>!next.projects.some(p=>p.id===pr.id)),...next.projects]};if(JSON.stringify(next)===JSON.stringify(old.production))return;
  if(!canAccess(base.settings,base.actorId,base.activeSpaceId,'edit').ok)return;
  const newProjects=next.projects.filter(pr=>!base.settings.projects.some(p=>p.id===pr.id&&p.spaceId===base.activeSpaceId));
  const settings=newProjects.length?{...base.settings,projects:[...base.settings.projects,...newProjects.map(pr=>({id:pr.id,name:pr.name,spaceId:base.activeSpaceId,ownerId:base.actorId}))],members:base.settings.members.map(m=>m.userId===base.actorId&&m.spaceId===base.activeSpaceId?{...m,projectIds:[...new Set([...m.projectIds,...newProjects.map(pr=>pr.id)])]}:m)}:base.settings;
  commit({...base,settings,workspaces:{...base.workspaces,[base.activeSpaceId]:{...old,production:next}}});
 },[commit]);
 function onSettingsChange(update){
  const base=ref.current;if(!gate('members'))return;const next=typeof update==='function'?update(base.settings):update;
  let activeSpaceId=base.activeSpaceId,workspaces=base.workspaces;
  if(next.currentSpaceId!==base.settings.currentSpaceId&&canAccess(next,base.actorId,next.currentSpaceId,'view').ok){activeSpaceId=next.currentSpaceId;workspaces={...workspaces,[activeSpaceId]:workspaces[activeSpaceId]||makeWorkspace(false)}}
  commit({...base,settings:next,activeSpaceId,workspaces});
 }
 function switchSpace(id){const base=ref.current;const access=canAccess(base.settings,base.actorId,id,'view');if(!access.ok){notify(access.error,'warning');return}commit({...base,activeSpaceId:id,settings:{...base.settings,currentSpaceId:id},workspaces:{...base.workspaces,[id]:base.workspaces[id]||makeWorkspace(false)}});setResetKey(k=>k+1);setSeen(['workbench']);setView('workbench');try{history.replaceState(null,'',location.pathname+location.search)}catch{}setProductionView('projects');setRequest(null);setDatasetRequest(null);setIngestionRequest(null);}
 function switchActor(actorId){const base=ref.current;commit({...base,actorId});setResetKey(k=>k+1);setSeen(['workbench']);setView('workbench');try{history.replaceState(null,'',location.pathname+location.search)}catch{}setRequest(null);setDatasetRequest(null);}
 function exportSnapshot(){if(!gate('members'))return;try{downloadText('创平数智工场-完整会话快照.json',encodeSnapshot(ref.current));notify('完整会话快照已生成，包含实际原图和所有业务来源。')}catch(error){notify(error.message,'warning')}}
 function restoreSnapshot(next){if(!gate('members'))return {ok:false,error:'需要空间管理权限恢复完整会话。'};try{const verified=decodeSnapshot(encodeSnapshot(next));undo.current=clone(ref.current);setCanUndo(true);commit(enableGovernance({...verified.platform,settings:{...verified.platform.settings,platform:{...verified.platform.settings.platform,name:PRODUCT_NAME}}}));setResetKey(k=>k+1);setSeen(['workbench']);setView('workbench');try{history.replaceState(null,'',location.pathname+location.search)}catch{}setRequest(null);setDatasetRequest(null);notify('会话已恢复，所有业务版本与来源关系已保留。');return {ok:true}}catch(error){return {ok:false,error:error.message}}}
 function undoRestore(){if(!gate('members')||!undo.current)return;const old=undo.current;undo.current=null;setCanUndo(false);commit(old);setResetKey(k=>k+1);setSeen(['workbench']);setView('workbench');try{history.replaceState(null,'',location.pathname+location.search)}catch{}notify('已回到恢复前的原型会话。')}
 function resetDemo(){if(!gate('members'))return;undo.current=clone(ref.current);setCanUndo(true);commit(makePlatform());setResetKey(k=>k+1);setSeen(['datasets']);setView('datasets');setDemoInfo(false);notify('已重置演示。需要时可在运营与恢复中撤销这次重置。')}
 useEffect(()=>{let cancelled=false;loadSaved().then(saved=>{if(!cancelled&&saved)commit(enableGovernance({...saved,settings:{...saved.settings,platform:{...saved.settings.platform,name:PRODUCT_NAME}}}))}).catch(()=>{if(!cancelled)setSaveStatus('无法读取本地保存，可导入完整快照')}).finally(()=>{if(!cancelled)setLoaded(true)});return()=>{cancelled=true}},[commit]);
 useEffect(()=>{if(!loaded)return;const generation=++saveGeneration.current;setSaveStatus('正在自动保存');const timeout=setTimeout(()=>saveCurrent(platform).then(()=>{if(generation===saveGeneration.current)setSaveStatus('已保存到本浏览器')}).catch(()=>{if(generation===saveGeneration.current)setSaveStatus('自动保存失败，请导出完整快照')}),200);return()=>clearTimeout(timeout)},[platform,loaded]);
 useEffect(()=>{if(!loaded)return;const interval=setInterval(()=>{
  for(const id of Object.keys(ref.current.workspaces)){
   let base=ref.current,old=base.workspaces[id],quota=base.settings.quotas.find(q=>q.spaceId===id),env={versions:workspaceVersions(old),concurrency:quota?.concurrency??0,gpu:quota?.gpu??0,externalRunning:old.completion.indexes.filter(i=>i.status==='running').length};
   const halted=haltGovernedWork(old,new Date().toISOString());if(halted.workspace!==old){saveWorkspace(halted.workspace,halted.events,base,true,id);base=ref.current;old=base.workspaces[id];}
   if(modelLifecycleHasWork(old.modelState)){const result=applyModelLifecycleAction(old.modelState,{type:'tick',at:new Date().toISOString()},env);if(result.state!==old.modelState)saveWorkspace({...old,modelState:result.state},result.events,base,true,id)}
   base=ref.current;old=base.workspaces[id];
   if(old.aiAnnotation?.jobs.some(j=>j.status==='running')){const result=applyAIAnnotationAction(old,{type:'advancePredictionJobs',at:new Date().toISOString()},{canRun:(projectId,actorId)=>canAccess(base.settings,actorId,id,'run',projectId).ok,checkJob:j=>checkGovernanceAction(old,'annotation',{type:'startPredictionJob',jobId:j.id},{at:new Date().toISOString()}).error||''});if(result.workspace!==old)saveWorkspace(result.workspace,result.events,base,true,id);base=ref.current;old=base.workspaces[id];}
   if(old.completion.indexes.some(i=>['queued','running'].includes(i.status))){const result=applyCompletionAction(old.completion,{type:'tick',at:new Date().toISOString()},{...ctx({...base,activeSpaceId:id},old),externalRunning:old.modelState.trainings.filter(t=>t.status==='running').length});if(result.state!==old.completion)saveWorkspace({...old,completion:result.state},result.events,base,true,id)}
  }
 },650);return()=>clearInterval(interval)},[loaded]);
 useEffect(()=>{const media=window.matchMedia('(max-width:820px)'),change=e=>setIsMobile(e.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change)},[]);
 useEffect(()=>{globalThis.__prototypeAuthorizeExport=()=>gate('export');return()=>{delete globalThis.__prototypeAuthorizeExport;clearTimeout(timer.current)}},[]);
 const runtimeTasks=useMemo(()=>Object.entries(p.workspaces).flatMap(([id,w])=>resourceTasks(w,id)),[p.workspaces]);
 const visibleSettings=useMemo(()=>({...p.settings,platform:brand,currentActorId:p.actorId,currentSpaceId:spaceId,resourceTasks:runtimeTasks,quotas:p.settings.quotas.map(q=>{const current=p.workspaces[q.spaceId];const jobs=current?resourceTasks(current,q.spaceId):[];return {...q,usedGpu:current?.modelState.trainings.filter(t=>t.status==='running').length||0,usedConcurrency:jobs.filter(j=>j.status==='running').length,usedStorageGB:current?Number((JSON.stringify(current).length/1e9).toFixed(4)):0}})}),[p.settings,p.workspaces,p.actorId,spaceId,runtimeTasks]);
 const suggestions=[...Object.entries(titles),...w.datasets.map(d=>[`ds:${d.id}`,d.name])].filter(([id,title])=>title.includes(globalSearch)).slice(0,7);
 const access=canAccess(p.settings,p.actorId,spaceId,'view');
 const common={w,platform:p,onDeliveryAction,onFlowAction,onAIAction,onGovernanceAction,onNavigate:navigate,onToast:notify,onAction,onImproveFeedback,request:modelRequest,active:true,versions:allVersions,apps:p.settings.apiApps.filter(a=>a.spaceId===spaceId),saveStatus,onExport:exportSnapshot,onRestore:restoreSnapshot,onUndoRestore:undoRestore,canUndo};
 if(!loaded)return <div className="cl-readonly"><h2>正在读取创平数智工场会话…</h2></div>;
 return <div className={`app-shell ${settingsActive?'settings-active':''}`}><header className="topbar"><div className="brand-area"><button className="icon-button mobile-menu" aria-label="打开导航" onClick={()=>setMobileNav(!mobileNav)}><IconMenu2 size={22}/></button><button className="brand" onClick={()=>navigate('workbench')}><img src={brand.logo} alt=""/><strong>{brand.name}</strong></button><select className="cl-space-select" aria-label="当前业务空间" value={spaceId} onChange={e=>switchSpace(e.target.value)}>{p.settings.spaces.filter(s=>s.status==='active'&&p.settings.members.some(m=>m.userId===p.actorId&&m.spaceId===s.id&&m.status==='active')).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></div><div className="breadcrumb"><span>{group.label}</span>{group.id!=='workbench'&&<><span className="slash">/</span><strong>{titles[view]}</strong></>}</div><div className="topbar-actions"><div className="global-search"><IconSearch size={18}/><input aria-label="搜索功能或数据集" placeholder="搜索功能" value={globalSearch} onChange={e=>setGlobalSearch(e.target.value)}/>{globalSearch&&<div className="search-results"><div className="menu-caption">快速前往</div>{suggestions.map(([id,title])=><button key={id} onClick={()=>id.startsWith('ds:')?navigate('datasets',{datasetId:id.slice(3)}):navigate(id)}>{title}</button>)}</div>}</div><span className="cl-save-status">{saveStatus}</span><select className="cl-identity" aria-label="模拟操作成员" value={p.actorId} onChange={e=>switchActor(e.target.value)}>{p.settings.users.filter(u=>u.status==='active').map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select><button className="demo-pill" onClick={()=>setDemoInfo(true)}>本地演示</button></div></header>{mobileNav&&<div className="sidebar-scrim" onClick={()=>setMobileNav(false)}/>}<aside className={`sidebar ${mobileNav?'open':''}`} aria-label="主导航" aria-hidden={isMobile&&!mobileNav} inert={isMobile&&!mobileNav}><nav>{groups.map(g=>{const Icon=g.icon;return <div className="nav-group" key={g.id}><button className={`nav-main ${group.id===g.id?'active':''}`} onClick={()=>{if(g.children){setExpanded(expanded===g.id?'':g.id);if(group.id!==g.id)navigate(g.id)}else navigate(g.id)}}><Icon size={21} stroke={1.5}/><span>{g.label}</span>{g.children&&<IconChevronDown size={15}/>}</button>{g.children&&expanded===g.id&&<div className="nav-subitems">{g.children.map(([id,label])=><button key={id} className={`nav-sub ${view===id?'active':''}`} onClick={()=>navigate(id)}><span className="nav-dot"/>{label}</button>)}</div>}</div>})}</nav><div className="sidebar-footer"><button className={`nav-main ${view==='operations'?'active':''}`} onClick={()=>navigate('operations')}><IconHistory size={20}/><span>运营与恢复</span></button><button className={`nav-main ${settingsActive?'active':''}`} onClick={()=>navigate('settings-general')}><IconSettings size={20}/><span>系统设置</span></button></div></aside>
 <main className="main-content" key={`${spaceId}-${resetKey}`}>{['datasets','processing','review','quality','ai-annotation','training','evaluation','deployments','testing'].includes(view)&&<GovernanceEntry w={w} datasetId={selectedId} onNavigate={navigate}/>}{view==='processing'&&<div className="p1-entry"><Button onClick={()=>navigate('pipeline',{mode:'aggregation'})}>多来源汇聚</Button><Button onClick={()=>navigate('pipeline',{mode:'enhancement'})}>独立数据增强</Button><Button onClick={()=>navigate('pipeline',{mode:'rules'})}>质量规则模块</Button><Button onClick={()=>navigate('pipeline',{mode:'reports'})}>输入质评与历史</Button></div>}{view==='quality'&&(w.textBatches[selectedId]||w.imageBatches[selectedId])&&<BatchRulePanel batch={w.textBatches[selectedId]||w.imageBatches[selectedId]} flow={w.flow} canModify={canAccess(p.settings,p.actorId,spaceId,'approve',(w.textBatches[selectedId]||w.imageBatches[selectedId]).projectId).ok} onSelect={ruleVersionId=>onDataAction(w.imageBatches[selectedId]?'image':'text',selectedId,{type:'selectQualityRules',ruleVersionId})}/>}{view==='review'&&<div className="ai-review-entry"><Button onClick={()=>navigate('ai-annotation',{datasetId:selectedId})}>AI 预标注与模型版本</Button></div>}{view==='review'&&(w.textBatches[selectedId]||w.imageBatches[selectedId])&&canAccess(p.settings,p.actorId,spaceId,'edit',(w.textBatches[selectedId]||w.imageBatches[selectedId]).projectId).ok&&<ReviewAssignmentPanel key={selectedId} batch={w.textBatches[selectedId]||w.imageBatches[selectedId]} settings={p.settings} spaceId={spaceId} onAssign={reviewerId=>onDataAction(w.imageBatches[selectedId]?'image':'text',selectedId,{type:'assignReviewer',reviewerId})}/>}<>{!access.ok?<Empty title="当前成员无法访问此空间" description={access.error}/>:<>
 <div hidden={!productionViews.includes(view)}>{view==='processing'&&selectedId==='knowledge'?<KnowledgeView {...common}/>:<ProductionViews key={`production-${resetKey}`} view={productionView} active={productionViews.includes(view)} productionState={w.production} onProductionChange={onProductionChange} onPlanTask={context=>navigate('task-plan',context)} onCanEdit={()=>gate('edit')} onNavigate={navigate} onToast={notify} onCreateDataset={createDataset} onCreateImageDataset={data=>createDataset(data,'image')} imageBatches={w.imageBatches} knowledgeState={w.completion} ingestionRequest={ingestionRequest} counts={w.reviewState.counts} datasetCount={w.datasets.length} processingDatasetId={selectedId} onDatasetProcessed={data=>onDataAction('text',data.id,{type:'clean',rules:data.rules})} textBatches={w.textBatches}/>}</div>
 {seen.filter(id=>!productionViews.includes(id)&&!id.startsWith('settings-')).map(id=><div key={id} hidden={view!==id}>{id==='deliveries'?<DeliveryView key={spaceId+':'+p.actorId} {...common} request={request?.target==='deliveries'?request:null}/>:id==='governance'?<GovernanceView {...common} active={view===id}/>:id==='ai-annotation'?<AIAnnotationView {...common} active={view===id}/>:id==='task-plan'?<TaskPlanningView {...common}/>:id==='pipeline'?<ProductionFlowView {...common} active={view===id}/>:id==='workbench'?<WorkbenchView {...common}/>:id==='knowledge'?<KnowledgeView {...common} active={view===id}/>:id==='agents'||id==='canvas'?<AgentsView {...common} view={id} active={view===id}/>:id==='feedback'?<FeedbackView {...common} active={view===id}/>:id==='marketplace'?<MarketplaceView {...common} active={view===id}/>:id==='operations'?(canAccess(p.settings,p.actorId,spaceId,'members').ok?<OperationsView {...common} active={view===id}/>:<Empty title="运营控制需要空间管理权限"/>):modelViews.includes(id)?<ModelViews governanceWorkspace={w} view={id} active={view===id} onNavigate={navigate} onToast={notify} versions={allVersions} trainingRequest={request?.target==='training'&&request.versionId?request:null} modelState={w.modelState} onModelAction={onModelAction} modelRequest={modelRequest}/>:w.datasets.length?<DataViews view={id} active={view===id} onNavigate={navigate} onToast={notify} datasets={w.datasets} selectedId={selectedId} onSelect={id=>{const base=ref.current;commit({...base,workspaces:{...base.workspaces,[spaceId]:{...base.workspaces[spaceId],selectedId:id}}});setDatasetRequest(null)}} versions={w.versions} setVersions={value=>{const base=ref.current,old=base.workspaces[spaceId];const auth=authorizeAction(base.settings,base.actorId,spaceId,old,'data',{type:'publish',datasetId:'customer'});if(!auth.ok){denied(auth.error,'发布预置版本');return false;}saveWorkspace({...old,versions:typeof value==='function'?value(old.versions):value},[{action:'发布预置数据版本',object:'customer'}],base);return true;}} knowledgeState={w.completion} tasks={w.reviewState.tasks} onReview={(id,status,label,note)=>{const base=ref.current,old=base.workspaces[spaceId];const auth=authorizeAction(base.settings,base.actorId,spaceId,old,'data',{type:status==='approved'?'approve':status==='rework'?'reject':'resubmit',datasetId:'customer'});if(!auth.ok){denied(auth.error,'预置样本审核');return false;}const next=transitionReviewState(old.reviewState,{id,status,label,note,at:new Date().toISOString()});if(next===old.reviewState)return false;saveWorkspace({...old,reviewState:next},[{action:'预置样本审核',object:id,after:{状态:status}}],base);return true}} counts={w.reviewState.counts} datasetRequest={datasetRequest} textBatches={w.textBatches} onTextAction={(id,a)=>onDataAction('text',id,a)} imageBatches={w.imageBatches} onImageAction={(id,a)=>onDataAction('image',id,a)}/>:<Empty title="当前空间没有可访问的数据集" description="新建项目后接入本空间数据，或切换有权限的空间。"><Button onClick={()=>navigate('projects')}>新建项目</Button></Empty>}</div>)}
 {canAccess(p.settings,p.actorId,spaceId,'members').ok&&<div hidden={!settingsActive}><SettingsApp active={settingsActive} page={settingsActive?view.slice(9):'general'} sessionControls={{onExport:exportSnapshot,onRestore:restoreSnapshot,onUndoRestore:undoRestore,canUndo,saveStatus}} controlledState={visibleSettings} onStateChange={onSettingsChange} onNavigate={navigate} onToast={notify} datasets={w.datasets} versions={allVersions} businessEvents={Object.values(p.workspaces).flatMap(w=>w.events)} managedServices={w.modelState.services}/></div>}{settingsActive&&!canAccess(p.settings,p.actorId,spaceId,'members').ok&&<Empty title="系统设置需要管理权限" description="请在顶栏切换模拟成员查看角色权限的不同效果。"/>}</>}</></main>
 {toast&&<div className={`toast toast-${toast.tone}`} role="status">{toast.tone==='warning'?<IconAlertCircle size={19}/>:<IconCheck size={19}/>}<span>{toast.text}</span><button className="icon-button" aria-label="关闭提示" onClick={()=>setToast(null)}><IconX size={16}/></button></div>}
 {demoInfo&&<Modal title="创平数智工场 · 本地交互原型" onClose={()=>setDemoInfo(false)} footer={<><Button onClick={resetDemo}>重置演示</Button><Button variant="primary" onClick={()=>setDemoInfo(false)}>继续体验</Button></>}><p>文本和图片生产、模型生命周期、知识索引、智能体、反馈改进、资产授权与业务治理使用共享业务对象。真实本地文本和图片会保存在本浏览器，刷新后可继续；跨电脑请导出完整会话快照。</p><p>训练、评测、索引、推理、通知和资源分配仍为明确的本地模拟。顶栏可切换模拟成员和空间，验证权限与隔离；没有接入真实账号、Label Studio、GPU 或远程 API。</p><p>PDF/Word OCR、真正向量搜索与后端部署属于后端工程。知识入口支持实际 TXT/Markdown 正文和引用位置，索引采用本地关键词匹配。</p></Modal>}</div>
}
