import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {applyAIAnnotationAction} from '../src/ai-annotation-state.js';
import {applyTextBatchAction} from '../src/text-production-state.js';
import {createImageBatch,applyImageBatchAction} from '../src/image-production-state.js';
import {applyModelLifecycleAction} from '../src/model-lifecycle-state.js';
import {workspaceVersions} from '../src/platform-policy.js';
import {encodeSnapshot,decodeSnapshot} from '../src/persistence.js';
const original=await fs.readFile('examples/p1-completed-session.json','utf8');const p=decodeSnapshot(original).platform;let w=p.workspaces.demo;
const at='2026-10-27T09:10:00Z';const events=[];
const ai=(type,rest={})=>{const r=applyAIAnnotationAction(w,{type,...rest,at},{actorId:'henry',actorName:'演示管理员'});assert.equal(r.ok,true,r.error);w=r.workspace;for(const e of r.events)events.push(e);return r.entity;};
const data=(type,id,action,rest={})=>{const key=type==='image'?'imageBatches':'textBatches',fn=type==='image'?applyImageBatchAction:applyTextBatchAction,r=fn(w[key][id],{type:action,...rest,at});assert.equal(r.ok,true,r.error);w[key][id]=r.batch;return r;};
const model=(type,rest={})=>{const r=applyModelLifecycleAction(w.modelState,{type,...rest,at},{versions:workspaceVersions(w),concurrency:2,gpu:1});assert.equal(r.ok,true,r.error);w.modelState=r.state;events.push(...r.events);return r.entity;};
function runJob(id,modelVersionId,serviceId,type){ai('bindModel',{datasetId:id,modelVersionId,serviceId});const j=ai('createPredictionJob',{datasetId:id,name:`${type==='image'?'图片':'文本'}批量预标注`,scenario:'fail'});ai('startPredictionJob',{jobId:j.id});for(let i=0;i<4;i++)ai('advancePredictionJobs');assert.equal(w.aiAnnotation.jobs.find(x=>x.id===j.id).status,'failed');ai('retryPredictionJob',{jobId:j.id,scenario:'success',note:'演示失败后重试'});for(let i=0;i<4;i++)ai('advancePredictionJobs');return w.aiAnnotation.jobs.find(x=>x.id===j.id);}
const evidence=[];
for(const type of ['text','image']){
 let b;if(type==='text'){b=ai('createAnnotationBatch',{versionId:'customer:v0.2',name:'AI 标注示例 · 文本第一轮'});data(type,b.datasetId,'clean');}else{const source=w.imageBatches.defects;b=createImageBatch({datasetId:'ai-example-images',name:'AI 标注示例 · 图片第一轮',projectId:source.projectId,projectName:source.projectName,specSnapshot:source.specSnapshot,records:source.records,at});w.imageBatches[b.datasetId]=b;w.datasets.push({id:b.datasetId,name:b.name,type:'image',total:b.records.length,status:'production',version:'未发布'});}
 const id=b.datasetId;data(type,id,'assign',{assignee:'演示管理员'});const first=runJob(id,type==='image'?'SIM-VISION-1':'SIM-TEXT-1',null,type);ai('acceptPredictions',{predictionIds:first.predictionIds});
 const rows=(type==='image'?w.imageBatches:w.textBatches)[id].records;
 for(const r of rows){
  if(type==='image'&&r.boxes.length){const boxes=structuredClone(r.boxes);boxes[0].x=Math.min(r.width-boxes[0].width,boxes[0].x+1);data(type,id,'saveDraft',{recordId:r.id,boxes,noDefect:false,note:'人工核对并修正示意框'});}
  else if(type==='text')data(type,id,'saveDraft',{taskId:r.id,label:r.label,note:'人工核对文本建议'});
  data(type,id,'submit',type==='image'?{recordId:r.id,note:'人工核对后提交'}:{taskId:r.id,note:'人工核对后提交'});data(type,id,'approve',type==='image'?{recordId:r.id,note:'审核通过'}:{taskId:r.id,note:'审核通过'});
 }
 data(type,id,'checkQuality');const version=data(type,id,'publish',{note:'AI 模拟建议经人工校正与审核后发布'}).version;
 model('startTraining',{name:`AI 标注迭代 · ${type}`,base:type==='image'?'YOLOv8':'Qwen2.5-7B-Instruct',dataVersionId:version.id,params:{rank:16,epochs:3,rate:0.0002,batch:4}});const trainingId=w.modelState.trainings[0].id;for(let i=0;i<30&&w.modelState.trainings.find(t=>t.id===trainingId).status!=='completed';i++)model('tick');const m=w.modelState.models.find(m=>m.trainingId===trainingId);assert.ok(m);
 model('startEvaluation',{modelVersionId:m.id,dataVersionId:version.id,scenario:'pass',thresholds:{accuracy:version.taskPlan?.metrics.accuracy||90,macroF1:version.taskPlan?.metrics.macroF1||80}});const evaluationId=w.modelState.evaluations[0].id;for(let i=0;i<20&&w.modelState.evaluations.find(e=>e.id===evaluationId).status==='running';i++)model('tick');
 model('publishService',{modelVersionId:m.id,evaluationId,name:`AI 标注迭代服务 · ${type}`,note:'返回预标注的本地模拟服务'});const serviceId=w.modelState.services[0].id;for(let i=0;i<20&&w.modelState.services.find(s=>s.id===serviceId).status==='deploying';i++)model('tick');
 const next=ai('createAnnotationBatch',{versionId:version.id,name:`AI 标注示例 · ${type==='image'?'图片':'文本'}新模型第二轮`});if(type==='text')data(type,next.datasetId,'clean');data(type,next.datasetId,'assign',{assignee:'演示管理员'});ai('bindModel',{datasetId:next.datasetId,modelVersionId:m.id,serviceId});const second=ai('createPredictionJob',{datasetId:next.datasetId,name:'新模型再次预标注'});ai('startPredictionJob',{jobId:second.id});for(let i=0;i<4;i++)ai('advancePredictionJobs');
 evidence.push({type,firstBatchId:id,firstJobId:first.id,publishedVersionId:version.id,trainingId,modelVersionId:m.id,evaluationId,serviceId,secondBatchId:next.datasetId,secondJobId:second.id,predictionCount:w.aiAnnotation.jobs.find(j=>j.id===second.id).predictionIds.length});
}
w.events=[...events.map((e,i)=>({id:`AI-EXAMPLE-EVENT-${i+1}`,at,actor:'演示管理员',spaceId:'demo',space:'演示空间',result:'成功',before:{},after:{},...e})),...w.events];p.workspaces.demo=w;const snapshot=encodeSnapshot(p,at);decodeSnapshot(snapshot);await fs.writeFile('examples/ai-completed-session.json',snapshot);
const result={kind:'Deterministic local state scenarios; not browser UI validation',brand:'创平数智工场',scenarios:evidence,bytes:Buffer.byteLength(snapshot),output:'examples/ai-completed-session.json',originalP1ExampleUnchanged:original===await fs.readFile('examples/p1-completed-session.json','utf8'),realInference:false};await fs.writeFile('ai-example-evidence.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
