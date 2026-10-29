import {workspaceVersions} from './platform-policy.js';
import {deliveryAccess,deliveryEligibility} from './delivery-platform.js';
import {createTextBatch,applyTextBatchAction} from './text-production-state.js';
import {createImageBatch} from './image-production-state.js';
import {applyWorkOrder} from './production-workflow.js';
import {operationScope} from './governance-sources.js';
export function createDeliveryCorrection(w,settings,actorId,space,a,at=new Date().toISOString()){
 const denied=error=>({ok:false,error}),access=deliveryAccess(w,settings,actorId,space,{type:'requestRevision',orderId:a.orderId});if(!access.ok)return access;
 const o=w.delivery.orders.find(o=>o.id===a.orderId),f=o.feedback.find(f=>f.id===a.feedbackId);
 if(o.status!=='accepted'||!f||f.status!=='open'||f.correction||f.revisionId)return denied('请选择尚未关联补交或纠错工单的未关闭售后反馈');
 const v=o.versionSnapshot;if(!v?.specSnapshot||!v.records?.length||!deliveryEligibility(w,o.versionId,o.projectId,at).ok)return denied('原交付冻结版本缺失或许可已失效');
 if(JSON.stringify(v)!==JSON.stringify(workspaceVersions(w).find(x=>x.id===o.versionId)))return denied('原冻结版本内容已改变，请先核查来源');
 const next=structuredClone(w),datasetId=`correction-${o.id}-${f.id}`;
 if(next.textBatches[datasetId]||next.imageBatches[datasetId])return denied('纠错批次已存在');
 const rows=v.records.map(r=>({id:r.id,text:r.text,channel:r.channel,referenceLabel:r.label,name:r.name,src:r.src,width:r.width,height:r.height,mimeType:r.mimeType,source:r.source,description:r.description,feedbackId:f.id,originSnapshot:{versionId:v.id,recordId:r.id},parents:[{versionId:v.id,recordId:r.id}]}));
 const args={datasetId,name:`${o.id} 客户反馈纠错`,projectId:o.projectId,projectName:v.projectName||o.projectId,specSnapshot:v.specSnapshot,taskPlan:v.taskPlan,at};
 let batch;
 try{batch=v.type==='image'?createImageBatch({...args,records:rows}):createTextBatch({...args,rawRecords:rows});if(v.type!=='image'){const r=applyTextBatchAction(batch,{type:'clean',rules:{trim:false,dedupe:false,empty:false,pii:false},at});if(!r.ok)return r;batch=r.batch;}}catch(e){return denied(e.message);}
 batch.sourceProjects=operationScope(w,'completion',{type:'listAsset',assetId:`data:${v.id}`}).projects;
 batch.correction={orderId:o.id,feedbackId:f.id,sourceVersionId:v.id};
 next[v.type==='image'?'imageBatches':'textBatches'][datasetId]=batch;next.datasets.push({id:datasetId,name:batch.name,type:v.type==='image'?'image':'text',total:rows.length,status:'production',version:'未发布'});
 const r=applyWorkOrder(next,settings,actorId,space,{type:'create',datasetId,assigneeId:a.assigneeId,reviewerId:a.reviewerId,dueAt:a.dueAt},at);if(!r.ok)return r;
 const order=r.workspace.delivery.orders.find(x=>x.id===o.id),feedback=order.feedback.find(x=>x.id===f.id);
 feedback.correction={datasetId,taskId:r.task.id,sourceVersionId:v.id};order.history.push({action:'createCorrection',actorId,at,note:a.note||f.note});r.workspace.delivery.events.unshift({orderId:o.id,action:'createCorrection',actorId,at,status:o.status});return {...r,order};
}
