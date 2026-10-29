import {validSamplingPolicy,applySampling,samplingPassed,validateSampling} from './production-sampling.js';
import {canAccess,authorizeAction} from './platform-policy.js';
import {applyTextBatchAction} from './text-production-state.js';
import {applyImageBatchAction} from './image-production-state.js';
const fail=error=>({ok:false,error});
export const workStatuses={assigned:'待领取',claimed:'生产中',review:'待批次验收',rework:'待返工',disputed:'待仲裁',accepted:'已验收'};
export const workOrderFor=(w,id)=>w.workOrders?.orders.find(t=>t.datasetId===id);
const batchFor=(w,id)=>w.textBatches[id]||w.imageBatches[id];
const isManager=(s,u,space,p)=>{const a=canAccess(s,u,space,'edit',p);return a.ok&&(a.role.id==='project-manager'||canAccess(s,u,space,'members',p).ok)};
function scope(w,s,u,space,b,permission){
 if(!b||!s.projects.some(p=>p.id===b.projectId&&p.spaceId===space))return fail('生产批次或项目不存在');
 for(const p of new Set([b.projectId,...(b.sourceProjects||[])])){const r=canAccess(s,u,space,permission,p);if(!r.ok)return r;}
 return {ok:true};
}
export function applyWorkOrder(w,s,actorId,space,a,at=new Date().toISOString()){
 if(!Number.isFinite(Date.parse(at)))return fail('操作时间无效');
 const old=w.workOrders||{sequence:0,orders:[]},existing=old.orders.find(t=>t.id===a.taskId),b=batchFor(w,a.type==='create'?a.datasetId:existing?.datasetId);
 const permission=a.type==='return'?'reject':['accept','arbitrate','startSampling','recordSampling','finishSampling'].includes(a.type)?'approve':'edit';const access=scope(w,s,actorId,space,b,permission);if(!access.ok)return access;
 const management=['create','reassign'].includes(a.type);if(management&&!isManager(s,actorId,space,b.projectId))return fail('只有项目负责人或管理员可以分派工单');
 // Handling a rejection/dispute is allowed after revocation; production and acceptance are not.
 if(['create','claim','submit','accept','startSampling','recordSampling','finishSampling'].includes(a.type)){
  const g=authorizeAction(s,actorId,space,w,'data',{type:['accept','startSampling','recordSampling','finishSampling'].includes(a.type)?'checkQuality':'submit',datasetId:b.datasetId,at});if(!g.ok)return g;
 }
 const next=structuredClone(w);next.workOrders=structuredClone(old);let task=next.workOrders.orders.find(t=>t.id===a.taskId),batch=batchFor(next,b.datasetId);
 function assign(user,reviewer,due){
  if(user===reviewer||!scope(w,s,user,space,b,'edit').ok||!scope(w,s,reviewer,space,b,'approve').ok)return fail('标注人与审核人必须不同，且均具备项目及父来源权限');
  if(!Number.isFinite(Date.parse(due))||Date.parse(due)<=Date.parse(at))return fail('截止时间必须晚于当前时间');
  const name=s.users.find(u=>u.id===user)?.name;
  const fn=b.type==='image'?applyImageBatchAction:applyTextBatchAction;
  const pending=batch.records.filter(r=>['todo','rework'].includes(r.status));
  if(pending.some(r=>(b.type==='image'?r.assignee:r.annotator)!==name)){
   const ids=pending.map(r=>r.id),r=fn(batch,{type:'assign',assignee:name,...(b.type==='image'?{recordIds:ids}:{sampleIds:ids}),at});if(!r.ok)return r;batch=r.batch;
  }
  batch.records=batch.records.map(r=>r.reviewerId===reviewer?r:{...r,reviewerId:reviewer});
  next[b.type==='image'?'imageBatches':'textBatches'][b.datasetId]=batch;return {ok:true};
 }
 if(a.type==='create'){
  if(a.samplingPolicy&&!validSamplingPolicy(a.samplingPolicy))return fail('抽检比例和合格阈值须在 0–100 之间，最低样本数须为正整数');
  if(workOrderFor(w,b.datasetId))return fail('该批次已关联生产工单');
  if(!b.records.length||b.records.some(r=>!['todo','rework'].includes(r.status))||b.versions.length)return fail('请选择已清洗、未发布且尚未提交审核的批次');
  const result=assign(a.assigneeId,a.reviewerId,a.dueAt);if(!result.ok)return result;
  task={id:'WORK-'+(++next.workOrders.sequence),datasetId:b.datasetId,projectId:b.projectId,name:b.name,assigneeId:a.assigneeId,reviewerId:a.reviewerId,dueAt:a.dueAt,status:'assigned',history:[],acceptedRevision:null,...(a.samplingPolicy?{samplingPolicy:structuredClone(a.samplingPolicy),samplingRounds:[]}: {})};next.workOrders.orders.unshift(task);
 }else{
  if(!task)return fail('工单不存在');
  const operator=task.assigneeId===actorId,reviewer=task.reviewerId===actorId;
  if(['return','dispute','arbitrate','reassign'].includes(a.type)&&!a.note?.trim())return fail('请填写处理原因');
  switch(a.type){
   case 'startSampling':case 'recordSampling':case 'finishSampling':{const result=applySampling(task,batch,a,actorId,at);if(!result.ok)return result;break;}
   case 'claim':if(!operator||!['assigned','rework'].includes(task.status))return fail('仅指定标注人可领取待办');task.status='claimed';break;
   case 'submit':if(!operator||task.status!=='claimed'||batch.records.some(r=>!['review','approved'].includes(r.status)))return fail('须由领取人提交，且全部样本已提交审核');task.status='review';break;
   case 'accept':if(!samplingPassed(task,batch))return fail('当前修订抽检未通过，不能验收');if(!reviewer||task.status!=='review'||batch.records.some(r=>r.status!=='approved')||batch.quality?.status!=='passed'||(batch.quality.revision??batch.quality.sourceRevision)!==batch.revision)return fail('须由指定审核人验收，全部样本审核通过且当前修订质检通过');task.status='accepted';task.acceptedRevision=batch.revision;task.acceptedBy=actorId;break;
   case 'return':if(!reviewer||task.status!=='review')return fail('仅指定审核人可退回待验收工单');{const fn=b.type==='image'?applyImageBatchAction:applyTextBatchAction;for(const row of [...batch.records]){if(!['review','approved'].includes(row.status))continue;const r=fn(batch,{type:row.status==='review'?'reject':'reopen',taskId:row.id,recordId:row.id,note:a.note,at});if(!r.ok)return r;batch=r.batch;}next[b.type==='image'?'imageBatches':'textBatches'][b.datasetId]=batch;}if(task.samplingRounds?.length){const round=task.samplingRounds.at(-1);if(!round.returnedAt){round.returnedAt=at;round.returnReason=a.note;}}task.status='rework';task.returnReason=a.note;break;
   case 'dispute':if(!operator||task.status!=='rework')return fail('仅标注人可对退回结果提起争议');task.status='disputed';break;
   case 'arbitrate':if(task.status!=='disputed'||operator||reviewer||!['rework','review'].includes(a.decision))return fail('须由独立审核成员仲裁，选择重新返工或重新审核');if(a.decision==='review'){const fn=b.type==='image'?applyImageBatchAction:applyTextBatchAction;for(const row of [...batch.records]){if(!['todo','rework'].includes(row.status))continue;const r=fn(batch,{type:b.type!=='image'&&row.status==='rework'?'resubmit':'submit',taskId:row.id,recordId:row.id,label:row.label,note:a.note,at});if(!r.ok)return r;batch=r.batch;}next[b.type==='image'?'imageBatches':'textBatches'][b.datasetId]=batch;}task.status=a.decision;break;
   case 'reassign':{
    if(!['assigned','claimed','rework'].includes(task.status)||Date.parse(at)<=Date.parse(task.dueAt)||a.assigneeId===task.assigneeId)return fail('仅超时的未完成工单可转派给其他成员');
    // Submitted rows keep their original annotator, content and history; only pending work is reassigned.
    const result=assign(a.assigneeId,task.reviewerId,a.dueAt);if(!result.ok)return result;task.assigneeId=a.assigneeId;task.dueAt=a.dueAt;task.status='assigned';break;
   }
   default:return fail('不支持的工单操作');
  }
 }
 task.history.push({action:a.type,actorId,at,note:a.note||'',status:task.status,assigneeId:task.assigneeId,reviewerId:task.reviewerId});
 return {ok:true,workspace:next,task};
}
// Apply before every existing sample mutation; unmanaged batches retain their original behavior.
export function checkWorkOrderData(w,actorId,datasetId,a){
 const t=workOrderFor(w,datasetId);if(!t)return {ok:true};const b=batchFor(w,datasetId);
 if(['assign','assignReviewer','clean'].includes(a.type))return fail('该批次由生产工单统一分派，不能直接改派或清洗');
 if(a.type==='publish')return t.status==='accepted'&&t.acceptedRevision===b.revision?{ok:true}:fail('须先完成当前修订的工单验收再发布');
 if(['saveDraft','submit','resubmit'].includes(a.type))return t.status==='claimed'&&t.assigneeId===actorId?{ok:true}:fail('须先领取工单，且只能由指定标注人生产');
 if(['approve','reject','checkQuality'].includes(a.type))return t.status==='review'&&t.reviewerId===actorId?{ok:true}:fail('须提交工单后，由指定审核人处理');
 if(a.type==='reopen')return t.status==='claimed'&&t.assigneeId===actorId?{ok:true}:fail('仅返工领取后可重新打开样本');
 if(a.type==='selectQualityRules')return ['assigned','claimed'].includes(t.status)?{ok:true}:fail('审核期间不能变更质量规则');
 return fail('该操作不适用于受工单管理的批次');
}
export function validateWorkOrders(w,settings,space){
 if(w.workOrders===undefined){if(w.delivery?.orders.some(o=>o.feedback.some(f=>f.correction)))throw Error('纠错反馈缺少生产工单。');return;}
 const bad=()=>{throw Error('生产工单快照或批次关联无效。')},state=w.workOrders;
 if(!state||!Number.isSafeInteger(state.sequence)||state.sequence<0||!Array.isArray(state.orders))bad();
 const ids=new Set(),datasets=new Set();
 for(const t of state.orders){const b=batchFor(w,t.datasetId);
  if(!/^WORK-[1-9]\d*$/.test(t.id)||Number(t.id.slice(5))>state.sequence||ids.has(t.id)||datasets.has(t.datasetId)||!b||b.projectId!==t.projectId||!Object.hasOwn(workStatuses,t.status)||t.assigneeId===t.reviewerId||!Number.isFinite(Date.parse(t.dueAt))||!Array.isArray(t.history)||!t.history.length)bad();
  validateSampling(t,b);ids.add(t.id);datasets.add(t.datasetId);
  if(t.history.some(h=>!settings.users.some(u=>u.id===h.actorId)||!Number.isFinite(Date.parse(h.at))||!Object.hasOwn(workStatuses,h.status))||b.records.some(r=>r.reviewerId!==t.reviewerId))bad();
  if(![t.assigneeId,t.reviewerId].every(id=>settings.users.some(u=>u.id===id))||!settings.projects.some(p=>p.id===t.projectId&&p.spaceId===space))bad();
  if(t.status==='accepted'&&(t.acceptedBy!==t.reviewerId||t.acceptedRevision!==b.revision||(b.quality?.revision??b.quality?.sourceRevision)!==b.revision||b.records.some(r=>r.status!=='approved')||b.quality?.status!=='passed'))bad();
 }
 for(const o of w.delivery?.orders||[])for(const f of o.feedback){if(!f.correction)continue;const t=state.orders.find(t=>t.id===f.correction.taskId),b=batchFor(w,f.correction.datasetId);if(!t||!b||t.datasetId!==b.datasetId||t.projectId!==o.projectId||b.correction?.orderId!==o.id||b.correction?.feedbackId!==f.id||f.correction.sourceVersionId!==o.versionId||b.correction.sourceVersionId!==o.versionId)bad();}
}
