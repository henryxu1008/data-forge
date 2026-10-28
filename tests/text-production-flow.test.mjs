import assert from 'node:assert/strict';
import test from 'node:test';
import {applyTextBatchAction,cleanTextBatch,createDemoTextRecords,createTextBatch,textBatchCounts} from '../src/text-production-state.js';

const at='2026-10-27 14:00:00';
const spec=()=>({versionId:'intent-v1.1-feedback-v1',version:'v1.1',name:'文本意图分类',guide:'以用户的主要诉求选择单个标签。',review:'全部人工审核',taxonomyId:'feedback',taxonomyVersionId:'feedback-v1',labels:['物流','售后','商品','咨询'].map(name=>({name,description:`${name}判定规则`}))});
const make=(id='dataset-A',records=createDemoTextRecords(id))=>createTextBatch({datasetId:id,batchId:`batch-${id}`,name:`数据集 ${id}`,projectId:`project-${id}`,projectName:`项目 ${id}`,specSnapshot:spec(),rawRecords:records,at});
const act=(batch,type,rest={})=>applyTextBatchAction(batch,{type,...rest,at});
function must(batch,type,rest={}){
  const result=act(batch,type,rest);
  assert.equal(result.ok,true,result.error);
  return result.batch;
}
const cleaned=()=>must(make(),'clean');
const assigned=()=>must(cleaned(),'assign',{assignee:'李一'});
function approveOne(batch,index=0,label){
  const record=batch.records[index];
  batch=must(batch,'submit',{taskId:record.id,label:label||record.referenceLabel,note:'已核对完整文本'});
  return must(batch,'approve',{taskId:record.id,note:'符合规范'});
}
function rejected(batch,type,payload={}){
  const before=JSON.stringify(batch);
  const result=act(batch,type,payload);
  assert.equal(result.ok,false);
  assert.equal(result.batch,batch);
  assert.ok(result.error);
  assert.equal(JSON.stringify(batch),before);
}

test('new batches carry independent identity and frozen project/label specification, with actual 6 → 4 records',()=>{
  const input=createDemoTextRecords('import');
  const snapshot=spec();
  const original=createTextBatch({datasetId:'dataset',batchId:'B-001',name:'新增批次',projectId:'P-001',projectName:'项目一',specSnapshot:snapshot,rawRecords:input,at});
  input[0].text='外部改写';snapshot.labels[0].name='外部规范';
  assert.notEqual(original.rawRecords[0].text,'外部改写');
  assert.equal(original.specSnapshot.labels[0].name,'物流');
  assert.equal(original.taskSpecVersionId,snapshot.versionId);
  assert.equal(original.rawRecords.length,6);
  const batch=must(original,'clean');
  assert.equal(batch.records.length,4);
  assert.equal(batch.cleaningReport.input,6);
  assert.equal(batch.cleaningReport.output,4);
  assert.equal(batch.cleaningReport.filtered,2);
  assert.equal(batch.cleaningReport.hits.dedupe,2);
  assert.equal(batch.cleaningReport.removed[0].duplicateOf,original.rawRecords[0].id);
  assert.match(batch.records[0].text,/138\*\*\*\*8000/);
  assert.match(batch.records[3].text,/h\*\*\*@example\.com/);
  assert.equal(batch.records[0].label,'');
  assert.equal(batch.records[0].referenceLabel,'物流');
  assert.deepEqual(textBatchCounts(batch),{todo:4,review:0,rework:0,approved:0,unassigned:4,total:4});
  assert.equal(original.records.length,0);
  assert.equal(original.revision,0);
  assert.equal(batch.datasetId,original.datasetId);
  assert.equal(batch.projectId,original.projectId);
  assert.equal(batch.batchId,original.batchId);
});

test('assignment and draft save preserve pending status and require explicit, valid submission',()=>{
  let batch=cleaned();const taskId=batch.records[0].id;
  rejected(batch,'saveDraft',{taskId,label:'物流'});
  rejected(batch,'submit',{taskId,label:'物流'});
  rejected(batch,'assign',{assignee:''});
  rejected(batch,'assign',{assignee:'李一',sampleIds:['other-batch-id']});
  batch=must(batch,'assign',{assignee:'李一',sampleIds:[taskId]});
  assert.equal(textBatchCounts(batch).unassigned,3);
  rejected(batch,'submit',{taskId,label:''});
  rejected(batch,'submit',{taskId,label:'不在规范中的标签'});
  batch=must(batch,'saveDraft',{taskId,label:'物流',note:'待核对配送进度'});
  assert.equal(batch.records[0].status,'todo');
  assert.equal(batch.records[0].draftNote,'待核对配送进度');
  assert.equal(batch.records[0].history.at(-1).type,'saveDraft');
  batch=must(batch,'submit',{taskId,label:'物流',note:'核对完成'});
  assert.equal(batch.records[0].status,'review');
  assert.deepEqual(textBatchCounts(batch),{todo:3,review:1,rework:0,approved:0,unassigned:3,total:4});
  rejected(batch,'submit',{taskId,label:'物流'});
  rejected(batch,'saveDraft',{taskId,label:'售后'});
});

test('review return, draft correction and resubmission preserve reasons, history and count conservation',()=>{
  let batch=assigned();const taskId=batch.records[0].id;
  batch=must(batch,'submit',{taskId,label:'咨询'});
  rejected(batch,'reject',{taskId,note:'  '});
  batch=must(batch,'reject',{taskId,note:'请按配送进度归为物流'});
  assert.equal(batch.records[0].status,'rework');
  assert.equal(batch.records[0].returnReason,'请按配送进度归为物流');
  rejected(batch,'approve',{taskId,label:'物流'});
  rejected(batch,'resubmit',{taskId,label:'物流',note:''});
  batch=must(batch,'saveDraft',{taskId,label:'物流',note:'已重新核对原文'});
  assert.equal(batch.records[0].status,'rework');
  batch=must(batch,'resubmit',{taskId,label:'物流',note:'主要诉求是配送进度，已修正'});
  batch=must(batch,'approve',{taskId,note:'修正符合规范'});
  assert.equal(batch.records[0].resubmissions,1);
  assert.equal(batch.records[0].returnReason,'请按配送进度归为物流');
  assert.deepEqual(batch.records[0].history.map(event=>event.type),['submit','reject','saveDraft','resubmit','approve']);
  const counts=textBatchCounts(batch);
  assert.equal(counts.todo+counts.review+counts.rework+counts.approved,4);
  assert.equal(counts.approved,1);
  rejected(batch,'approve',{taskId,label:'物流'});
  rejected(batch,'reject',{taskId,note:'重复点击'});
  rejected(batch,'resubmit',{taskId,label:'物流',note:'重复重提'});
});

test('quality cannot pass empty approval scope or an undefined label specification',()=>{
  let batch=must(cleaned(),'checkQuality');
  assert.equal(batch.quality.status,'failed');
  assert.equal(batch.quality.count,0);
  assert.equal(batch.quality.checks.find(check=>check.id==='scope').passed,false);
  rejected(batch,'publish',{note:'不能发布空版本'});
  const noSpec=createTextBatch({datasetId:'empty-spec',name:'空规范',projectId:'P',projectName:'项目',specSnapshot:{versionId:'empty',labels:[]},rawRecords:createDemoTextRecords('x'),at});
  batch=must(must(noSpec,'clean'),'assign',{assignee:'李一'});
  rejected(batch,'submit',{taskId:batch.records[0].id,label:'物流'});
  batch=must(batch,'checkQuality');
  assert.equal(batch.quality.checks.find(check=>check.id==='labels').passed,false);
});

test('publication freezes exact approved records and preserves stable source IDs and training identity',()=>{
  let batch=assigned();
  batch=approveOne(batch,0);batch=approveOne(batch,1);
  batch=must(batch,'submit',{taskId:batch.records[2].id,label:'商品'});
  batch=must(batch,'submit',{taskId:batch.records[3].id,label:'咨询'});
  batch=must(batch,'reject',{taskId:batch.records[3].id,note:'请补充判定依据'});
  batch=must(batch,'checkQuality');
  assert.equal(batch.quality.status,'passed');
  const result=act(batch,'publish',{note:'首轮通过记录',owner:'演示管理员'});
  assert.equal(result.ok,true,result.error);
  const version=result.version;
  assert.equal(version.count,2);
  assert.equal(version.count,version.records.length);
  assert.deepEqual(version.records.map(record=>record.id),batch.records.slice(0,2).map(record=>record.id));
  assert.equal(version.datasetId,batch.datasetId);
  assert.equal(version.batchId,batch.batchId);
  assert.equal(version.projectId,batch.projectId);
  assert.equal(version.sourceRevision,batch.revision);
  assert.equal(version.specSnapshot.versionId,batch.specSnapshot.versionId);
  assert.notEqual(version.records[0],batch.records[0]);
  assert.notEqual(version.records[0].history,batch.records[0].history);
  assert.notEqual(version.specSnapshot.labels,batch.specSnapshot.labels);
  assert.equal(batch.versions.length,0);
  rejected(result.batch,'publish',{note:'重复发布'});
  rejected(result.batch,'publish',{note:'   '});
});

test('reopening and correcting a released record invalidates quality even when the final approved count matches',()=>{
  let batch=approveOne(assigned());
  batch=must(batch,'checkQuality');
  batch=must(batch,'publish',{note:'第一版'});
  const frozen=JSON.stringify(batch.versions[0]);
  const oldRevision=batch.revision;
  const taskId=batch.records[0].id;
  rejected(batch,'reopen',{taskId,note:''});
  batch=must(batch,'reopen',{taskId,note:'需要重新判断主要意图'});
  assert.equal(batch.quality.status,'stale');
  assert.equal(batch.records[0].status,'todo');
  rejected(batch,'publish',{note:'检查已失效'});
  batch=must(batch,'submit',{taskId,label:'咨询'});
  batch=must(batch,'approve',{taskId,note:'完成重新审核'});
  assert.equal(textBatchCounts(batch).approved,1);
  assert.ok(batch.revision>oldRevision);
  assert.equal(batch.quality.status,'stale');
  rejected(batch,'publish',{note:'数量相同也不能复用旧检查'});
  batch=must(batch,'checkQuality');
  batch=must(batch,'publish',{note:'第二版修正标签'});
  assert.equal(batch.versions[0].version,'v0.2');
  assert.equal(batch.versions[0].records[0].label,'咨询');
  assert.equal(JSON.stringify(batch.versions[1]),frozen);
  assert.equal(batch.versions[1].records[0].label,'物流');
});

test('any draft or assignment after quality checking invalidates its revision',()=>{
  let batch=approveOne(assigned());
  batch=must(batch,'checkQuality');
  assert.equal(batch.quality.status,'passed');
  batch=must(batch,'saveDraft',{taskId:batch.records[1].id,label:'售后',note:'继续工作批次'});
  assert.equal(batch.quality.status,'stale');
  rejected(batch,'publish',{note:'重新检查前不能发布'});
  batch=must(batch,'checkQuality');
  batch=must(batch,'assign',{sampleIds:[batch.records[1].id],assignee:'陈思'});
  assert.equal(batch.quality.status,'stale');
});

test('batch A mutations and publications never change batch B or accept its task IDs',()=>{
  let a=must(make('A'),'clean');
  const b=must(make('B'),'clean');
  const beforeB=JSON.stringify(b);
  a=must(a,'assign',{assignee:'李一'});
  rejected(a,'submit',{taskId:b.records[0].id,label:'物流'});
  a=approveOne(a);a=must(a,'checkQuality');a=must(a,'publish',{note:'仅发布 A'});
  assert.equal(JSON.stringify(b),beforeB);
  assert.equal(b.versions.length,0);
  assert.equal(a.versions[0].datasetId,'A');
  assert.equal(a.versions[0].projectId,'project-A');
  assert.equal(textBatchCounts(b).approved,0);
});

test('cleaning only changes unstarted batches and honors exact rules, empty removal and masking',()=>{
  const raw=[{id:'1',text:'  同一内容  ',referenceLabel:'咨询'},{id:'2',text:'同一内容',referenceLabel:'咨询'},{id:'3',text:'   '},{id:'4',text:'联系 13800138000 或 user@example.com',referenceLabel:'咨询'}];
  const original=make('rules',raw);
  const all=cleanTextBatch(original,{rules:{trim:true,dedupe:true,empty:true,pii:true},at});
  assert.equal(all.records.length,2);
  assert.deepEqual(all.cleaningReport.hits,{trim:2,dedupe:1,empty:1,pii:1});
  const none=cleanTextBatch(original,{rules:{trim:false,dedupe:false,empty:false,pii:false},at});
  assert.equal(none.records.length,4);
  assert.equal(none.records[0].text,'  同一内容  ');
  assert.match(none.records[3].text,/13800138000/);
  const begun=must(all,'assign',{assignee:'李一'});
  rejected(begun,'clean',{rules:{dedupe:false}});
  assert.equal(cleanTextBatch(begun,{rules:{dedupe:false},at}),begun);
  rejected(original,'assign',{assignee:'李一'});
  rejected(original,'checkQuality');
});

test('duplicate approved text fails quality and empty text cannot be submitted',()=>{
  const raw=[{id:'1',text:'相同文本',referenceLabel:'咨询'},{id:'2',text:'相同文本',referenceLabel:'咨询'},{id:'3',text:''}];
  let batch=must(make('duplicates',raw),'clean',{rules:{dedupe:false,empty:false}});
  batch=must(batch,'assign',{assignee:'李一'});
  rejected(batch,'submit',{taskId:'3',label:'咨询'});
  batch=approveOne(batch,0);batch=approveOne(batch,1);
  batch=must(batch,'checkQuality');
  assert.equal(batch.quality.status,'failed');
  assert.equal(batch.quality.checks.find(check=>check.id==='duplicates').passed,false);
  rejected(batch,'publish',{note:'重复内容不能发布'});
});

test('malformed source IDs and unknown transitions fail without changing existing data',()=>{
  const batch=make('bad-ids',[{id:'same',text:'一'},{id:'same',text:'二'}]);
  rejected(batch,'clean');
  const good=assigned();
  rejected(good,'approve',{taskId:good.records[0].id,label:'物流'});
  rejected(good,'resubmit',{taskId:good.records[0].id,label:'物流',note:'越过审核'});
  rejected(good,'reopen',{taskId:good.records[0].id,note:'尚未通过'});
  rejected(good,'unknown',{taskId:good.records[0].id});
  const original=JSON.stringify(good);
  const checked=must(good,'checkQuality');
  assert.equal(JSON.stringify(good),original);
  assert.notEqual(checked,good);
});
