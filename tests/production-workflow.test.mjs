import {applyDeliveryAction} from '../src/delivery-lifecycle-state.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {applyWorkOrder,checkWorkOrderData} from '../src/production-workflow.js';
import {createTextBatch,applyTextBatchAction} from '../src/text-production-state.js';
import {createImageBatch,createDemoImageRecords,defaultImageSpec,applyImageBatchAction} from '../src/image-production-state.js';
import {createDeliveryCorrection} from '../src/delivery-correction.js';
import {applyWorkspaceDelivery} from '../src/delivery-platform.js';
import {decodeSnapshot,encodeSnapshot} from '../src/persistence.js';
import {visibleWorkspace,unifiedTodos} from '../src/platform-policy.js';
const at='2026-10-29T09:00:00Z',dueAt='2026-10-30T09:00:00Z';
function fixture(image=false){const p=decodeSnapshot(fs.readFileSync('examples/completed-session.json','utf8')).platform;p.settings.members.find(m=>m.userId==='wangyue'&&m.spaceId==='demo').projectIds.push('PRJ-001');p.settings.members.find(m=>m.userId==='liyi'&&m.spaceId==='demo').projectIds.push('PRJ-003');const w=p.workspaces.demo;let b=image?createImageBatch({datasetId:'work-image',name:'图片生产',projectId:'PRJ-003',projectName:'图片',specSnapshot:defaultImageSpec,records:createDemoImageRecords(),at}):createTextBatch({datasetId:'work-text',name:'文本生产',projectId:'PRJ-001',projectName:'文本',specSnapshot:{versionId:'spec-work',labels:[{name:'物流'},{name:'售后'}]},rawRecords:[{id:'one',text:'物流运输查询'},{id:'two',text:'售后退货申请'}],at});if(!image)b=applyTextBatchAction(b,{type:'clean',at}).batch;w[image?'imageBatches':'textBatches'][b.datasetId]=b;w.datasets.push({id:b.datasetId,name:b.name,type:image?'image':'text'});return {p,id:b.datasetId,image};}
const workspace=f=>f.p.workspaces.demo;
function work(f,type,extra={},actor='henry',time=at){const r=applyWorkOrder(workspace(f),f.p.settings,actor,'demo',{type,taskId:'WORK-1',...extra},time);assert.equal(r.ok,true,r.error);f.p.workspaces.demo=r.workspace;return r;}
function data(f,type,extra={},actor=type==='approve'||type==='checkQuality'?'wangyue':type==='publish'?'henry':'liyi'){
 const w=workspace(f);assert.equal(checkWorkOrderData(w,actor,f.id,{type,...extra}).ok,true);const key=f.image?'imageBatches':'textBatches';const r=(f.image?applyImageBatchAction:applyTextBatchAction)(w[key][f.id],{type,...extra,at});assert.equal(r.ok,true,r.error);w[key][f.id]=r.batch;return r;
}
function assign(f){return work(f,'create',{datasetId:f.id,assigneeId:'liyi',reviewerId:'wangyue',dueAt})}
function submitRows(f){const b=workspace(f)[f.image?'imageBatches':'textBatches'][f.id];for(const row of b.records)data(f,'submit',f.image?{recordId:row.id,boxes:[],noDefect:true}:{taskId:row.id,label:'物流'});}
function approveRows(f){for(const row of workspace(f)[f.image?'imageBatches':'textBatches'][f.id].records)data(f,'approve',{taskId:row.id,recordId:row.id});data(f,'checkQuality');}
test('text and image work orders enforce claim, submit, independent review and accepted publication',()=>{
 for(const image of [false,true]){const f=fixture(image);assign(f);assert.equal(checkWorkOrderData(workspace(f),'liyi',f.id,{type:'submit'}).ok,false);work(f,'claim',{},'liyi');submitRows(f);assert.equal(checkWorkOrderData(workspace(f),'wangyue',f.id,{type:'approve'}).ok,false);work(f,'submit',{},'liyi');approveRows(f);assert.equal(checkWorkOrderData(workspace(f),'henry',f.id,{type:'publish'}).ok,false);work(f,'accept',{},'wangyue');const v=data(f,'publish',{note:'工单验收后发布'}).version;assert.equal(v.sourceRevision,workspace(f).workOrders.orders[0].acceptedRevision);assert.deepEqual(decodeSnapshot(encodeSnapshot(f.p)).platform,f.p);}
});
test('return and independent arbitration preserve history and re-enter real sample review',()=>{
 const f=fixture();assign(f);work(f,'claim',{},'liyi');submitRows(f);work(f,'submit',{},'liyi');work(f,'return',{note:'标签分歧'},'wangyue');work(f,'dispute',{note:'请求独立复核'},'liyi');
 for(const actor of ['liyi','wangyue'])assert.equal(applyWorkOrder(workspace(f),f.p.settings,actor,'demo',{type:'arbitrate',taskId:'WORK-1',decision:'review',note:'自裁'},at).ok,false);
 work(f,'arbitrate',{decision:'review',note:'保持样本，交原审核人重新审核'});approveRows(f);work(f,'accept',{},'wangyue');assert.equal(workspace(f).workOrders.orders[0].history.length,7);
});
test('overdue reassignment is explicit and early, duplicate, outsider and stale mutations are atomic',()=>{
 const f=fixture();assign(f);const before=structuredClone(workspace(f));
 for(const a of [{type:'create',datasetId:f.id,assigneeId:'liyi',reviewerId:'wangyue',dueAt},{type:'reassign',taskId:'WORK-1',assigneeId:'zhangmin',dueAt:'2026-11-02T00:00:00Z',note:'未到期'}])assert.equal(applyWorkOrder(workspace(f),f.p.settings,'henry','demo',a,at).ok,false);
 assert.equal(applyWorkOrder(workspace(f),f.p.settings,'chensi','demo',{type:'claim',taskId:'WORK-1'},at).ok,false);assert.deepEqual(workspace(f),before);
 work(f,'reassign',{assigneeId:'zhangmin',dueAt:'2026-11-02T00:00:00Z',note:'原成员超时'},'henry','2026-10-31T00:00:00Z');assert.equal(workspace(f).workOrders.orders[0].assigneeId,'zhangmin');assert.equal(workspace(f).textBatches[f.id].records[0].annotator,'张敏');assert.equal(visibleWorkspace(workspace(f),f.p.settings,'chensi','demo').workOrders.orders.length,0);
});
test('feedback creates a traceable correction batch and can close only after its accepted redelivery',()=>{
 const f=fixture();assign(f);work(f,'claim',{},'liyi');submitRows(f);work(f,'submit',{},'liyi');approveRows(f);work(f,'accept',{},'wangyue');const original=data(f,'publish',{note:'原交付'}).version;
 const delivery=(type,extra={},actor='henry')=>{const r=applyWorkspaceDelivery(workspace(f),f.p.settings,actor,'demo',{type,orderId:'DLV-1',...extra},at);assert.equal(r.ok,true,r.error);f.p.workspaces.demo=r.workspace;return r;};
 delivery('create',{projectId:'PRJ-001',versionId:original.id,customerId:'wangyue'});const pack={checksum:'test',qualityReportId:'q',licenseRef:'l',manifest:['data.json']};delivery('package',pack);delivery('submit');delivery('accept',{note:'通过'},'wangyue');delivery('openFeedback',{note:'客户发现问题'},'wangyue');
 const action={orderId:'DLV-1',feedbackId:'DLV-1-FB-1',assigneeId:'liyi',reviewerId:'wangyue',dueAt};const r=createDeliveryCorrection(workspace(f),f.p.settings,'henry','demo',action,at);assert.equal(r.ok,true,r.error);f.p.workspaces.demo=r.workspace;f.id=r.task.datasetId;
 assert.equal(createDeliveryCorrection(workspace(f),f.p.settings,'henry','demo',action,at).ok,false);
 assert.equal(applyWorkspaceDelivery(workspace(f),f.p.settings,'henry','demo',{type:'closeFeedback',orderId:'DLV-1',feedbackId:action.feedbackId,note:'未处理'},at).ok,false);
 work(f,'claim',{taskId:'WORK-2'},'liyi');submitRows(f);work(f,'submit',{taskId:'WORK-2'},'liyi');approveRows(f);work(f,'accept',{taskId:'WORK-2'},'wangyue');const corrected=data(f,'publish',{note:'纠错完成'}).version;
 delivery('requestRevision',{newVersionId:corrected.id,feedbackId:action.feedbackId,note:'纠错补交'});delivery('package',{...pack,orderId:'DLV-2'});delivery('submit',{orderId:'DLV-2'});delivery('accept',{orderId:'DLV-2',note:'补交通过'},'wangyue');delivery('closeFeedback',{feedbackId:action.feedbackId,note:'客户已签收'});
 assert.equal(workspace(f).delivery.orders.find(o=>o.id==='DLV-1').versionSnapshot.id,original.id);assert.equal(unifiedTodos(workspace(f)).filter(t=>t.target==='work-orders'||t.target==='deliveries').length,0);assert.deepEqual(decodeSnapshot(encodeSnapshot(f.p)).platform,f.p);
 const bad=structuredClone(f.p);delete bad.workspaces.demo.workOrders;assert.throws(()=>decodeSnapshot(encodeSnapshot(bad)),/工单/);
});
test('revoked governance stops new work and malformed accepted snapshot is rejected',()=>{const f=fixture();assign(f);workspace(f).governance={enabled:true,charters:[],admissions:[]};assert.equal(applyWorkOrder(workspace(f),f.p.settings,'liyi','demo',{type:'claim',taskId:'WORK-1'},at).ok,false);delete workspace(f).governance;workspace(f).workOrders.orders[0].status='accepted';assert.throws(()=>decodeSnapshot(encodeSnapshot(f.p)),/工单/);});
test('self assignment, empty reasons, stale quality and legacy mutation routes cannot bypass work gates',()=>{
 const f=fixture(),w=workspace(f);
 assert.equal(applyWorkOrder(w,f.p.settings,'henry','demo',{type:'create',datasetId:f.id,assigneeId:'henry',reviewerId:'henry',dueAt},at).ok,false);assign(f);
 for(const type of ['assign','assignReviewer','publish','saveDraft','approve'])assert.equal(checkWorkOrderData(workspace(f),'henry',f.id,{type}).ok,false);
 work(f,'claim',{},'liyi');submitRows(f);work(f,'submit',{},'liyi');assert.equal(applyWorkOrder(workspace(f),f.p.settings,'wangyue','demo',{type:'return',taskId:'WORK-1',note:' '},at).ok,false);approveRows(f);
 const b=workspace(f).textBatches[f.id];b.revision++;assert.equal(applyWorkOrder(workspace(f),f.p.settings,'wangyue','demo',{type:'accept',taskId:'WORK-1'},at).ok,false);
});
test('AI-produced text and image corrections retain source links without inheriting active prediction acceptance',()=>{
 for(const kind of ['text','image']){const p=decodeSnapshot(fs.readFileSync('examples/ai-completed-session.json','utf8')).platform;const w=p.workspaces.demo;const b=Object.values(kind==='image'?w.imageBatches:w.textBatches).find(b=>b.versions.some(v=>v.records.some(r=>r.aiAnnotation)));const v=b.versions.find(v=>v.records.some(r=>r.aiAnnotation));p.settings.members.find(m=>m.userId==='wangyue'&&m.spaceId==='demo').projectIds.push(b.projectId);p.settings.members.find(m=>m.userId==='liyi'&&m.spaceId==='demo').projectIds.push(b.projectId);
 const d=(type,extra={},actor='henry')=>{const r=applyWorkspaceDelivery(p.workspaces.demo,p.settings,actor,'demo',{type,orderId:'DLV-1',...extra},at);assert.equal(r.ok,true,r.error);p.workspaces.demo=r.workspace;};
 d('create',{projectId:b.projectId,versionId:v.id,customerId:'wangyue'});d('package',{checksum:'test',qualityReportId:'q',licenseRef:'l',manifest:['data.json']});d('submit');d('accept',{note:'通过'},'wangyue');d('openFeedback',{note:'纠错'},'wangyue');const r=createDeliveryCorrection(p.workspaces.demo,p.settings,'henry','demo',{orderId:'DLV-1',feedbackId:'DLV-1-FB-1',assigneeId:'liyi',reviewerId:'wangyue',dueAt},at);assert.equal(r.ok,true,r.error);p.workspaces.demo=r.workspace;
 const corrected=(kind==='image'?r.workspace.imageBatches:r.workspace.textBatches)[r.task.datasetId];assert.ok(corrected.records.every(row=>!row.aiAnnotation&&row.originSnapshot.versionId===v.id));assert.ok(r.workspace.delivery.orders[0].versionSnapshot.records.some(row=>row.aiAnnotation));assert.deepEqual(decodeSnapshot(encodeSnapshot(p)).platform,p);
 }
});

test('text/image sampling freezes selection, fails acceptance, and retains failed evidence through rework',()=>{
 for(const image of [false,true]){
  const f=fixture(image);work(f,'create',{datasetId:f.id,assigneeId:'liyi',reviewerId:'wangyue',dueAt,samplingPolicy:{rate:50,minimum:1,threshold:100}});
  work(f,'claim',{},'liyi');submitRows(f);work(f,'submit',{},'liyi');approveRows(f);
  const tryAction=(type,extra={},actor='wangyue')=>applyWorkOrder(workspace(f),f.p.settings,actor,'demo',{type,taskId:'WORK-1',...extra},at);
  assert.equal(tryAction('accept').ok,false);assert.equal(tryAction('startSampling',{},'liyi').ok,false);
  work(f,'startSampling',{},'wangyue');let t=workspace(f).workOrders.orders[0],r=t.samplingRounds[0];const frozen=structuredClone(r);
  assert.equal(r.sampleIds.length,Math.ceil(r.population.length/2));assert.equal(tryAction('startSampling').ok,false);assert.equal(tryAction('finishSampling').ok,false);
  assert.equal(tryAction('recordSampling',{recordId:'outsider',verdict:'pass',note:'x'}).ok,false);
  for(const recordId of r.sampleIds)work(f,'recordSampling',{recordId,verdict:'fail',note:'语义与标注不符'},'wangyue');
  assert.equal(tryAction('recordSampling',{recordId:r.sampleIds[0],verdict:'pass',note:'覆盖'}).ok,false);
  work(f,'finishSampling',{},'wangyue');assert.equal(tryAction('accept').ok,false);assert.equal(tryAction('startSampling').ok,false);
  const failed=structuredClone(workspace(f).workOrders.orders[0].samplingRounds[0]);
  work(f,'return',{note:'抽检不合格，全部返工'},'wangyue');work(f,'claim',{},'liyi');submitRows(f);work(f,'submit',{},'liyi');approveRows(f);work(f,'startSampling',{},'wangyue');
  t=workspace(f).workOrders.orders[0];r=t.samplingRounds[1];assert.equal(t.samplingRounds[0].status,'failed');assert.deepEqual(t.samplingRounds[0].results,failed.results);assert.deepEqual(t.samplingRounds[0].population,frozen.population);
  assert.ok(r.revision>frozen.revision);for(const recordId of r.sampleIds)work(f,'recordSampling',{recordId,verdict:'pass',note:'复核通过'},'wangyue');work(f,'finishSampling',{},'wangyue');work(f,'accept',{},'wangyue');data(f,'publish',{note:'抽检通过'});assert.deepEqual(decodeSnapshot(encodeSnapshot(f.p)).platform,f.p);
  for(const corrupt of [p=>p.workspaces.demo.workOrders.orders[0].samplingRounds[1].sampleIds.push('forged'),p=>p.workspaces.demo.workOrders.orders[0].samplingRounds[1].passRate=0,p=>p.workspaces.demo.workOrders.orders[0].samplingPolicy.threshold=1]){const p=structuredClone(f.p);corrupt(p);assert.throws(()=>decodeSnapshot(encodeSnapshot(p)),/抽检/);}
 }
});
test('sampling rejects invalid policies and stale results without mutating workspace',()=>{
 const f=fixture();for(const policy of [{rate:0,minimum:1,threshold:100},{rate:101,minimum:1,threshold:100},{rate:20,minimum:1.5,threshold:100},{rate:20,minimum:1,threshold:NaN}])assert.equal(applyWorkOrder(workspace(f),f.p.settings,'henry','demo',{type:'create',datasetId:f.id,assigneeId:'liyi',reviewerId:'wangyue',dueAt,samplingPolicy:policy},at).ok,false);
 work(f,'create',{datasetId:f.id,assigneeId:'liyi',reviewerId:'wangyue',dueAt,samplingPolicy:{rate:1,minimum:999,threshold:50}});work(f,'claim',{},'liyi');submitRows(f);work(f,'submit',{},'liyi');approveRows(f);work(f,'startSampling',{},'wangyue');const r=workspace(f).workOrders.orders[0].samplingRounds[0];assert.equal(r.sampleIds.length,2);
 work(f,'recordSampling',{recordId:r.sampleIds[0],verdict:'pass',note:'依据'},'wangyue');work(f,'recordSampling',{recordId:r.sampleIds[1],verdict:'fail',note:'依据'},'wangyue');work(f,'finishSampling',{},'wangyue');assert.equal(workspace(f).workOrders.orders[0].samplingRounds[0].status,'passed');
 workspace(f).textBatches[f.id].records[0].text+='被修改';const before=structuredClone(workspace(f));assert.equal(applyWorkOrder(workspace(f),f.p.settings,'wangyue','demo',{type:'accept',taskId:'WORK-1'},at).ok,false);assert.deepEqual(workspace(f),before);
});

function multiFixture(image=false){const f=fixture(image);f.p.settings.members.find(m=>m.userId==='zhangmin'&&m.spaceId==='demo').roleId='reviewer';f.p.settings.members.find(m=>m.userId==='zhangmin'&&m.spaceId==='demo').projectIds.push(image?'PRJ-003':'PRJ-001');return f;}
const chain=['wangyue','zhangmin','henry'];
function assignMulti(f,extra={}){return work(f,'create',{datasetId:f.id,assigneeId:'liyi',reviewerId:'wangyue',dueAt,approvalChain:chain,...extra});}
function readyMulti(f){work(f,'claim',{},'liyi');submitRows(f);work(f,'submit',{},'liyi');approveRows(f);}
test('text/image three-level approval requires distinct sequential actors and freezes evidence until final acceptance',()=>{
 for(const image of [false,true]){const f=multiFixture(image);assignMulti(f);readyMulti(f);
 const attempt=(actor,extra={})=>applyWorkOrder(workspace(f),f.p.settings,actor,'demo',{type:'accept',taskId:'WORK-1',note:'审核通过',...extra},at);
 for(const actor of ['liyi','zhangmin','henry'])assert.equal(attempt(actor).ok,false);
 assert.equal(attempt('wangyue',{note:''}).ok,false);work(f,'accept',{note:'逐条审核与质量检查完成'},'wangyue');
 assert.equal(workspace(f).workOrders.orders[0].status,'review');assert.equal(checkWorkOrderData(workspace(f),'henry',f.id,{type:'publish'}).ok,false);
 for(const type of ['approve','reject','checkQuality'])assert.equal(checkWorkOrderData(workspace(f),'wangyue',f.id,{type}).ok,false);
 assert.equal(attempt('wangyue').ok,false);assert.equal(attempt('henry').ok,false);assert.deepEqual(decodeSnapshot(encodeSnapshot(f.p)).platform,f.p);
 assert.ok(unifiedTodos(workspace(f)).some(t=>t.assigneeId==='zhangmin'&&t.detail.includes('复审')));
 work(f,'accept',{note:'独立核对结果'},'zhangmin');assert.equal(attempt('zhangmin').ok,false);work(f,'accept',{note:'交付标准满足'},'henry');data(f,'publish',{note:'三级审核完成'});
 assert.deepEqual(decodeSnapshot(encodeSnapshot(f.p)).platform,f.p);
 const p=structuredClone(f.p);p.workspaces.demo.workOrders.orders[0].approvalCycles[0].decisions[1].actorId='wangyue';assert.throws(()=>decodeSnapshot(encodeSnapshot(p)),/多级审核/);
 }
});
test('later-stage return preserves decisions and forces a new initial review and sampling round',()=>{
 const f=multiFixture();assignMulti(f,{samplingPolicy:{rate:100,minimum:1,threshold:100}});readyMulti(f);
 function sample(){work(f,'startSampling',{},'wangyue');for(const recordId of workspace(f).workOrders.orders[0].samplingRounds.at(-1).sampleIds)work(f,'recordSampling',{recordId,verdict:'pass',note:'抽检依据'},'wangyue');work(f,'finishSampling',{},'wangyue');}
 sample();work(f,'accept',{note:'初审完成'},'wangyue');const original=structuredClone(workspace(f).workOrders.orders[0].approvalCycles[0]);
 assert.equal(applyWorkOrder(workspace(f),f.p.settings,'wangyue','demo',{type:'startSampling',taskId:'WORK-1'},at).ok,false);
 work(f,'accept',{note:'复审完成'},'zhangmin');work(f,'return',{note:'终审发现遗漏'},'henry');
 assert.deepEqual(workspace(f).workOrders.orders[0].approvalCycles[0].decisions[0],original.decisions[0]);assert.deepEqual(decodeSnapshot(encodeSnapshot(f.p)).platform,f.p);
 work(f,'dispute',{note:'请求第三方核对'},'liyi');for(const actor of chain)assert.equal(applyWorkOrder(workspace(f),f.p.settings,actor,'demo',{type:'arbitrate',taskId:'WORK-1',note:'不能参与仲裁',decision:'review'},at).ok,false);
 // Independent arbiter is explicitly granted this project in this synthetic fixture.
 const m=f.p.settings.members.find(m=>m.userId==='linyue'&&m.spaceId==='demo');if(m){m.roleId='reviewer';m.projectIds.push('PRJ-001')}else f.p.settings.members.push({id:'test-arbiter',userId:'linyue',spaceId:'demo',roleId:'reviewer',projectIds:['PRJ-001'],status:'active'});
 work(f,'arbitrate',{decision:'rework',note:'维持返工'},'linyue');readyMulti(f);assert.equal(applyWorkOrder(workspace(f),f.p.settings,'wangyue','demo',{type:'accept',taskId:'WORK-1',note:'漏抽检'},at).ok,false);sample();
 for(const actor of chain)work(f,'accept',{note:'新修订复核'},actor);assert.equal(workspace(f).workOrders.orders[0].approvalCycles.length,2);assert.deepEqual(decodeSnapshot(encodeSnapshot(f.p)).platform,f.p);
});
test('invalid approval chains, reassignment conflicts, revoked reviewers and stale evidence fail atomically',()=>{
 const f=multiFixture();for(const approvalChain of [['wangyue','wangyue','henry'],['wangyue','liyi','henry'],['wangyue','chensi','henry'],['henry','zhangmin','wangyue']])assert.equal(applyWorkOrder(workspace(f),f.p.settings,'henry','demo',{type:'create',datasetId:f.id,assigneeId:'liyi',reviewerId:'wangyue',dueAt,approvalChain},at).ok,false);
 assignMulti(f);assert.equal(applyWorkOrder(workspace(f),f.p.settings,'henry','demo',{type:'reassign',taskId:'WORK-1',assigneeId:'zhangmin',dueAt:'2026-11-02T00:00:00Z',note:'转派冲突'},'2026-10-31T00:00:00Z').ok,false);readyMulti(f);work(f,'accept',{note:'初审'},'wangyue');
 const member=f.p.settings.members.find(m=>m.userId==='zhangmin'&&m.spaceId==='demo');member.status='inactive';const action={type:'accept',taskId:'WORK-1',note:'复审'};assert.equal(applyWorkOrder(workspace(f),f.p.settings,'zhangmin','demo',action,at).ok,false);member.status='active';workspace(f).textBatches[f.id].records[0].text+='变化';const before=structuredClone(workspace(f));assert.equal(applyWorkOrder(workspace(f),f.p.settings,'zhangmin','demo',action,at).ok,false);assert.deepEqual(workspace(f),before);assert.throws(()=>decodeSnapshot(encodeSnapshot(f.p)),/多级审核/);
});

test('feedback corrections inherit multi-level review and sampling without downgrading acceptance',()=>{
 const f=multiFixture();assignMulti(f,{samplingPolicy:{rate:100,minimum:1,threshold:100}});readyMulti(f);work(f,'startSampling',{},'wangyue');for(const recordId of workspace(f).workOrders.orders[0].samplingRounds[0].sampleIds)work(f,'recordSampling',{recordId,verdict:'pass',note:'确认'},'wangyue');work(f,'finishSampling',{},'wangyue');for(const actor of chain)work(f,'accept',{note:'通过'},actor);const v=data(f,'publish',{note:'交付'}).version;
 function delivery(type,extra={},actor='henry'){const r=applyWorkspaceDelivery(workspace(f),f.p.settings,actor,'demo',{type,orderId:'DLV-1',...extra},at);assert.equal(r.ok,true,r.error);f.p.workspaces.demo=r.workspace;}
 delivery('create',{projectId:'PRJ-001',versionId:v.id,customerId:'wangyue'});delivery('package',{checksum:'test',qualityReportId:'q',licenseRef:'l',manifest:['data.json']});delivery('submit');delivery('accept',{note:'验收'},'wangyue');delivery('openFeedback',{note:'纠错'},'wangyue');
 const r=createDeliveryCorrection(workspace(f),f.p.settings,'henry','demo',{orderId:'DLV-1',feedbackId:'DLV-1-FB-1',assigneeId:'liyi',reviewerId:'wangyue',dueAt},at);assert.equal(r.ok,true,r.error);assert.deepEqual(r.task.approvalChain,chain);assert.deepEqual(r.task.samplingPolicy,{rate:100,minimum:1,threshold:100});f.p.workspaces.demo=r.workspace;assert.deepEqual(decodeSnapshot(encodeSnapshot(f.p)).platform,f.p);
});

test('deadline boundaries, completed work and stage ownership produce accurate non-mutating todos',async()=>{
 const {workTiming,workOwner}=await import('../src/production-deadlines.js');const f=multiFixture();assignMulti(f);const t=workspace(f).workOrders.orders[0],before=structuredClone(workspace(f));
 assert.equal(workTiming(t,'2026-10-29T08:59:59Z').state,'normal');assert.equal(workTiming(t,at).state,'soon');assert.equal(workTiming(t,dueAt).state,'overdue');assert.equal(workOwner(t),'liyi');
 assert.equal(unifiedTodos(workspace(f),dueAt).find(x=>x.taskId===t.id).deadlineState,'overdue');assert.deepEqual(workspace(f),before);
 readyMulti(f);assert.equal(workOwner(workspace(f).workOrders.orders[0]),'wangyue');work(f,'accept',{note:'初审'},'wangyue');assert.equal(workOwner(workspace(f).workOrders.orders[0]),'zhangmin');work(f,'accept',{note:'复审'},'zhangmin');work(f,'accept',{note:'终审'},'henry','2026-10-30T10:00:00Z');
 const done=workspace(f).workOrders.orders[0];assert.equal(workTiming(done,'2099-01-01').state,'completed');assert.equal(workTiming(done,at).completedLate,true);assert.equal(workOwner(done),null);assert.ok(!unifiedTodos(workspace(f),'2099-01-01').some(x=>x.taskId===t.id));
 assert.equal(workOwner({...t,status:'disputed'}),null);
});
test('deadline extension and overdue transfer retain original evidence and reject unauthorized or invalid changes',()=>{
 const f=fixture();assign(f);const attempt=(extra,actor='henry',time=at)=>applyWorkOrder(workspace(f),f.p.settings,actor,'demo',{type:'extendDeadline',taskId:'WORK-1',note:'计划调整',...extra},time);
 for(const dueAt of ['bad','2026-10-28T00:00:00Z','2026-10-30T09:00:00Z'])assert.equal(attempt({dueAt}).ok,false);
 assert.equal(attempt({dueAt:'2026-11-01T00:00:00Z'},'liyi').ok,false);assert.equal(attempt({dueAt:'2026-11-01T00:00:00Z',note:' '}).ok,false);
 const b=structuredClone(workspace(f).textBatches[f.id]);work(f,'extendDeadline',{dueAt:'2026-11-01T00:00:00Z',note:'  依赖延迟  '},'henry',dueAt);let t=workspace(f).workOrders.orders[0];assert.equal(t.deadlineChanges[0].wasOverdue,true);assert.equal(t.deadlineChanges[0].fromDueAt,dueAt);assert.deepEqual(workspace(f).textBatches[f.id],b);
 assert.equal(attempt({dueAt:'2026-11-01T00:00:00Z'}).ok,false);work(f,'reassign',{assigneeId:'zhangmin',dueAt:'2026-11-02T00:00:00Z',note:'超时转派'},'henry','2026-11-01T00:00:00Z');t=workspace(f).workOrders.orders[0];assert.equal(t.deadlineChanges[1].fromAssigneeId,'liyi');assert.equal(t.deadlineChanges[1].toAssigneeId,'zhangmin');assert.deepEqual(decodeSnapshot(encodeSnapshot(f.p)).platform,f.p);
 const p=structuredClone(f.p);p.workspaces.demo.workOrders.orders[0].deadlineChanges[0].wasOverdue=false;assert.throws(()=>decodeSnapshot(encodeSnapshot(p)),/期限/);
});
test('review-stage extensions preserve approvals while transfer and completed extensions remain blocked',()=>{
 const f=multiFixture();assignMulti(f);readyMulti(f);work(f,'accept',{note:'初审'},'wangyue');const before=structuredClone(workspace(f).workOrders.orders[0].approvalCycles);
 work(f,'extendDeadline',{dueAt:'2026-11-02T00:00:00Z',note:'延长复审时间'},'henry');assert.deepEqual(workspace(f).workOrders.orders[0].approvalCycles,before);
 assert.equal(applyWorkOrder(workspace(f),f.p.settings,'henry','demo',{type:'reassign',taskId:'WORK-1',assigneeId:'linyue',dueAt:'2026-11-04T00:00:00Z',note:'审核中改派'},'2026-11-03T00:00:00Z').ok,false);
 work(f,'accept',{note:'复审'},'zhangmin');work(f,'accept',{note:'最终验收'},'henry');assert.equal(applyWorkOrder(workspace(f),f.p.settings,'henry','demo',{type:'extendDeadline',taskId:'WORK-1',dueAt:'2026-11-04T00:00:00Z',note:'改历史'},at).ok,false);assert.deepEqual(decodeSnapshot(encodeSnapshot(f.p)).platform,f.p);
});


test('already assigned text/image batches can enter work-order management without rewriting assignment history',()=>{
 for(const image of [false,true]){const f=fixture(image),key=image?'imageBatches':'textBatches';const fn=image?applyImageBatchAction:applyTextBatchAction;const r=fn(workspace(f)[key][f.id],{type:'assign',assignee:'李一',at});assert.equal(r.ok,true,r.error);workspace(f)[key][f.id]=r.batch;const before=structuredClone(r.batch);assign(f);const after=workspace(f)[key][f.id];assert.equal(after.revision,before.revision);assert.deepEqual(after.records.map(({reviewerId,...r})=>r),before.records);work(f,'claim',{},'liyi');}
});

test('overdue partial and fully submitted batches transfer without changing submitted text/image evidence',()=>{
 for(const image of [false,true])for(const all of [false,true]){
  const f=fixture(image),key=image?'imageBatches':'textBatches';assign(f);work(f,'claim',{},'liyi');const rows=workspace(f)[key][f.id].records;const submitted=all?rows:rows.slice(0,1);for(const row of submitted)data(f,'submit',image?{recordId:row.id,boxes:[],noDefect:true}:{taskId:row.id,label:'物流'});
  const before=structuredClone(workspace(f)[key][f.id].records.filter(r=>r.status==='review'));
  work(f,'reassign',{assigneeId:'henry',dueAt:'2026-11-02T00:00:00Z',note:'原成员离岗，保留已提交样本'},'henry','2026-10-31T00:00:00Z');assert.deepEqual(workspace(f)[key][f.id].records.filter(r=>r.status==='review'),before);
  assert.equal(checkWorkOrderData(workspace(f),'liyi',f.id,{type:'saveDraft'}).ok,false);work(f,'claim',{},'henry');
  for(const row of workspace(f)[key][f.id].records.filter(r=>r.status==='todo'))data(f,'submit',image?{recordId:row.id,boxes:[],noDefect:true}:{taskId:row.id,label:'物流'},'henry');
  assert.deepEqual(workspace(f)[key][f.id].records.filter(r=>before.some(x=>x.id===r.id)),before);work(f,'submit',{},'henry');approveRows(f);work(f,'accept',{},'wangyue');data(f,'publish',{note:'保留原提交后继续完成'});assert.deepEqual(decodeSnapshot(encodeSnapshot(f.p)).platform,f.p);
 }
});


test('managed correction descendants cannot substitute unrelated versions, including legacy feedback closure and restore',()=>{
 const f=fixture();assign(f);work(f,'claim',{},'liyi');submitRows(f);work(f,'submit',{},'liyi');approveRows(f);work(f,'accept',{},'wangyue');const original=data(f,'publish',{note:'原版本'}).version;
 const d=(type,extra={},actor='henry')=>{const r=applyWorkspaceDelivery(workspace(f),f.p.settings,actor,'demo',{type,orderId:'DLV-1',...extra},at);assert.equal(r.ok,true,r.error);f.p.workspaces.demo=r.workspace;};const pack={checksum:'x',qualityReportId:'q',licenseRef:'l',manifest:['data']};
 d('create',{projectId:'PRJ-001',versionId:original.id,customerId:'wangyue'});d('package',pack);d('submit');d('accept',{note:'通过'},'wangyue');d('openFeedback',{note:'纠错'},'wangyue');
 const r=createDeliveryCorrection(workspace(f),f.p.settings,'henry','demo',{orderId:'DLV-1',feedbackId:'DLV-1-FB-1',assigneeId:'liyi',reviewerId:'wangyue',dueAt},at);assert.equal(r.ok,true,r.error);f.p.workspaces.demo=r.workspace;f.id=r.task.datasetId;
 work(f,'claim',{taskId:'WORK-2'},'liyi');submitRows(f);work(f,'submit',{taskId:'WORK-2'},'liyi');approveRows(f);work(f,'accept',{taskId:'WORK-2'},'wangyue');const corrected=data(f,'publish',{note:'纠错版本'}).version;
 d('requestRevision',{newVersionId:corrected.id,feedbackId:'DLV-1-FB-1',note:'补交'});d('package',{...pack,orderId:'DLV-2'});d('submit',{orderId:'DLV-2'});d('reject',{orderId:'DLV-2',note:'未通过'},'wangyue');
 assert.equal(applyWorkspaceDelivery(workspace(f),f.p.settings,'henry','demo',{type:'requestRevision',orderId:'DLV-2',newVersionId:original.id,note:'换无关版本'},at).ok,false);
 // Reconstruct a legacy chain using the pure reducer, bypassing today's workspace gate.
 const legacy=(type,extra={},actor='henry')=>{const w=workspace(f),r=applyDeliveryAction(w.delivery,{type,...extra},{actorId:actor,at,canAccess:()=>true,versionEligible:()=>true});assert.equal(r.ok,true,r.error);w.delivery=r.state;return r.order;};
 const bad=legacy('requestRevision',{orderId:'DLV-2',newVersionId:original.id,note:'旧旁路'});bad.versionSnapshot=structuredClone(original);legacy('package',{orderId:bad.id,...pack});legacy('submit',{orderId:bad.id});legacy('accept',{orderId:bad.id,note:'旧旁路签收'},'wangyue');
 assert.equal(applyWorkspaceDelivery(workspace(f),f.p.settings,'henry','demo',{type:'closeFeedback',orderId:'DLV-1',feedbackId:'DLV-1-FB-1',note:'无关版本不能关闭'},at).ok,false);
 legacy('closeFeedback',{orderId:'DLV-1',feedbackId:'DLV-1-FB-1',note:'旧旁路关闭'});assert.throws(()=>decodeSnapshot(encodeSnapshot(f.p)),/工单/);
});

test('sampling exact threshold boundaries agree at completion and snapshot validation',async()=>{
 const {applySampling,validateSampling}=await import('../src/production-sampling.js');
 for(const [total,passed,threshold,expected] of [[50,29,58,'passed'],[50,29,59,'failed'],[3,2,66.67,'failed'],[50,30,58,'passed']]){
  const b={revision:1,quality:{status:'passed',revision:1},records:Array.from({length:total},(_,i)=>({id:String(i),status:'approved'}))};const t={reviewerId:'wangyue',status:'review',samplingPolicy:{rate:100,minimum:1,threshold},samplingRounds:[]};
  assert.equal(applySampling(t,b,{type:'startSampling'},'wangyue',at).ok,true);const r=t.samplingRounds[0];for(const [i,recordId] of r.sampleIds.entries())assert.equal(applySampling(t,b,{type:'recordSampling',recordId,verdict:i<passed?'pass':'fail',note:'边界用例'},'wangyue',at).ok,true);
  assert.equal(applySampling(t,b,{type:'finishSampling'},'wangyue',at).ok,true);assert.equal(r.status,expected);validateSampling(t,b);
  const bad=structuredClone(t);bad.samplingRounds[0].status=expected==='passed'?'failed':'passed';assert.throws(()=>validateSampling(bad,b),/抽检/);
 }
});
