import {approvalActor,approvalIndex,approvalLabels} from './production-approvals.js';
import {operationScope} from './governance-sources.js';
import {createDeliveryState,deliveryTodos} from './delivery-lifecycle-state.js';
import {flowActionProjects,visibleProductionFlow} from './p1-production-flow.js';
import {annotationActionProjects,visibleAIAnnotation} from './ai-annotation-state.js';
import {checkGovernanceAction,governanceActionProjects,visibleGovernance} from './governance-state.js';
export const clone=value=>JSON.parse(JSON.stringify(value));
export function permissionFor(kind,type){
 if(kind==='model')return ['startTraining','retryTraining','cancelTraining','startEvaluation'].includes(type)?'train':['publishService','retryDeployment','offlineService'].includes(type)?'publish':'run';
  if(kind==='data')return type==='publish'?'publish':['approve','reject','checkQuality','reopen','selectQualityRules'].includes(type)?(type==='reject'?'reject':'approve'):'edit';
  if(kind==='flow')return type==='publishJob'?'publish':['reviewJob','assessJob','assessVersion','selectJobRules'].includes(type)?'approve':'edit';
 if(kind==='annotation')return ['createPredictionJob','startPredictionJob','retryPredictionJob','cancelPredictionJob','advancePredictionJobs'].includes(type)?'run':'edit';
 if(kind==='governance')return ['decideCharter','closeCharter','decideAdmission','revokeAdmission','reviewEvidence','recordAcceptance'].includes(type)?'approve':'edit';
 return ['publishKnowledge','listAsset','delistAsset','grantAsset','revokeGrant'].includes(type)?'publish':['approveQA','rejectQA','reopenQA'].includes(type)?(type==='rejectQA'?'reject':'approve'):['runAgent','retrieve','accessAsset','verifyFeedback'].includes(type)?'run':['ackAlert','closeAlert','setClock'].includes(type)?'members':'edit';
}
export function canAccess(settings,actorId,spaceId,permission='view',projectId){
 const space=settings.spaces.find(x=>x.id===spaceId&&x.status==='active');
 const user=settings.users.find(x=>x.id===actorId&&x.status==='active');
 const member=settings.members.find(x=>x.userId===actorId&&x.spaceId===spaceId&&x.status==='active');
 const role=settings.roles.find(x=>x.id===member?.roleId);
 if(!space||!user||!member||!role)return {ok:false,error:'当前成员或空间已停用，业务访问被拒绝。'};
 if(!role.permissions.includes(permission))return {ok:false,error:`当前角色“${role.name}”没有${({view:'查看',edit:'编辑',publish:'发布',approve:'审核',reject:'退回',train:'训练',run:'调用',export:'导出',members:'管理'})[permission]||permission}权限。`};
 const admin=['space-admin','platform-admin'].includes(role.id);
 if(projectId&&!admin&&role.projectScope==='owned'&&settings.projects.find(p=>p.id===projectId&&p.spaceId===spaceId)?.ownerId!==actorId)return {ok:false,error:'该项目不由当前成员负责。'};
 if(projectId&&!admin&&!member.projectIds.includes(projectId))return {ok:false,error:'该项目不在当前成员的授权范围。'};
 return {ok:true,member,role};
}
export function workspaceVersions(w){return [
  ...Object.values(w.textBatches).flatMap(b=>b.versions),...Object.values(w.imageBatches).flatMap(b=>b.versions),...(w.flow?.versions||[]),
 ...w.versions.map(v=>({...clone(v),id:`customer:${v.version}`,datasetId:'customer',datasetName:'客户反馈意图分类',projectId:'PRJ-001',projectName:'客户反馈意图分类',batchId:'CUSTOMER-DEMO'}))
];}
export function visibleWorkspace(w,settings,actorId,spaceId){
 const allowed=project=>canAccess(settings,actorId,spaceId,'view',project).ok;const visibleSource=v=>!!v&&allowed(v.projectId)&&(v.sourceProjects||[]).every(allowed);
 const datasetProject=d=>w.textBatches[d.id]?.projectId||w.imageBatches[d.id]?.projectId||({customer:'PRJ-001',knowledge:'PRJ-002',defects:'PRJ-003'})[d.id];
 const datasets=w.datasets.filter(d=>allowed(datasetProject(d))&&((w.textBatches[d.id]||w.imageBatches[d.id])?.sourceProjects||[]).every(allowed));
 const ids=new Set(datasets.map(d=>d.id));const model=w.modelState;
 const services=model.services.filter(x=>visibleSource(x.modelSnapshot.dataVersion)&&visibleSource(x.evaluationSnapshot?.dataVersion));
 const completion=clone(w.completion);
 for(const key of ['documents','qas','sourceVersions','agents'])completion[key]=completion[key].filter(x=>allowed(x.projectId));
 const sourceIds=new Set(completion.sourceVersions.map(x=>x.id));
 completion.libraries=completion.libraries.filter(l=>allowed(l.projectId||'PRJ-002')&&(!l.sourceVersionId||sourceIds.has(l.sourceVersionId)));
 const libraryIds=new Set(completion.libraries.map(x=>x.id));completion.indexes=completion.indexes.filter(x=>libraryIds.has(x.libraryId));completion.retrievals=completion.retrievals.filter(x=>libraryIds.has(x.libraryId));
 const agentIds=new Set(completion.agents.map(x=>x.id));completion.runs=completion.runs.filter(x=>agentIds.has(x.agentId)&&x.dependencies.every(d=>(!d.service||visibleSource(d.service.dataVersion)&&visibleSource(d.service.evaluationSnapshot?.dataVersion))&&(!d.index||allowed(d.index.sourceSnapshot.projectId))));
 const callIds=new Set(model.calls.filter(c=>services.some(s=>s.id===c.serviceId)).map(c=>c.id));
 completion.feedback=completion.feedback.filter(f=>f.originType==='agent'?completion.runs.some(r=>r.id===f.originId):callIds.has(f.originId));
 completion.listings=completion.listings.filter(l=>allowed(l.assetSnapshot.projectId)&&(l.assetSnapshot.snapshot?.dataVersion?.sourceProjects||l.assetSnapshot.snapshot?.sourceProjects||[]).every(allowed));const listingIds=new Set(completion.listings.map(l=>l.id));completion.grants=completion.grants.filter(g=>listingIds.has(g.listingId));completion.accesses=completion.accesses.filter(a=>completion.grants.some(g=>g.id===a.grantId));
 if(!canAccess(settings,actorId,spaceId,'members').ok)completion.alerts=[];
 const delivery=clone(w.delivery||createDeliveryState());delivery.orders=delivery.orders.filter(o=>allowed(o.projectId)&&(o.versionSnapshot?.sourceProjects||[]).every(allowed)&&operationScope(w,'completion',{type:'listAsset',assetId:`data:${o.versionId}`}).projects.every(allowed));const deliveryIds=new Set(delivery.orders.map(o=>o.id));delivery.events=delivery.events.filter(e=>deliveryIds.has(e.orderId));
 const workOrders=w.workOrders?{...w.workOrders,orders:w.workOrders.orders.filter(t=>ids.has(t.datasetId))}:undefined;
 return {...w,...(workOrders?{workOrders}:{}),delivery,governance:visibleGovernance(w.governance,allowed),aiAnnotation:visibleAIAnnotation(w.aiAnnotation,allowed),flow:visibleProductionFlow(w.flow,allowed),production:{...w.production,projects:w.production.projects.filter(pr=>allowed(pr.id))},datasets,textBatches:Object.fromEntries(Object.entries(w.textBatches).filter(([k])=>ids.has(k))),imageBatches:Object.fromEntries(Object.entries(w.imageBatches).filter(([k])=>ids.has(k))),versions:allowed('PRJ-001')?w.versions:[],modelState:{...model,trainings:model.trainings.filter(t=>visibleSource(t.dataVersion)),models:model.models.filter(m=>visibleSource(m.dataVersion)),evaluations:model.evaluations.filter(e=>visibleSource(e.modelSnapshot.dataVersion)&&visibleSource(e.dataVersion)),services,calls:model.calls.filter(c=>callIds.has(c.id))},completion};
}
export function unifiedTodos(w){
 const tasks=deliveryTodos(w.delivery||createDeliveryState()).map(o=>({id:'delivery:'+o.id,orderId:o.id,name:o.id,detail:`交付${({draft:'待准备',submitted:'待验收',rejected:'待补交',accepted:'反馈待处理'})[o.status]} · ${o.feedbackOpen} 条反馈`,target:'deliveries'}));
 for(const t of w.workOrders?.orders||[])if(t.status!=='accepted')tasks.push({id:'work:'+t.id,taskId:t.id,name:t.name,assigneeId:t.status==='review'?approvalActor(t):t.assigneeId,detail:'生产工单 · '+(t.status==='review'&&t.approvalChain?approvalLabels[approvalIndex(t)]+'待处理':({assigned:'待领取',claimed:'生产中',review:'待验收',rework:'待返工',disputed:'待仲裁'})[t.status]),target:'work-orders',datasetId:t.datasetId});
 for(const j of w.aiAnnotation?.jobs||[])if(['queued','failed','cancelled'].includes(j.status))tasks.push({id:j.id,name:j.name,detail:`AI 预标注${({queued:'待启动',failed:'失败待处理',cancelled:'已取消'})[j.status]}`,target:'ai-annotation',datasetId:j.datasetId,jobId:j.id});
 if(w.datasets.some(d=>d.id==='customer'))for(const status of ['review','rework']){const count=w.reviewState.tasks.filter(r=>r.status===status).length;if(count)tasks.push({id:`customer:${status}`,name:'客户反馈预置样例',detail:`${count} 条${status==='review'?'待审核':'需返工'}（实际样例）`,target:'review',datasetId:'customer'})}
 for(const b of [...Object.values(w.textBatches),...Object.values(w.imageBatches)]){
  if(b.stage==='ingested'){tasks.push({id:`${b.id}:clean`,name:b.name,detail:`${b.rawRecords.length} 条待清洗`,target:'processing',datasetId:b.datasetId});continue}
  for(const status of ['todo','review','rework']){const count=b.records.filter(r=>r.status===status).length;if(count)tasks.push({id:`${b.id}:${status}`,name:b.name,detail:`${count} ${b.type==='image'?'张':'条'}${({todo:'待标注',review:'待审核',rework:'需返工'})[status]}`,target:'review',datasetId:b.datasetId})}
  if(b.records.some(r=>r.status==='approved')&&!b.versions.some(v=>v.sourceRevision===b.revision))tasks.push({id:`${b.id}:quality`,name:b.name,detail:'通过范围待质检发布',target:'quality',datasetId:b.datasetId});
 }
 for(const d of w.completion.documents.filter(d=>d.status==='failed'))tasks.push({id:d.id,name:d.name,detail:'文档解析异常',target:'knowledge',documentId:d.id});
 for(const q of w.completion.qas.filter(q=>['review','rework','draft'].includes(q.status)))tasks.push({id:q.id,name:q.question,detail:({review:'问答待审核',rework:'问答需返工',draft:'问答待提交'})[q.status],target:'knowledge',qaId:q.id});
 for(const f of w.completion.feedback.filter(f=>f.status!=='closed'))tasks.push({id:f.id,name:f.input,detail:'应用反馈待改进复测',target:'feedback',feedbackId:f.id});
 for(const t of w.modelState.trainings.filter(t=>['failed','cancelled','queued'].includes(t.status)))tasks.push({id:t.id,name:t.name,detail:({failed:'训练失败待重试',cancelled:'训练取消可重试',queued:'配额排队中'})[t.status],target:'training',trainingId:t.id});
 for(const alert of w.completion.alerts.filter(a=>a.status!=='closed'))tasks.push({id:alert.id,name:alert.reason,detail:'业务告警待处理',target:'operations'});
 return tasks;
}
// Resolve all cross-center references before a UI action reaches a reducer.
export function actionProjects(w,kind,a){
 const projects=new Set();const add=p=>{if(p)projects.add(p)};const s=w.completion,m=w.modelState;
 const service=id=>m.services.find(x=>x.id===id),index=id=>s.indexes.find(x=>x.id===id),agent=s.agents.find(x=>x.id===a.agentId);
 add(a.projectId);
 if(kind==='data')add((w.textBatches[a.datasetId]||w.imageBatches[a.datasetId])?.projectId);
 if(kind==='model'){for(const v of [workspaceVersions(w).find(v=>v.id===a.dataVersionId),m.trainings.find(t=>t.id===a.trainingId)?.dataVersion,m.models.find(x=>x.id===a.modelVersionId)?.dataVersion,service(a.serviceId)?.dataVersion])for(const p of v?.sourceProjects||[])add(p);add(workspaceVersions(w).find(v=>v.id===a.dataVersionId)?.projectId);add(m.trainings.find(t=>t.id===a.trainingId)?.dataVersion.projectId);add(m.models.find(x=>x.id===a.modelVersionId)?.projectId);add(service(a.serviceId)?.modelSnapshot.projectId);add(m.evaluations.find(x=>x.id===a.evaluationId)?.modelSnapshot.projectId)}
 if(kind==='completion'){const addVersion=v=>{add(v?.projectId);for(const p of v?.sourceProjects||[])add(p)};for(const n of a.nodes||(a.type==='runAgent'?agent?.nodes:[])||[])addVersion(service(n.config?.serviceId)?.dataVersion);const lineageCall=m.calls.find(c=>c.id===a.callId),lineageFeedback=s.feedback.find(f=>f.id===a.feedbackId),origin=lineageFeedback?.originSnapshot;for(const d of (s.runs.find(r=>r.id===a.runId)?.dependencies||origin?.dependencies||[]))addVersion(d.service?.dataVersion);addVersion(service(lineageCall?.serviceId||origin?.serviceId)?.dataVersion);const g=s.grants.find(g=>g.id===a.grantId),l=s.listings.find(l=>l.id===(a.listingId||g?.listingId));addVersion(l?.assetSnapshot.snapshot?.dataVersion||l?.assetSnapshot.snapshot);if(a.assetId?.startsWith('data:'))addVersion(workspaceVersions(w).find(v=>`data:${v.id}`===a.assetId));if(a.assetId?.startsWith('service:'))addVersion(service(a.assetId.slice(8))?.dataVersion);
  if(['ingestDocument','createAgent','createLibrary'].includes(a.type))add(a.projectId||'PRJ-002');
  add(s.documents.find(d=>d.id===a.documentId)?.projectId);add(s.qas.find(q=>q.id===a.qaId)?.projectId);add(s.sourceVersions.find(v=>v.id===a.sourceVersionId)?.projectId);add(agent?.projectId);
  const lib=s.libraries.find(l=>l.id===a.libraryId);add(lib?.projectId);add(s.sourceVersions.find(v=>v.id===lib?.sourceVersionId)?.projectId);add(index(a.indexId)?.sourceSnapshot.projectId);
  const grant=s.grants.find(g=>g.id===a.grantId),listing=s.listings.find(l=>l.id===(a.listingId||grant?.listingId));add(listing?.assetSnapshot.projectId);
  if(a.assetId?.startsWith('data:'))add(workspaceVersions(w).find(v=>`data:${v.id}`===a.assetId)?.projectId);
  if(a.assetId?.startsWith('service:'))add(service(a.assetId.slice(8))?.modelSnapshot.projectId);
  if(a.assetId?.startsWith('index:'))add(index(a.assetId.slice(6))?.sourceSnapshot.projectId);
  const feedback=s.feedback.find(f=>f.id===a.feedbackId),run=s.runs.find(r=>r.id===(a.runId||(feedback?.originType==='agent'?feedback?.originId:null))),call=m.calls.find(c=>c.id===(a.callId||(feedback?.originType==='service'?feedback?.originId:null)));
  add(s.agents.find(x=>x.id===run?.agentId)?.projectId);add(service(call?.serviceId)?.modelSnapshot.projectId);
  for(const node of a.nodes||(a.type==='runAgent'?agent?.nodes:[])||[]){add(service(node.config?.serviceId)?.modelSnapshot.projectId);add(index(node.config?.indexId)?.sourceSnapshot.projectId)}
  add((w.textBatches[a.datasetId]||w.imageBatches[a.datasetId])?.projectId);
 }
  if(kind==='flow')for(const p of flowActionProjects(w,a))add(p);
 if(kind==='annotation')for(const p of annotationActionProjects(w,a))add(p);
 if(kind==='governance')for(const p of governanceActionProjects(w,a))add(p);
  return [...projects];
}
export function authorizeAction(settings,actorId,spaceId,w,kind,a){const permission=permissionFor(kind,a.type);const scope=canAccess(settings,actorId,spaceId,permission);if(!scope.ok)return scope;for(const project of actionProjects(w,kind,a)){const access=canAccess(settings,actorId,spaceId,permission,project);if(!access.ok)return access}const governance=checkGovernanceAction(w,kind,a,{at:a.at||new Date().toISOString()});if(!governance.ok)return governance;return {...scope,governance}}
