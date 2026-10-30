import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createGovernanceState,applyGovernanceAction,checkGovernanceAction,sourceCatalog,sourceIdsForVersion,affectedAssets,checkSampleOverlap,makeEvaluationAcceptance,evidenceSummary,haltGovernedWork,validateGovernance,recordGovernanceUse,enableGovernance} from '../src/governance-state.js';
import {authorizeAction,visibleWorkspace,workspaceVersions} from '../src/platform-policy.js';
import {createTextBatch,applyTextBatchAction} from '../src/text-production-state.js';
import {applyModelLifecycleAction} from '../src/model-lifecycle-state.js';
import {applyAIAnnotationAction} from '../src/ai-annotation-state.js';
import {encodeSnapshot,decodeSnapshot} from '../src/persistence.js';
const at='2026-10-27T09:30:00Z';
function fixture(){const p=JSON.parse(fs.readFileSync(new URL('../examples/ai-completed-session.json',import.meta.url),'utf8')).payload;const w=p.workspaces.demo;w.governance=createGovernanceState();return {p,w};}
const ctx={actorId:'henry',actorName:'演示管理员',users:[{id:'henry',name:'演示管理员'},{id:'liyi',name:'李一'}],canApproveUser:()=>true};
function action(f,type,rest={},context=ctx){const r=applyGovernanceAction(f.w,{type,...rest,at},context);if(r.ok){f.w=r.workspace;f.p.workspaces.demo=f.w;}return r;}
function yes(f,type,rest={},context=ctx){const r=action(f,type,rest,context);assert.equal(r.ok,true,r.error);return r.entity;}
function charter(f,projectId='PRJ-001') {const c=yes(f,'saveCharter',{projectId,goal:'降低人工重复工作',feasibility:'样本可获得，先用本地模拟验证流程',ownerId:'henry',approverId:'henry',qualityOwnerId:'liyi',acceptanceText:'按冻结指标审核；真实效果需独立试点证据',exitConditions:'来源授权无法确认或质量未达标则退出'});yes(f,'submitCharter',{charterId:c.id});yes(f,'decideCharter',{charterId:c.id,decision:'approve',note:'明确范围后批准'});return c;}
function admit(f,sourceId='data:customer',purposes=['processing','annotation','training','evaluation','knowledge','serving','sharing']) {const x=yes(f,'saveAdmission',{sourceId,provider:'演示数据提供方',licenseRef:'仅用于本地原型的合成样例说明',purposeNote:'治理流程演示，不代表真实数据权利认证',purposes,validUntil:'2026-12-31T23:59:59Z',approverId:'henry'});yes(f,'submitAdmission',{admissionId:x.id});yes(f,'decideAdmission',{admissionId:x.id,decision:'approve',note:'确认本地演示范围'});return x;}
test('charters require explicit roles, feasibility, acceptance and exit; approvals bind a frozen task plan',()=>{
 const f=fixture();assert.equal(action(f,'saveCharter',{projectId:'PRJ-001',goal:'空缺'}).ok,false);const c=charter(f);const saved=f.w.governance.charters.find(x=>x.id===c.id);assert.equal(saved.status,'approved');assert.equal(saved.planSnapshot.id,'PLAN-1');assert.ok(saved.rolesSnapshot.qualityOwnerId);
 const old=JSON.stringify(saved);const next=yes(f,'saveCharter',{...saved,goal:'新目标'});assert.notEqual(next.id,c.id);assert.equal(JSON.stringify(f.w.governance.charters.find(x=>x.id===c.id)),old);
 assert.equal(action(f,'decideCharter',{charterId:next.id,decision:'approve',note:'未提交'}).ok,false);
});
test('only assigned approvers decide, rejection can be revised, and closed projects stop new use',()=>{
 const f=fixture(),c=charter(f);admit(f);assert.equal(action(f,'closeCharter',{charterId:c.id,note:'结束'}, {...ctx,actorId:'liyi'}).ok,false);yes(f,'closeCharter',{charterId:c.id,note:'达到退出条件'});assert.match(checkGovernanceAction(f.w,'model',{type:'startTraining',dataVersionId:'customer:v0.2'},{at}).error,/立项|关闭/);
});
test('unadmitted, wrong-purpose, expired and revoked sources cannot enter a new downstream operation',()=>{
 const f=fixture();charter(f);const a={type:'startTraining',dataVersionId:'customer:v0.2'};assert.equal(checkGovernanceAction(f.w,'model',a,{at}).ok,false);admit(f,'data:customer',['annotation']);assert.match(checkGovernanceAction(f.w,'model',a,{at}).error,/用途/);
 const lic=admit(f);yes(f,'assignDataPurpose',{versionId:'customer:v0.2',purpose:'training'});assert.equal(checkGovernanceAction(f.w,'model',a,{at}).ok,true);assert.equal(checkGovernanceAction(f.w,'model',a,{at:'2027-01-01T00:00:00Z'}).ok,false);
 yes(f,'revokeAdmission',{admissionId:lic.id,note:'提供方撤回'});assert.equal(checkGovernanceAction(f.w,'model',a,{at}).ok,false);assert.equal(f.w.governance.admissions.find(x=>x.id===lic.id).status,'revoked');
});
test('revocation records existing data/model/service/AI consumers without rewriting historical artifacts',()=>{
 const f=fixture();charter(f);const lic=admit(f),before=JSON.stringify(f.w.modelState);const impact=affectedAssets(f.w,'data:customer');assert.ok(impact.some(x=>x.type==='model'));assert.ok(impact.some(x=>x.type==='service'));assert.ok(impact.some(x=>x.type==='ai-job'));
 yes(f,'revokeAdmission',{admissionId:lic.id,note:'撤回本次许可'});assert.equal(JSON.stringify(f.w.modelState),before);assert.ok(f.w.governance.admissions.find(x=>x.id===lic.id).withdrawal.impactSnapshot.length>0);assert.ok(f.w.governance.admissions.find(x=>x.id===lic.id).withdrawal.impactSnapshot.every(x=>x.projectId));
});
test('derived P1 and AI versions retain all leaf source requirements, including hidden or withdrawn parents',()=>{
 const f=fixture();charter(f);admit(f);const v=f.w.flow.versions[0];assert.ok(sourceIdsForVersion(f.w,v).includes('data:customer'));const next=f.w.aiAnnotation.jobs.find(j=>f.w.modelState.models.some(m=>m.id===j.modelVersionId&&m.type!=='image'&&m.dataVersionId!=='customer:v0.2'));assert.ok(next);
 const sources=checkGovernanceAction(f.w,'annotation',{type:'createPredictionJob',datasetId:next.datasetId},{at});assert.equal(sources.ok,true,sources.error);
 assert.ok(sourceCatalog(f.w).some(x=>x.id==='doc:DOC-1'));
});
test('normalized text overlap is detected across version IDs and labels; distinct held-out records pass',()=>{
 const train={id:'t',datasetId:'train',records:[{id:'a',text:'  Hello\u3000World ',label:'甲'}]},same={id:'e',datasetId:'eval',records:[{id:'different',text:'hello world',label:'乙'}]};
 const r=checkSampleOverlap(train,same);assert.equal(r.overlapCount,1);assert.match(r.matches[0].reasons.join(),/内容/);assert.equal(checkSampleOverlap(train,{...same,records:[{id:'a',text:'独立样本'}]}).overlapCount,0);
});
test('image byte identity and edited descendants are detected independently of filenames/version IDs',()=>{
 const train={id:'t',datasetId:'images',type:'image',records:[{id:'i',src:'data:image/png;base64,YWJj',width:10,height:10}]};
 assert.equal(checkSampleOverlap(train,{id:'e',datasetId:'other',type:'image',records:[{id:'new',name:'new.png',src:'data:image/png;base64,YWJj',width:10,height:10}]}).overlapCount,1);
 assert.equal(checkSampleOverlap({id:'t',datasetId:'base',records:[{id:'a',text:'原文'}]},{id:'e',datasetId:'child',records:[{id:'b',text:'修订原文',parents:[{versionId:'t',recordId:'a'}]}]}).overlapCount,1);
});
test('training/evaluation purposes cannot be interchanged after use; overlapping independent acceptance is rejected',()=>{
 const f=fixture();charter(f);admit(f);yes(f,'assignDataPurpose',{versionId:'customer:v0.2',purpose:'training'});const model=f.w.modelState.models.find(m=>m.dataVersionId==='customer:v0.2');
 assert.equal(makeEvaluationAcceptance(f.w,model,model.dataVersion,{evaluationMode:'independent',at}).ok,false);
 const replay=makeEvaluationAcceptance(f.w,model,model.dataVersion,{evaluationMode:'replay',at});assert.equal(replay.ok,true,replay.error);assert.equal(replay.snapshot.realEffectEligible,false);assert.equal(replay.snapshot.integrity.mode,'replay');
});
test('cost evidence freezes baseline and methodology, labels assumptions, and never promotes simulation to real improvement',()=>{
 const f=fixture();charter(f);const e=yes(f,'saveEvidence',{projectId:'PRJ-001',name:'成本口径',basis:'simulation',baselineVersionId:'customer:v0.2',baselineDescription:'原人工流程',sampleCount:3,environment:'本地浏览器，无真实GPU',method:'相同样本与质量口径对照',period:'演示窗口',assumptions:'数量和单价均为假设',sources:['本地合成场景'],costs:[{phase:'baseline',category:'annotation',quantity:2,unit:'工时',unitPrice:10},{phase:'result',category:'annotation',quantity:1,unit:'工时',unitPrice:10}]});
 assert.equal(evidenceSummary(e).assumedDifference,10);assert.equal(evidenceSummary(e).realEffectEligible,false);assert.equal(action(f,'reviewEvidence',{evidenceId:e.id,note:'希望宣传真实节省',claimRealImprovement:true},{...ctx,actorId:'liyi'}).ok,false);
 yes(f,'reviewEvidence',{evidenceId:e.id,note:'只验收演示口径'},{...ctx,actorId:'liyi'});assert.equal(f.w.governance.evidence[0].status,'reviewed-simulation');assert.equal(evidenceSummary(f.w.governance.evidence[0]).realEffectEligible,false);
});
test('missing evidence remains incomplete; negative or nonfinite cost assumptions are rejected',()=>{
 const f=fixture();charter(f);const e=yes(f,'saveEvidence',{projectId:'PRJ-001',name:'待补材料',basis:'external-observation',costs:[]});assert.ok(evidenceSummary(e).missing.length);assert.equal(action(f,'reviewEvidence',{evidenceId:e.id,note:'没有材料'},{...ctx,actorId:'liyi'}).ok,false);
 assert.equal(action(f,'saveEvidence',{projectId:'PRJ-001',name:'非法成本',basis:'simulation',costs:[{phase:'result',category:'api',quantity:-1,unit:'次',unitPrice:2}]}).ok,false);
});
test('full snapshots preserve governance decisions; invalid source and altered approved charters are refused',()=>{
 const f=fixture();charter(f);admit(f);f.p.workspaces.demo=f.w;assert.ok(decodeSnapshot(encodeSnapshot(f.p)).platform.workspaces.demo.governance);
 const bad=structuredClone(f.p);bad.workspaces.demo.governance.charters[0].goal='偷偷修改';assert.throws(()=>decodeSnapshot(encodeSnapshot(bad)),/治理|立项/);
 const orphan=structuredClone(f.p);orphan.workspaces.demo.governance.admissions[0].sourceId='missing';assert.throws(()=>decodeSnapshot(encodeSnapshot(orphan)),/治理|准入/);
});
test('legacy state reducers remain compatible while enabled governance applies through normal role authorization',()=>{
 const f=fixture(),a={type:'invokeService',serviceId:f.w.modelState.services[0].id};assert.equal(authorizeAction(f.p.settings,'henry','demo',f.w,'model',a).ok,false);
 delete f.w.governance;assert.equal(checkGovernanceAction(f.w,'model',a,{at}).ok,true);assert.ok(decodeSnapshot(encodeSnapshot(f.p)).platform);
});
function heldout(f,duplicate=false){const m=f.w.modelState.models.find(m=>m.dataVersionId==='customer:v0.2'),spec={versionId:'gov-heldout-spec',name:'独立分类规范',labels:m.labels.map(name=>({name}))};let b=createTextBatch({datasetId:duplicate?'gov-copy':'gov-heldout',name:duplicate?'复制版本':'独立验收数据',projectId:'PRJ-001',projectName:'客户反馈意图分类',specSnapshot:spec,rawRecords:duplicate?m.dataVersion.records.map((r,i)=>({id:'different-'+i,text:r.text,referenceLabel:r.label})):[{id:'heldout-one',text:'订单已经送到驿站但尚未领取',referenceLabel:'物流'},{id:'heldout-two',text:'保修期内需要维修配件',referenceLabel:'售后'}],at});const go=(type,rest={})=>{const r=applyTextBatchAction(b,{type,...rest,at});assert.equal(r.ok,true,r.error);b=r.batch;};go('clean');go('assign',{assignee:'演示管理员'});for(const r of b.records){go('submit',{taskId:r.id,label:r.referenceLabel});go('approve',{taskId:r.id});}go('checkQuality');go('publish',{note:'独立数据准备'});f.w.textBatches[b.id]=b;f.w.datasets.push({id:b.id,name:b.name,type:'text'});admit(f,'data:'+b.id);yes(f,'assignDataPurpose',{versionId:b.versions[0].id,purpose:'evaluation'});return b.versions[0];}
function modelAction(f,type,rest={}){const a={type,...rest,at},access=checkGovernanceAction(f.w,'model',a,{at});if(!access.ok)return access;const r=applyModelLifecycleAction(f.w.modelState,a,{versions:workspaceVersions(f.w),concurrency:2,gpu:1,acceptanceFactory:(m,v,a)=>makeEvaluationAcceptance(f.w,m,v,a)});if(r.state){f.w={...f.w,modelState:r.state};f.p.workspaces.demo=f.w;}return r;}
test('independent held-out samples pass real overlap checks and freeze charter, licences, metrics and baseline into the report',()=>{
 const f=fixture();charter(f);admit(f);const v=heldout(f),model=f.w.modelState.models.find(m=>m.dataVersionId==='customer:v0.2');const thresholds=f.w.flow.planVersions.find(p=>p.projectId==='PRJ-001').metrics;
 const r=modelAction(f,'startEvaluation',{modelVersionId:model.id,dataVersionId:v.id,evaluationMode:'independent',scenario:'pass',thresholds});assert.equal(r.ok,true,r.error);const snap=structuredClone(r.entity.acceptanceSnapshot);assert.equal(snap.integrity.overlapCount,0);assert.equal(snap.integrity.mode,'independent');assert.equal(snap.realEffectEligible,false);assert.equal(r.entity.thresholds.accuracy,thresholds.accuracy);
 for(let i=0;i<4;i++){const t=applyModelLifecycleAction(f.w.modelState,{type:'tick',at},{versions:workspaceVersions(f.w)});f.w.modelState=t.state;}assert.equal(f.w.modelState.evaluations[0].status,'passed');assert.deepEqual(f.w.modelState.evaluations[0].acceptanceSnapshot,snap);validateGovernance(f.w);
 const bad=modelAction(f,'startEvaluation',{modelVersionId:model.id,dataVersionId:v.id,evaluationMode:'independent',scenario:'pass',thresholds:{accuracy:1,macroF1:1}});assert.equal(bad.ok,false);assert.match(bad.error,/门槛|指标/);
});
test('different version and record IDs do not bypass actual-content contamination rejection',()=>{
 const f=fixture();charter(f);admit(f);const v=heldout(f,true),m=f.w.modelState.models.find(m=>m.dataVersionId==='customer:v0.2'),before=JSON.stringify(f.w.modelState);const r=modelAction(f,'startEvaluation',{modelVersionId:m.id,dataVersionId:v.id,evaluationMode:'independent',scenario:'pass'});assert.equal(r.ok,false);assert.match(r.error,/重叠/);assert.equal(JSON.stringify(f.w.modelState),before);
 const replay=modelAction(f,'startEvaluation',{modelVersionId:m.id,dataVersionId:v.id,evaluationMode:'replay',scenario:'pass',thresholds:f.w.flow.planVersions[0].metrics});assert.equal(replay.ok,true,replay.error);assert.equal(replay.entity.acceptanceSnapshot.realEffectEligible,false);
});
test('revoking permission halts a started training before model registration while preserving previous models and services',()=>{
 const f=fixture();charter(f);const lic=admit(f);yes(f,'assignDataPurpose',{versionId:'customer:v0.2',purpose:'training'});const oldModels=JSON.stringify(f.w.modelState.models),oldServices=JSON.stringify(f.w.modelState.services);const r=modelAction(f,'startTraining',{name:'撤回中止用例',dataVersionId:'customer:v0.2',base:'Qwen',params:{rank:16,epochs:3,rate:0.0002,batch:4}});assert.equal(r.ok,true,r.error);yes(f,'revokeAdmission',{admissionId:lic.id,note:'运行期间撤回'});const halted=haltGovernedWork(f.w,at);assert.equal(halted.workspace.modelState.trainings.find(t=>t.id===r.entity.id).status,'failed');assert.equal(JSON.stringify(halted.workspace.modelState.models),oldModels);assert.equal(JSON.stringify(halted.workspace.modelState.services),oldServices);
});
test('in-flight AI prediction is stopped by source revocation and produces no new prediction records',()=>{
 const f=fixture();charter(f);const lic=admit(f),existing=f.w.aiAnnotation.jobs.find(j=>f.w.modelState.models.some(m=>m.id===j.modelVersionId&&m.type!=='image'&&m.dataVersionId!=='customer:v0.2'));let w=f.w;const ai=(type,rest={})=>{const r=applyAIAnnotationAction(w,{type,...rest,at},{actorId:'henry',checkJob:j=>checkGovernanceAction(w,'annotation',{type:'startPredictionJob',jobId:j.id},{at}).error||''});assert.equal(r.ok,true,r.error);w=r.workspace;return r.entity;};const job=ai('createPredictionJob',{datasetId:existing.datasetId,name:'撤回中的新预测'});ai('startPredictionJob',{jobId:job.id});f.w=w;const count=w.aiAnnotation.predictions.length;yes(f,'revokeAdmission',{admissionId:lic.id,note:'停止新增标注使用'});w=f.w;ai('advancePredictionJobs');assert.equal(w.aiAnnotation.jobs.find(j=>j.id===job.id).status,'failed');assert.equal(w.aiAnnotation.predictions.length,count);
});
test('knowledge, agent, service and market operations resolve every source; stop and revoke actions remain available',()=>{
 const f=fixture();charter(f);charter(f,'PRJ-002');const customer=admit(f),doc=admit(f,'doc:DOC-1');const agent=f.w.completion.agents[0];assert.equal(checkGovernanceAction(f.w,'completion',{type:'runAgent',agentId:agent.id},{at}).ok,true);yes(f,'revokeAdmission',{admissionId:doc.id,note:'撤回文档用途'});assert.equal(checkGovernanceAction(f.w,'completion',{type:'runAgent',agentId:agent.id},{at}).ok,false);
 const service=f.w.modelState.services.find(s=>s.dataVersionId==='customer:v0.2');assert.equal(checkGovernanceAction(f.w,'model',{type:'invokeService',serviceId:service.id},{at}).ok,true);yes(f,'revokeAdmission',{admissionId:customer.id,note:'撤回服务来源'});assert.equal(checkGovernanceAction(f.w,'model',{type:'invokeService',serviceId:service.id},{at}).ok,false);assert.equal(checkGovernanceAction(f.w,'completion',{type:'listAsset',assetId:'service:'+service.id},{at}).ok,false);assert.equal(checkGovernanceAction(f.w,'model',{type:'offlineService',serviceId:service.id},{at}).ok,true);
});
test('source material changes invalidate old admission and stale pending approval without deleting its audit history',()=>{
 const f=fixture();charter(f,'PRJ-002');const lic=admit(f,'doc:DOC-1');const source=f.w.completion.documents.find(d=>d.id==='DOC-1');source.content+='\n新增未审阅材料';source.revision++;
 const gate=checkGovernanceAction(f.w,'completion',{type:'repairDocument',documentId:source.id},{at});assert.equal(gate.ok,false);assert.match(gate.error,/内容已变化/);assert.equal(f.w.governance.admissions.find(p=>p.id===lic.id).status,'approved');const pending=yes(f,'saveAdmission',{sourceId:'doc:DOC-1',provider:'演示提供方',licenseRef:'新许可材料',purposeNote:'仅本地验证',purposes:['knowledge'],validUntil:'2026-12-31T00:00:00Z',approverId:'henry'});yes(f,'submitAdmission',{admissionId:pending.id});f.w.completion.documents.find(d=>d.id==='DOC-1').content+='再次变化';assert.equal(action(f,'decideAdmission',{admissionId:pending.id,decision:'approve',note:'过期草稿'}).ok,false);validateGovernance(f.w);
});
test('quality acceptance freezes reviewed evidence and remains explicitly simulated; altered reviewed costs are rejected',()=>{
 const f=fixture();charter(f);admit(f);const v=heldout(f),m=f.w.modelState.models.find(m=>m.dataVersionId==='customer:v0.2');const r=modelAction(f,'startEvaluation',{modelVersionId:m.id,dataVersionId:v.id,evaluationMode:'independent',scenario:'pass',thresholds:f.w.flow.planVersions[0].metrics});assert.equal(r.ok,true,r.error);for(let i=0;i<4;i++)f.w.modelState=applyModelLifecycleAction(f.w.modelState,{type:'tick',at},{versions:workspaceVersions(f.w)}).state;
 assert.equal(checkGovernanceAction(f.w,'model',{type:'publishService',modelVersionId:m.id,evaluationId:r.entity.id},{at}).ok,false);const e=yes(f,'saveEvidence',{projectId:'PRJ-001',name:'验收证据',basis:'simulation',baselineVersionId:'customer:v0.2',baselineDescription:'人工作业基线',sampleCount:2,environment:'浏览器模拟',method:'固定样本可复演步骤',period:'演示窗口',assumptions:'非实际账单',sources:['合成示例'],costs:[{phase:'baseline',category:'annotation',quantity:1,unit:'工时',unitPrice:10}]});yes(f,'reviewEvidence',{evidenceId:e.id,note:'复核口径'},{...ctx,isAdmin:true});const acceptance=yes(f,'recordAcceptance',{evaluationId:r.entity.id,evidenceId:e.id,note:'仅验收本地流程'},{...ctx,isAdmin:true});assert.equal(acceptance.status,'accepted-simulation');assert.equal(acceptance.realEffectEligible,false);assert.equal(checkGovernanceAction(f.w,'model',{type:'publishService',modelVersionId:m.id,evaluationId:r.entity.id},{at}).ok,true);validateGovernance(f.w);
 const bad=structuredClone(f.w);bad.governance.evidence[0].costs[0].unitPrice=999;assert.throws(()=>validateGovernance(bad),/复核快照/);f.p.workspaces.demo=f.w;assert.ok(decodeSnapshot(encodeSnapshot(f.p)).platform);
});
test('legacy restoration enables pending governance without inventing approvals, while successful execution evidence is immutable',()=>{
 const f=fixture();delete f.p.workspaces.demo.governance;const enabled=enableGovernance(f.p);assert.equal(enabled.workspaces.demo.governance.admissions.length,0);assert.deepEqual(enabled.workspaces.demo.modelState,f.p.workspaces.demo.modelState);f.w=enabled.workspaces.demo;f.p=enabled;charter(f);const lic=admit(f);yes(f,'assignDataPurpose',{versionId:'customer:v0.2',purpose:'training'});const a={type:'startTraining',dataVersionId:'customer:v0.2'},access=checkGovernanceAction(f.w,'model',a,{at});f.w=recordGovernanceUse(f.w,'model',a,access,{id:'EXAMPLE'},at);const snapshot=JSON.stringify(f.w.governance.executions[0]);yes(f,'revokeAdmission',{admissionId:lic.id,note:'稍后撤回'});assert.equal(JSON.stringify(f.w.governance.executions[0]),snapshot);validateGovernance(f.w);
});

test('change events are idempotent, freeze impacts and gate publication until designated review with evidence',()=>{
 const f=fixture();charter(f);admit(f);const frozen=JSON.stringify(f.w.modelState),a={sourceId:'data:customer',kind:'spec',eventKey:'spec-v2',revision:'v2',note:'分类说明修订'};
 const e=yes(f,'recordChange',a);yes(f,'recordChange',a);assert.equal(f.w.governance.changes.length,1);assert.equal(action(f,'recordChange',{...a,revision:'v3'}).ok,false);
 assert.ok(e.impactSnapshot.some(x=>x.type==='evaluation'));assert.ok(e.impactSnapshot.some(x=>x.type==='service'));
 assert.match(checkGovernanceAction(f.w,'completion',{type:'listAsset',assetId:'data:customer:v0.2'},{at}).error,/变更重验/);
 assert.equal(action(f,'reviewChange',{changeId:e.id,result:'passed',note:'管理员越权',evidence:'检查记录'}).ok,false);
 yes(f,'reviewChange',{changeId:e.id,result:'failed',note:'发现旧标签'}, {...ctx,actorId:'liyi'});
 assert.equal(action(f,'reviewChange',{changeId:e.id,result:'passed',note:'跳过重试',evidence:'证据'},{...ctx,actorId:'liyi'}).ok,false);
 yes(f,'retryChange',{changeId:e.id,note:'已完成重新核对'},{...ctx,actorId:'liyi'});
 assert.equal(action(f,'reviewChange',{changeId:e.id,result:'passed',note:'缺证据'},{...ctx,actorId:'liyi'}).ok,false);
 yes(f,'reviewChange',{changeId:e.id,result:'passed',note:'全部影响对象保持兼容',evidence:'review-v2:各模型/服务/交付逐项核对记录'},{...ctx,actorId:'liyi'});
 assert.equal(checkGovernanceAction(f.w,'completion',{type:'listAsset',assetId:'data:customer:v0.2'},{at}).ok,true);
 assert.equal(JSON.stringify(f.w.modelState),frozen);validateGovernance(f.w);decodeSnapshot(encodeSnapshot(f.p));
 const bad=structuredClone(f.w);bad.governance.changes[0].impactSnapshot=[];assert.throws(()=>validateGovernance(bad),/冻结/);
});

test('newer changes, withdrawn licenses, hidden projects and forged completion cannot bypass revalidation',()=>{
 const f=fixture();charter(f);const license=admit(f);
 const a={sourceId:'data:customer',kind:'data',revision:'v2',note:'来源更新'};
 const first=yes(f,'recordChange',{...a,eventKey:'one'}),second=yes(f,'recordChange',{...a,eventKey:'two',revision:'v3'});
 const review={changeId:first.id,result:'passed',note:'检查完成',evidence:'记录'};
 assert.match(action(f,'reviewChange',review,{...ctx,actorId:'liyi'}).error,/较新/);
 yes(f,'revokeAdmission',{admissionId:license.id,note:'许可撤回'});const rev=f.w.governance.changes[0];assert.equal(rev.kind,'license');
 assert.match(action(f,'reviewChange',{...review,changeId:rev.id},{...ctx,actorId:'liyi'}).error,/准入/);
 const bad=structuredClone(f.w);bad.governance.changes[0].status='passed';assert.throws(()=>validateGovernance(bad),/审计/);
 const visible=visibleWorkspace(f.w,f.p.settings,'liyi','demo');assert.ok((visible.governance.changes||[]).every(e=>e.impactSnapshot.every(x=>visible.production.projects.some(p=>p.id===x.projectId))));
 assert.ok(second.id!==first.id);
});

test('automatic source and taxonomy changes capture once without rewriting frozen versions',async()=>{
 const {captureChanges}=await import('../src/asset-changes.js');const f=fixture(),before=structuredClone(f.w),after=structuredClone(before);
 after.production.taxonomies[0].tags[0].description+=' 新规则';const frozen=JSON.stringify(after.versions);
 let next=captureChanges(before,after,'henry',at);assert.ok(next.governance.changes.some(e=>e.kind==='spec'&&e.sourceId==='data:customer'));
 const count=next.governance.changes.length;next=captureChanges(next,next,'henry',at);assert.equal(next.governance.changes.length,count);assert.equal(JSON.stringify(next.versions),frozen);validateGovernance(next);
 const changed=structuredClone(next),doc=changed.completion.documents[0];doc.content+=' 更新';doc.revision++;
 next=captureChanges(next,changed,'henry',at);assert.ok(next.governance.changes.some(e=>e.kind==='data'&&e.sourceId==='doc:'+doc.id));validateGovernance(next);
});

test('re-admission resolves withdrawal only after evidence review; stale baselines remain blocked',()=>{
 const f=fixture();charter(f);const lic=admit(f);yes(f,'revokeAdmission',{admissionId:lic.id,note:'撤回'});const e=f.w.governance.changes[0];
 admit(f);yes(f,'reviewChange',{changeId:e.id,result:'passed',note:'新许可覆盖原影响清单',evidence:'renewed-license-review'},{...ctx,actorId:'liyi'});
 assert.equal(checkGovernanceAction(f.w,'completion',{type:'listAsset',assetId:'data:customer:v0.2'},{at}).ok,true);validateGovernance(f.w);
 f.w.production.taxonomies[0].tags[0].description+='another change';
 assert.match(checkGovernanceAction(f.w,'completion',{type:'listAsset',assetId:'data:customer:v0.2'},{at}).error,/变更重验/);
});

test('invalidation covers derived publication, model deployment, service calls and knowledge consumers',async()=>{
 const {changeBlock}=await import('../src/asset-changes.js');const f=fixture();
 for(const source of sourceCatalog(f.w))yes(f,'recordChange',{sourceId:source.id,kind:'data',eventKey:source.id,revision:'external-v2',note:'来源变更'});
 for(const service of f.w.modelState.services){assert.ok(changeBlock(f.w,'model',{type:'invokeService',serviceId:service.id}));assert.ok(changeBlock(f.w,'model',{type:'retryDeployment',serviceId:service.id}));assert.equal(changeBlock(f.w,'model',{type:'offlineService',serviceId:service.id}),null);}
 for(const model of f.w.modelState.models)assert.ok(changeBlock(f.w,'model',{type:'publishService',modelVersionId:model.id}));
 for(const b of Object.values(f.w.textBatches))assert.ok(changeBlock(f.w,'data',{type:'publish',datasetId:b.datasetId}));
 for(const i of f.w.completion.indexes)assert.ok(changeBlock(f.w,'completion',{type:'retrieve',indexId:i.id}));
 for(const g of f.w.completion.agents.filter(g=>g.nodes.some(n=>['retrieval','model'].includes(n.type))))assert.ok(changeBlock(f.w,'completion',{type:'runAgent',agentId:g.id}));
 assert.equal(changeBlock(f.w,'model',{type:'startEvaluation'}),null,'repair/evaluation operations remain available');
});
