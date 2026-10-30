import {correctionOwner,correctionVersionMatches} from './delivery-correction-evidence.js';
import {canAccess,workspaceVersions} from './platform-policy.js';
import {checkGovernanceAction} from './governance-state.js';
import {operationScope} from './governance-sources.js';
import {applyDeliveryAction,createDeliveryState,acceptedReplacement} from './delivery-lifecycle-state.js';
const permissions={create:'edit',package:'export',submit:'publish',accept:'approve',reject:'approve',openFeedback:'view',closeFeedback:'edit',requestRevision:'edit',cancel:'edit'};
export function feedbackOrigin(w,orderId){
 for(const o of w.delivery?.orders||[])for(const f of o.feedback)if(f.revisionId===orderId||f.correctionHistory?.some(h=>h.revisionId===orderId))return {orderId:o.id,feedbackId:f.id,managedCorrection:!!f.correction};
 return null;
}
export function deliveryRecipientAccess(w,settings,customerId,spaceId,versionId,projectId){
 const approval=canAccess(settings,customerId,spaceId,'approve',projectId);if(!approval.ok)return approval;
 const v=workspaceVersions(w).find(v=>v.id===versionId&&v.projectId===projectId);if(!v)return {ok:false,error:'验收关联版本不存在'};
 const scope=operationScope(w,'completion',{type:'listAsset',assetId:`data:${v.id}`});
 for(const p of new Set([...(v.sourceProjects||[]),...scope.projects])){const access=canAccess(settings,customerId,spaceId,'view',p);if(!access.ok)return {ok:false,error:'验收成员缺少来源项目的查看权限：'+p};}
 return {ok:true};
}
export function deliveryAccess(w,settings,actorId,spaceId,action){
 const o=w.delivery?.orders.find(o=>o.id===action.orderId);
 const projectId=action.type==='create'?action.projectId:o?.projectId;
 if(!permissions[action.type]||!projectId||!settings.projects.some(p=>p.id===projectId&&p.spaceId===spaceId))return {ok:false,error:'交付操作或项目不存在'};
 const access=canAccess(settings,actorId,spaceId,permissions[action.type],projectId);
 if(!access.ok)return access;
 if(o?.customerId===actorId&&['package','submit','requestRevision'].includes(action.type))return {ok:false,error:'指定验收成员不能制作、提交或创建自己的补交'};
 const version=workspaceVersions(w).find(v=>v.id===(action.newVersionId||action.versionId||o?.versionId));
 if(version){const scope=operationScope(w,'completion',{type:'listAsset',assetId:`data:${version.id}`});for(const p of new Set([...(version.sourceProjects||[]),...scope.projects])){const a=canAccess(settings,actorId,spaceId,'view',p);if(!a.ok)return a;}}
 if(['accept','reject','openFeedback'].includes(action.type)&&o.customerId!==actorId)return {ok:false,error:'只有指定的验收成员可以操作'};
 if(['accept','reject'].includes(action.type)&&o.history.some(h=>['create','createRevision','package','submit'].includes(h.action)&&h.actorId===actorId))return {ok:false,error:'交付制作者不能验收自己的交付'};
 return {ok:true};
}
export function deliveryEligibility(w,versionId,projectId,at=new Date().toISOString()){
 const v=workspaceVersions(w).find(v=>v.id===versionId&&v.projectId===projectId);
 if(!v?.records?.length||v.qualitySnapshot?.status!=='passed')return {ok:false,error:'请选择具有已通过质量报告的非空发布版本'};
 return checkGovernanceAction(w,'completion',{type:'listAsset',assetId:`data:${versionId}`},{at});
}
export function applyWorkspaceDelivery(w,settings,actorId,spaceId,action,at=new Date().toISOString()){
 const access=deliveryAccess(w,settings,actorId,spaceId,action);if(!access.ok)return access;
 const existing=w.delivery?.orders.find(o=>o.id===action.orderId);
 if(['package','submit','accept'].includes(action.type)&&existing?.versionSnapshot&&JSON.stringify(existing.versionSnapshot)!==JSON.stringify(workspaceVersions(w).find(v=>v.id===existing.versionId)))return {ok:false,error:'冻结版本内容发生变化，请建立新的修订交付'};
 if(action.type==='create'&&action.customerId===actorId)return {ok:false,error:'请选择另一名具有本项目审核权限的验收成员'};
 if(['create','requestRevision','submit'].includes(action.type)){
  const recipient=deliveryRecipientAccess(w,settings,action.type==='create'?action.customerId:existing.customerId,spaceId,action.newVersionId||action.versionId||existing?.versionId,action.type==='create'?action.projectId:existing.projectId);if(!recipient.ok)return recipient;
 }
 if(action.type==='requestRevision'&&existing?.status==='rejected'&&correctionOwner(w,existing.id))return {ok:false,error:'此补交关联原纠错工单，请返回原反馈处理，不能换用无关版本'};
 const feedback=existing?.feedback.find(f=>f.id===action.feedbackId);
 if(feedback?.correction&&['closeFeedback','requestRevision'].includes(action.type)){
  const task=w.workOrders?.orders.find(t=>t.id===feedback.correction.taskId);
  if(action.type==='closeFeedback'&&(!feedback.revisionId||!correctionVersionMatches(w,feedback,acceptedReplacement(w.delivery,feedback.revisionId)?.versionId)))return {ok:false,error:'纠错工单必须形成已验收补交后才能关闭反馈'};
  if(action.type==='requestRevision'){if(feedback.revisionId)return {ok:false,error:'请先为原反馈生成新一轮纠错工单，不能重复提交已拒收的纠错版本'};const v=workspaceVersions(w).find(v=>v.id===action.newVersionId);if(task?.status!=='accepted'||v?.datasetId!==feedback.correction.datasetId||v?.sourceRevision!==task.acceptedRevision)return {ok:false,error:'补交必须使用该纠错工单验收后发布的版本'};}
 }
 const r=applyDeliveryAction(w.delivery||createDeliveryState(),action,{actorId,at,canAccess:()=>true,versionEligible:(id,p)=>deliveryEligibility(w,id,p,at).ok});
 if(!r.ok)return r;
 if(['create','requestRevision'].includes(action.type))r.order.versionSnapshot=structuredClone(workspaceVersions(w).find(v=>v.id===r.order.versionId));
 return {...r,workspace:{...w,delivery:r.state}};
}
