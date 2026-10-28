import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createTextBatch,applyTextBatchAction} from '../src/text-production-state.js';
import {createImageBatch,createDemoImageRecords,defaultImageSpec,applyImageBatchAction} from '../src/image-production-state.js';
import {createAIAnnotationState,applyAIAnnotationAction,predictionAvailability,validateAIAnnotation} from '../src/ai-annotation-state.js';
import {createModelLifecycleState,applyModelLifecycleAction} from '../src/model-lifecycle-state.js';
import {encodeSnapshot,decodeSnapshot} from '../src/persistence.js';
import {authorizeAction,visibleWorkspace} from '../src/platform-policy.js';

const at='2026-10-27T08:30:00Z';
const spec={versionId:'AI-SPEC-1',name:'分类规范',labels:[{name:'物流'},{name:'售后'},{name:'商品'},{name:'咨询'}]};
const base=()=>JSON.parse(fs.readFileSync(new URL('../examples/p1-completed-session.json',import.meta.url),'utf8')).payload;
function fixture(type='text') {
 const p=base(),w=p.workspaces.demo;
 w.aiAnnotation=createAIAnnotationState();
 const b=type==='text'?createTextBatch({datasetId:'ai-text',name:'AI文本',projectId:'PRJ-001',projectName:'客户反馈意图分类',specSnapshot:spec,rawRecords:[{id:'a',text:'物流一直未送达'},{id:'b',text:'申请退货退款'}],at}):createImageBatch({datasetId:'ai-image',name:'AI图片',projectId:'PRJ-003',projectName:'工业缺陷图片集',specSnapshot:defaultImageSpec,records:createDemoImageRecords(),at});
 const batch=type==='text'?applyTextBatchAction(b,{type:'clean',at}).batch:b;
 w[type==='text'?'textBatches':'imageBatches'][b.id]=batch;
 w.datasets.push({id:b.id,name:b.name,type});
 return {p,w,id:b.id,type};
}
const act=(f,type,rest={},ctx={})=>{const r=applyAIAnnotationAction(f.w,{type,...rest,at},{actorId:'henry',actorName:'演示管理员',...ctx});if(r.ok){f.w=r.workspace;f.p.workspaces.demo=f.w;}return r;};
const yes=(f,type,rest={},ctx={})=>{const r=act(f,type,rest,ctx);assert.equal(r.ok,true,r.error);return r.entity;};
function data(f,type,rest={}){const key=f.type==='image'?'imageBatches':'textBatches',fn=f.type==='image'?applyImageBatchAction:applyTextBatchAction;const r=fn(f.w[key][f.id],{type,...rest,at});assert.equal(r.ok,true,r.error);f.w[key][f.id]=r.batch;return r;}
function predict(f,scenario='success') {yes(f,'bindModel',{datasetId:f.id,modelVersionId:f.type==='image'?'SIM-VISION-1':'SIM-TEXT-1'});const j=yes(f,'createPredictionJob',{datasetId:f.id,name:'批量建议',scenario});yes(f,'startPredictionJob',{jobId:j.id});for(let i=0;i<4;i++)yes(f,'advancePredictionJobs');return f.w.aiAnnotation.jobs.find(x=>x.id===j.id);}
function assign(f){data(f,'assign',{assignee:'演示管理员'});}

test('text predictions are generated from frozen real inputs, model version and reproducible simulated confidence',()=>{
 const f=fixture(),j=predict(f);assert.equal(j.status,'completed');assert.equal(j.input.revision,1);assert.equal(j.predictionIds.length,2);
 const ps=f.w.aiAnnotation.predictions;assert.ok(ps.every(p=>p.demo&&p.modelVersionId==='SIM-TEXT-1'&&p.inputSignature&&p.confidence>=0&&p.confidence<=1));assert.ok(ps.some(p=>p.suggestion.label==='售后'));
 const g=fixture();predict(g);assert.deepEqual(g.w.aiAnnotation.predictions.map(p=>[p.suggestion,p.confidence]),ps.map(p=>[p.suggestion,p.confidence]));
 assert.equal(f.w.textBatches[f.id].records[0].label,'');assert.ok(act(f,'startPredictionJob',{jobId:j.id}).error);
});
test('accepting text suggestion creates an assigned editable draft, never approval, and rejects duplicate acceptance',()=>{
 const f=fixture();predict(f);const p=f.w.aiAnnotation.predictions[0];assert.equal(act(f,'acceptPredictions',{predictionIds:[p.id]}).ok,false);assign(f);
 yes(f,'acceptPredictions',{predictionIds:[p.id]});let r=f.w.textBatches[f.id].records.find(r=>r.id===p.recordId);assert.equal(r.status,'todo');assert.equal(r.label,p.suggestion.label);assert.equal(r.aiAnnotation.predictionId,p.id);
 const frozen=JSON.stringify(f.w);assert.equal(act(f,'acceptPredictions',{predictionIds:[p.id]}).ok,false);assert.equal(JSON.stringify(f.w),frozen);
 data(f,'saveDraft',{taskId:r.id,label:'咨询',note:'人工修正'});r=f.w.textBatches[f.id].records.find(x=>x.id===r.id);assert.equal(r.label,'咨询');assert.equal(r.aiAnnotation.predictionId,p.id);
});
test('image suggestions contain valid pixel geometry, can be accepted then corrected by the existing reviewer flow',()=>{
 const f=fixture('image');predict(f);assign(f);const p=f.w.aiAnnotation.predictions.find(p=>p.suggestion.boxes.length)||f.w.aiAnnotation.predictions[0];yes(f,'acceptPredictions',{predictionIds:[p.id]});
 let r=f.w.imageBatches[f.id].records.find(r=>r.id===p.recordId);assert.equal(r.status,'todo');assert.ok(r.aiAnnotation);assert.notEqual(r.boxes,p.suggestion.boxes);
 data(f,'submit',{recordId:r.id,boxes:[{id:'manual',x:1,y:2,width:20,height:20,label:'划痕',severity:'轻微'}],noDefect:false,note:'人工核对'});data(f,'reject',{recordId:r.id,note:'调整范围',boxIds:['manual']});
 data(f,'submit',{recordId:r.id,boxes:[{id:'manual',x:2,y:2,width:20,height:20,label:'划痕',severity:'轻微'}],noDefect:false,note:'已修正'});data(f,'approve',{recordId:r.id});data(f,'checkQuality');const v=data(f,'publish',{note:'AI建议人工修正后发布'}).version;
 assert.equal(v.records[0].aiAnnotation.predictionId,p.id);assert.equal(v.records[0].boxes[0].x,2);assert.equal(p.suggestion.boxes[0]?.x===2,false);
});
test('manual drafts, existing accepted suggestions, submitted and approved records are never overwritten',()=>{
 const f=fixture();assign(f);data(f,'saveDraft',{taskId:'a',label:'商品',note:'已人工判断'});predict(f);const p=f.w.aiAnnotation.predictions.find(p=>p.recordId==='a');
 assert.equal(predictionAvailability(f.w,p).code,'protected');assert.equal(act(f,'acceptPredictions',{predictionIds:[p.id]}).ok,false);assert.equal(f.w.textBatches[f.id].records[0].label,'商品');
});
test('source mutation expires suggestions, while assigning an untouched sample after prediction is allowed',()=>{
 const f=fixture();predict(f);assign(f);const p=f.w.aiAnnotation.predictions[0];assert.equal(predictionAvailability(f.w,p).code,'available');f.w.textBatches[f.id].records.find(r=>r.id===p.recordId).text+='已修改';
 assert.equal(predictionAvailability(f.w,p).code,'expired');assert.equal(act(f,'acceptPredictions',{predictionIds:[p.id]}).ok,false);
});
test('failed and cancelled jobs preserve attempts, produce no suggestions, and support an explicit retry',()=>{
 const f=fixture(),j=predict(f,'fail');assert.equal(j.status,'failed');assert.equal(j.predictionIds.length,0);assert.equal(f.w.aiAnnotation.predictions.length,0);
 yes(f,'retryPredictionJob',{jobId:j.id,scenario:'success',note:'修复后重试'});yes(f,'advancePredictionJobs');yes(f,'cancelPredictionJob',{jobId:j.id,note:'暂停本轮'});assert.equal(f.w.aiAnnotation.jobs[0].status,'cancelled');assert.equal(f.w.aiAnnotation.jobs[0].attempts.length,2);
 yes(f,'retryPredictionJob',{jobId:j.id,scenario:'success',note:'继续本轮'});for(let i=0;i<4;i++)yes(f,'advancePredictionJobs');assert.equal(f.w.aiAnnotation.jobs[0].status,'completed');assert.equal(f.w.aiAnnotation.jobs[0].attempts.length,3);
});
test('modality and label mismatch, missing sources and stale input retries are rejected atomically',()=>{
 const f=fixture();assert.equal(act(f,'bindModel',{datasetId:f.id,modelVersionId:'SIM-VISION-1'}).ok,false);
 predict(f,'fail');const j=f.w.aiAnnotation.jobs[0];f.w.textBatches[f.id].records[0].text+='变更';assert.equal(act(f,'retryPredictionJob',{jobId:j.id,note:'重试'}).ok,false);
 assert.equal(act(f,'createPredictionJob',{datasetId:'missing',name:'错误'}).ok,false);
});
test('binding replacement invalidates old unaccepted suggestions without rewriting historical predictions',()=>{
 const f=fixture();predict(f);const p=f.w.aiAnnotation.predictions[0],snapshot=JSON.stringify(p);yes(f,'unbindModel',{datasetId:f.id,note:'暂不使用'});assert.equal(predictionAvailability(f.w,p).code,'expired');
 yes(f,'bindModel',{datasetId:f.id,modelVersionId:'SIM-TEXT-1'});assert.equal(predictionAvailability(f.w,p).code,'expired');assert.equal(JSON.stringify(f.w.aiAnnotation.predictions.find(x=>x.id===p.id)),snapshot);
});
test('multi-accept is atomic and honours assigned annotator identity',()=>{
 const f=fixture();predict(f);assign(f);const ps=f.w.aiAnnotation.predictions;const before=JSON.stringify(f.w);
 assert.equal(act(f,'acceptPredictions',{predictionIds:ps.map(p=>p.id)},{roleId:'annotator',actorName:'其他人'}).ok,false);assert.equal(JSON.stringify(f.w),before);
 yes(f,'acceptPredictions',{predictionIds:ps.map(p=>p.id)});assert.ok(f.w.textBatches[f.id].records.every(r=>r.aiAnnotation&&r.status==='todo'));
});
function trainAndServe(f,version) {
 let s=createModelLifecycleState();const env={versions:[version],concurrency:2,gpu:1};
 const m=(type,rest={})=>{const r=applyModelLifecycleAction(s,{type,...rest,at},env);assert.equal(r.ok,true,r.error);s=r.state;return r.entity;};
 m('startTraining',{name:'人工复核后训练',base:f.type==='image'?'YOLOv8':'Qwen',dataVersionId:version.id,params:{epochs:3,batch:4,rate:0.0002,rank:16}});
 for(let i=0;i<40&&s.trainings[0].status!=='completed';i++)m('tick');
 m('startEvaluation',{modelVersionId:s.models[0].id,dataVersionId:version.id,scenario:'pass',thresholds:{accuracy:80,macroF1:80}});for(let i=0;i<20&&s.evaluations[0].status==='running';i++)m('tick');
 m('publishService',{modelVersionId:s.models[0].id,evaluationId:s.evaluations[0].id,name:'回标注服务',note:'本地模拟'});for(let i=0;i<20&&s.services[0].status==='deploying';i++)m('tick');
 f.w.modelState=s;return s.services[0];
}
for(const type of ['text','image'])test(type+' loop publishes human-reviewed AI drafts, trains a new version, and binds it for a fresh prediction round',()=>{
 const f=fixture(type);predict(f);assign(f);yes(f,'acceptPredictions',{predictionIds:f.w.aiAnnotation.predictions.map(p=>p.id)});
 const records=(type==='image'?f.w.imageBatches:f.w.textBatches)[f.id].records;
 for(const r of records){data(f,'submit',type==='image'?{recordId:r.id,note:'人工核对'}:{taskId:r.id});data(f,'approve',type==='image'?{recordId:r.id}:{taskId:r.id});}
 data(f,'checkQuality');const v=data(f,'publish',{note:'审核发布训练来源'}).version;const old=JSON.stringify(v);const service=trainAndServe(f,v);
 const b=yes(f,'createAnnotationBatch',{versionId:v.id,name:'下一轮独立数据'});f.id=b.datasetId;
 if(type==='text')data(f,'clean');yes(f,'bindModel',{datasetId:f.id,modelVersionId:service.modelVersionId,serviceId:service.id});const j=yes(f,'createPredictionJob',{datasetId:f.id,name:'新模型回到预标注'});yes(f,'startPredictionJob',{jobId:j.id});for(let i=0;i<4;i++)yes(f,'advancePredictionJobs');
 assert.equal(f.w.aiAnnotation.jobs[0].status,'completed');assert.equal(f.w.aiAnnotation.jobs[0].modelVersionId,service.modelVersionId);assert.equal(JSON.stringify(v),old);validateAIAnnotation(f.w);
 service.status='offline';f.w.modelState.services[0].status='offline';assert.equal(act(f,'createPredictionJob',{datasetId:f.id,name:'下线拒绝'}).ok,false);assign(f);assert.equal(act(f,'acceptPredictions',{predictionIds:f.w.aiAnnotation.jobs[0].predictionIds}).ok,false);
});
test('full persistence roundtrip preserves prediction and accepted provenance, while orphaned and forged records are rejected',()=>{
 const f=fixture();predict(f);assign(f);yes(f,'acceptPredictions',{predictionIds:[f.w.aiAnnotation.predictions[0].id]});f.p.workspaces.demo=f.w;
 const restored=decodeSnapshot(encodeSnapshot(f.p)).platform;assert.deepEqual(restored.workspaces.demo.aiAnnotation,f.w.aiAnnotation);
 const bad=structuredClone(f.p);bad.workspaces.demo.aiAnnotation.predictions[0].confidence=1.2;assert.throws(()=>decodeSnapshot(encodeSnapshot(bad)),/预测|标注|置信/);
 const orphan=structuredClone(f.p);delete orphan.workspaces.demo.aiAnnotation;assert.throws(()=>decodeSnapshot(encodeSnapshot(orphan)),/预测|标注/);
 assert.ok(decodeSnapshot(encodeSnapshot(base())).platform);
});
test('AI operations and visibility use the same project and role permissions as the workspace',()=>{
 const f=fixture();predict(f);const settings=f.p.settings;const reader={id:'ai-read',name:'只读',permissions:['view'],projectScope:'authorized'};settings.roles.push(reader);settings.users.push({id:'ai-user',name:'只读',status:'active'});settings.members.push({id:'ai-member',userId:'ai-user',spaceId:'demo',roleId:reader.id,status:'active',projectIds:[]});
 assert.equal(authorizeAction(settings,'ai-user','demo',f.w,'annotation',{type:'createPredictionJob',datasetId:f.id}).ok,false);assert.equal(visibleWorkspace(f.w,settings,'ai-user','demo').aiAnnotation.jobs.length,0);
});
test('a service going offline during a task fails the attempt without fabricating predictions',()=>{
 const f=fixture();assign(f);for(const r of f.w.textBatches[f.id].records){data(f,'submit',{taskId:r.id,label:'物流'});data(f,'approve',{taskId:r.id});}data(f,'checkQuality');const v=data(f,'publish',{note:'训练基线'}).version;const svc=trainAndServe(f,v);
 yes(f,'bindModel',{datasetId:f.id,modelVersionId:svc.modelVersionId,serviceId:svc.id});const j=yes(f,'createPredictionJob',{datasetId:f.id,name:'服务下线测试'});yes(f,'startPredictionJob',{jobId:j.id});f.w.modelState.services[0].status='offline';
 const r=act(f,'advancePredictionJobs');assert.equal(r.ok,true);assert.equal(f.w.aiAnnotation.jobs[0].status,'failed');assert.match(f.w.aiAnnotation.jobs[0].error,/下线|运行/);assert.equal(f.w.aiAnnotation.predictions.length,0);assert.equal(r.events[0].result,'失败');
 assert.equal(act(f,'retryPredictionJob',{jobId:j.id,note:'仍下线'}).ok,false);
});
test('a newly trained incompatible label set cannot be bound to an unrelated batch',()=>{
 const f=fixture();assign(f);for(const r of f.w.textBatches[f.id].records){data(f,'submit',{taskId:r.id,label:'物流'});data(f,'approve',{taskId:r.id});}data(f,'checkQuality');const svc=trainAndServe(f,data(f,'publish',{note:'训练'}).version);
 f.w.textBatches[f.id].specSnapshot.labels=[{name:'其他类别'}];const before=JSON.stringify(f.w);assert.equal(act(f,'bindModel',{datasetId:f.id,modelVersionId:svc.modelVersionId,serviceId:svc.id}).ok,false);assert.equal(JSON.stringify(f.w),before);
});
test('revoked run permission or input changes stop an in-flight job; a cancelled queued task can be restored and retried',()=>{
 const f=fixture();yes(f,'bindModel',{datasetId:f.id,modelVersionId:'SIM-TEXT-1'});const j=yes(f,'createPredictionJob',{datasetId:f.id,name:'权限撤销'});yes(f,'startPredictionJob',{jobId:j.id});yes(f,'advancePredictionJobs',{}, {canRun:()=>false});assert.equal(f.w.aiAnnotation.jobs[0].status,'failed');assert.match(f.w.aiAnnotation.jobs[0].error,/权限/);
 const next=yes(f,'createPredictionJob',{datasetId:f.id,name:'取消排队'});yes(f,'cancelPredictionJob',{jobId:next.id,note:'取消尚未开始任务'});validateAIAnnotation(f.w);yes(f,'retryPredictionJob',{jobId:next.id,note:'重新开始'});f.w.textBatches[f.id].records[0].text='输入已修改';yes(f,'advancePredictionJobs');assert.equal(f.w.aiAnnotation.jobs[0].status,'failed');assert.match(f.w.aiAnnotation.jobs[0].error,/过期|变化/);
});
test('hidden parent projects hide prediction inputs and prevent accepting cross-source suggestions',()=>{
 for(const type of ['text','image']){
 const f=fixture(type),key=type==='image'?'imageBatches':'textBatches',project=type==='image'?'PRJ-003':'PRJ-001';f.w[key][f.id].sourceProjects=[project,'SECRET'];predict(f);
 if(type==='image'){assign(f);yes(f,'acceptPredictions',{predictionIds:f.w.aiAnnotation.predictions.map(p=>p.id)});for(const r of f.w.imageBatches[f.id].records){data(f,'submit',{recordId:r.id,note:'人工确认'});data(f,'approve',{recordId:r.id});}data(f,'checkQuality');assert.deepEqual(data(f,'publish',{note:'保留跨来源权限'}).version.sourceProjects,[project,'SECRET']);}
 const settings=f.p.settings;settings.roles.push({id:'ai-editor',name:'编辑',permissions:['view','edit','run'],projectScope:'authorized'});settings.users.push({id:'partial',name:'局部成员',status:'active'});settings.members.push({id:'partial-member',userId:'partial',spaceId:'demo',roleId:'ai-editor',status:'active',projectIds:[project]});
 const p=f.w.aiAnnotation.predictions[0];assert.equal(authorizeAction(settings,'partial','demo',f.w,'annotation',{type:'acceptPredictions',predictionIds:[p.id]}).ok,false);const visible=visibleWorkspace(f.w,settings,'partial','demo');assert.equal(visible.aiAnnotation.predictions.length,0);assert.equal(visible.aiAnnotation.jobs.length,0);assert.ok(!visible.datasets.some(d=>d.id===f.id));
 }

});
test('acceptance invalidates current quality and cannot rewrite a published version or auto-submit a sample',()=>{
 const f=fixture();assign(f);data(f,'submit',{taskId:'a',label:'商品'});data(f,'approve',{taskId:'a'});data(f,'checkQuality');const v=data(f,'publish',{note:'部分发布'}).version,snapshot=JSON.stringify(v);predict(f);const p=f.w.aiAnnotation.predictions.find(p=>p.recordId==='b');yes(f,'acceptPredictions',{predictionIds:[p.id]});
 const b=f.w.textBatches[f.id];assert.equal(b.quality.status,'stale');assert.equal(b.records.find(r=>r.id==='b').status,'todo');assert.equal(JSON.stringify(b.versions[0]),snapshot);assert.equal(applyTextBatchAction(b,{type:'publish',note:'绕过质检',at}).ok,false);
});
test('missing predictions, forged acceptance lineage and unsafe sequence reuse fail snapshot validation',()=>{
 const f=fixture('image');predict(f);assign(f);yes(f,'acceptPredictions',{predictionIds:[f.w.aiAnnotation.predictions[0].id]});
 const bads=[w=>{w.aiAnnotation.sequence=0;},w=>{w.aiAnnotation.predictions.pop();},w=>{w.imageBatches[f.id].records.find(r=>r.aiAnnotation).aiAnnotation.modelVersionId='forged';},w=>{w.aiAnnotation.jobs[0].input.records[0].width=123;}];
 for(const corrupt of bads){const bad=structuredClone(f.w);corrupt(bad);assert.throws(()=>validateAIAnnotation(bad),/AI 标注/);}
});
