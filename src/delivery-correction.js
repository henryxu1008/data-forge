import {workspaceVersions} from './platform-policy.js';
import {deliveryAccess,deliveryEligibility} from './delivery-platform.js';
import {createTextBatch,applyTextBatchAction} from './text-production-state.js';
import {createImageBatch} from './image-production-state.js';
import {applyWorkOrder} from './production-workflow.js';
import {operationScope} from './governance-sources.js';
export function createDeliveryCorrection(w,settings,actorId,space,a,at=new Date().toISOString()){
 const denied=error=>({ok:false,error}),access=deliveryAccess(w,settings,actorId,space,{type:'requestRevision',orderId:a.orderId});if(!access.ok)return access;
 const o=w.delivery.orders.find(o=>o.id===a.orderId),f=o.feedback.find(f=>f.id===a.feedbackId);
 if(o.status!=='accepted'||!f||f.status!=='open')return denied('请选择已验收交付的未关闭售后反馈');
 const previous=f.revisionId?w.delivery.orders.find(x=>x.id===f.revisionId):null;
 const retry=!!f.correction&&!!previous&&['rejected','cancelled'].includes(previous.status)&&!previous.revisions.some(id=>w.delivery.orders.some(x=>x.id===id&&x.status!=='cancelled'));
 if((f.correction||f.revisionId)&&!retry)return denied('已有纠错或补交正在处理；仅被拒收或取消的纠错补交可建立下一轮');
 const v=retry?previous.versionSnapshot:o.versionSnapshot;if(!v?.specSnapshot||!v.records?.length||!deliveryEligibility(w,v.id,o.projectId,at).ok)return denied('原交付冻结版本缺失或许可已失效');
 if(JSON.stringify(v)!==JSON.stringify(workspaceVersions(w).find(x=>x.id===v.id)))return denied('原冻结版本内容已改变，请先核查来源');
 const next=structuredClone(w),datasetId=`correction-${o.id}-${f.id}${retry?'-retry-'+((f.correctionHistory?.length||0)+2):''}`;
 if(next.textBatches[datasetId]||next.imageBatches[datasetId])return denied('纠错批次已存在');
 const rows=v.records.map(r=>({id:r.id,text:r.text,channel:r.channel,referenceLabel:r.label,name:r.name,src:r.src,width:r.width,height:r.height,mimeType:r.mimeType,source:r.source,description:r.description,feedbackId:f.id,originSnapshot:{versionId:v.id,recordId:r.id},parents:[{versionId:v.id,recordId:r.id}]}));
 const args={datasetId,name:`${o.id} 客户反馈纠错`,projectId:o.projectId,projectName:v.projectName||o.projectId,specSnapshot:v.specSnapshot,taskPlan:v.taskPlan,at};
 let batch;
 try{batch=v.type==='image'?createImageBatch({...args,records:rows}):createTextBatch({...args,rawRecords:rows});if(v.type!=='image'){const r=applyTextBatchAction(batch,{type:'clean',rules:{trim:false,dedupe:false,empty:false,pii:false},at});if(!r.ok)return r;batch=r.batch;}}catch(e){return denied(e.message);}
 batch.sourceProjects=[...new Set([...(v.sourceProjects||[]),...operationScope(w,'completion',{type:'listAsset',assetId:`data:${v.id}`}).projects])];
 if(v.ruleModuleSnapshot)batch.ruleModuleSnapshot=structuredClone(v.ruleModuleSnapshot);
 batch.correction={orderId:o.id,feedbackId:f.id,sourceVersionId:o.versionId,inputVersionId:v.id};
 next[v.type==='image'?'imageBatches':'textBatches'][datasetId]=batch;next.datasets.push({id:datasetId,name:batch.name,type:v.type==='image'?'image':'text',total:rows.length,status:'production',version:'未发布'});
 const sourceTask=w.workOrders?.orders.find(t=>t.datasetId===v.datasetId);
 const inherited={...(sourceTask?.approvalChain?{approvalChain:[a.reviewerId,...sourceTask.approvalChain.slice(1)]}:{}),...(sourceTask?.samplingPolicy?{samplingPolicy:sourceTask.samplingPolicy}:{})};
 const r=applyWorkOrder(next,settings,actorId,space,{type:'create',datasetId,assigneeId:a.assigneeId,reviewerId:a.reviewerId,dueAt:a.dueAt,...inherited},at);if(!r.ok)return r;
 const order=r.workspace.delivery.orders.find(x=>x.id===o.id),feedback=order.feedback.find(x=>x.id===f.id);
 if(retry){feedback.correctionHistory=[...(feedback.correctionHistory||[]),{...feedback.correction,revisionId:f.revisionId,at,actorId}];delete feedback.revisionId;}
 feedback.correction={datasetId,taskId:r.task.id,sourceVersionId:o.versionId,inputVersionId:v.id};order.history.push({action:'createCorrection',actorId,at,note:a.note||f.note});r.workspace.delivery.events.unshift({orderId:o.id,action:'createCorrection',actorId,at,status:o.status});return {...r,order};
}
