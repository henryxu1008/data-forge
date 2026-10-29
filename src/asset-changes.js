import {sourceCatalog,affectedAssets,operationScope,sourceIdsForVersion} from './governance-sources.js';
import {fingerprint} from './evaluation-integrity.js';
const clone=v=>JSON.parse(JSON.stringify(v));
const text=v=>typeof v==='string'?v.trim():'';
export const changeKinds={data:'数据内容变更',spec:'标注规范变更',license:'许可撤回'};
export function changeBaseline(w,sourceId){
 const source=sourceCatalog(w).find(s=>s.id===sourceId);
 if(!source)throw Error('变更来源不存在。');
 const specs=[w.production.projects.find(p=>p.id===source.projectId)?.specSnapshot,...Object.values({...w.textBatches,...w.imageBatches}).filter(b=>b.datasetId===source.datasetId).map(b=>({id:b.datasetId,spec:b.specSnapshot}))];
 const refs=specs.map(x=>x?.spec||x).filter(Boolean);
 const taxonomies=(w.production.taxonomies||[]).filter(t=>refs.some(s=>s.taxonomyId===t.id));
 const templates=(w.production.templates||[]).filter(t=>refs.some(s=>s.versionId?.startsWith(t.id+':'))).map(({icon,...t})=>t);
 return {source:clone(source),specFingerprint:fingerprint({specs,taxonomies,templates})};
}
const body=e=>({id:e.id,key:e.key,kind:e.kind,sourceId:e.sourceId,projectId:e.projectId,revision:e.revision,note:e.note,actorId:e.actorId,at:e.at,baseline:e.baseline,impactSnapshot:e.impactSnapshot});
export function registerChange(w,a,actorId){
 const g=w.governance;g.changes??=[];
 if(!changeKinds[a.kind]||![a.eventKey,a.revision,a.note,actorId].every(text)||!Number.isFinite(Date.parse(a.at)))throw Error('变更需有效类型、唯一事件键、版本引用、原因与时间。');
 const previous=g.changes.find(e=>e.key===a.eventKey);
 if(previous){if(previous.sourceId!==a.sourceId||previous.kind!==a.kind||previous.revision!==a.revision||previous.note!==a.note)throw Error('事件键已用于不同变更。');return previous;}
 const baseline=changeBaseline(w,a.sourceId),impactSnapshot=affectedAssets(w,a.sourceId);
 const e={id:`GOV-CHANGE-${++g.sequence}`,key:a.eventKey,kind:a.kind,sourceId:a.sourceId,projectId:baseline.source.projectId,revision:a.revision,note:a.note,actorId,at:a.at,baseline,impactSnapshot,status:'pending',attempts:[]};
 e.seal=fingerprint(body(e));g.changes.unshift(e);return e;
}
// Compare only existing sources. New datasets do not invalidate their predecessors.
export function captureChanges(previous,next,actorId,at){
 if(!next.governance?.enabled)return next;
 let w=next;
 for(const s of sourceCatalog(previous)){
  if(!sourceCatalog(next).some(x=>x.id===s.id))continue;
  const before=changeBaseline(previous,s.id),after=changeBaseline(next,s.id);
  for(const kind of ['data','spec']){const left=kind==='data'?before.source.fingerprint:before.specFingerprint,right=kind==='data'?after.source.fingerprint:after.specFingerprint;if(left===right)continue;
   if(w===next)w=clone(next);
   registerChange(w,{kind,sourceId:s.id,eventKey:`auto:${kind}:${s.id}:${w.governance.sequence+1}`,revision:right,note:`检测到${changeKinds[kind]}：${left} → ${right}`,at},actorId);
  }
 }
 const oldBatches={...previous.textBatches,...previous.imageBatches};
 for(const b of Object.values({...next.textBatches,...next.imageBatches})){
  const old=oldBatches[b.datasetId];if(!old||JSON.stringify(old.specSnapshot)===JSON.stringify(b.specSnapshot))continue;
  for(const sourceId of sourceIdsForVersion(next,b)){
   if(!sourceCatalog(next).some(s=>s.id===sourceId)||w.governance.changes?.some(e=>e.sourceId===sourceId&&e.kind==='spec'&&Number(e.id.split('-').at(-1))>(previous.governance?.sequence||0)&&e.key.startsWith('auto:')))continue;
   if(w===next)w=clone(next);registerChange(w,{kind:'spec',sourceId,eventKey:`auto:batch:${b.datasetId}:${sourceId}:${w.governance.sequence+1}`,revision:fingerprint(b.specSnapshot),note:`批次 ${b.datasetId} 标注规范已变化`,at},actorId);
  }
 }
 return w;
}
export function applyChangeAction(w,a,ctx){
 if(a.type==='recordChange'){
  if(!['data','spec'].includes(a.kind))throw Error('许可撤回须通过准入许可操作。');
  return registerChange(w,a,ctx.actorId);
 }
 const e=w.governance.changes?.find(e=>e.id===a.changeId);if(!e)throw Error('变更重验任务不存在。');
 if(!text(a.note))throw Error('请填写重验结论或重试原因。');
 if(Date.parse(a.at)<Date.parse(e.attempts.at(-1)?.at||e.at))throw Error('重验时间不能早于已有记录。');
 const charter=w.governance.charters.find(c=>c.projectId===e.projectId&&['approved','closed'].includes(c.status));
 if(charter?.status!=='approved'||charter.rolesSnapshot.qualityOwnerId!==ctx.actorId||ctx.canApproveUser&&!ctx.canApproveUser(ctx.actorId,e.projectId))throw Error('只有当前立项质量负责人可以记录重验结论。');
 if(a.type==='retryChange'){
  if(e.status!=='failed')throw Error('只有重验失败任务可以重试。');
  e.attempts.push({action:'retry',actorId:ctx.actorId,note:a.note,at:a.at});e.status='pending';return e;
 }
 if(a.type!=='reviewChange'||e.status!=='pending'||!['passed','failed'].includes(a.result))throw Error('任务状态或重验结论无效。');
 const baseline=changeBaseline(w,e.sourceId);
 if(a.result==='passed'){
  if(!text(a.evidence))throw Error('通过重验必须填写覆盖影响清单的证据引用。');
  const admission=w.governance.admissions.find(p=>p.sourceId===e.sourceId&&['approved','revoked'].includes(p.status));
  if(admission?.status!=='approved'||admission.sourceSnapshot.fingerprint!==baseline.source.fingerprint||Date.parse(admission.validUntil)<=Date.parse(a.at))throw Error('来源需先完成当前内容的有效准入，撤回许可不能由重验绕过。');
  // A newer event must be resolved first, preventing an old review clearing newer changes.
  if(w.governance.changes.some(x=>x.sourceId===e.sourceId&&Number(x.id.split('-').at(-1))>Number(e.id.split('-').at(-1))&&x.status!=='passed'))throw Error('请先处理同一来源较新的变更任务。');
 }
 e.status=a.result;e.attempts.push({action:'review',result:a.result,actorId:ctx.actorId,at:a.at,note:a.note,evidence:text(a.evidence),baseline,admissionId:w.governance.admissions.find(p=>p.sourceId===e.sourceId&&['approved','revoked'].includes(p.status))?.id||null,charterId:charter.id});return e;
}
export function changeBlock(w,kind,a){
 const publish=kind==='data'&&a.type==='publish'||kind==='flow'&&a.type==='publishJob'||kind==='model'&&['publishService','retryDeployment','invokeService'].includes(a.type)||kind==='completion'&&['publishKnowledge','listAsset','grantAsset','accessAsset','runAgent','retrieve'].includes(a.type);
 if(!publish)return null;
 const scope=operationScope(w,kind,a),events=w.governance?.changes||[],pending=events.find(e=>scope.sourceIds.includes(e.sourceId)&&(e.status!=='passed'||e===events.find(x=>x.sourceId===e.sourceId)&&JSON.stringify(e.attempts.at(-1)?.baseline)!==JSON.stringify(changeBaseline(w,e.sourceId))));
 return pending?`来源 ${pending.sourceId} 存在未通过的变更重验 ${pending.id}，请在“变更与重验”处理后再发布或使用。`:null;
}
export function validateChanges(w){
 const events=w.governance?.changes;if(events===undefined)return;
 if(!Array.isArray(events))throw Error('变更事件集合无效。');const keys=new Set(),ids=new Set();
 for(const e of events){
  const s=sourceCatalog(w).find(s=>s.id===e.sourceId);
  if(!s||s.projectId!==e.projectId||!changeKinds[e.kind]||![e.key,e.revision,e.note,e.actorId].every(text)||keys.has(e.key)||ids.has(e.id)||!/^GOV-CHANGE-\d+$/.test(e.id)||Number(e.id.split('-').at(-1))>w.governance.sequence||!Number.isFinite(Date.parse(e.at))||e.seal!==fingerprint(body(e))||!Array.isArray(e.impactSnapshot)||!Array.isArray(e.attempts))throw Error('变更来源、编号或冻结影响记录无效。');
  keys.add(e.key);ids.add(e.id);let state='pending';
  for(const r of e.attempts){
   if(!text(r.actorId)||!text(r.note)||!Number.isFinite(Date.parse(r.at))||Date.parse(r.at)<Date.parse(e.at))throw Error('重验审计记录无效。');
   if(r.action==='retry'){if(state!=='failed')throw Error('重验重试顺序无效。');state='pending';continue;}
   const c=w.governance.charters.find(c=>c.id===r.charterId),p=w.governance.admissions.find(p=>p.id===r.admissionId);
   if(r.action!=='review'||state!=='pending'||!['passed','failed'].includes(r.result)||!c||c.rolesSnapshot.qualityOwnerId!==r.actorId||c.projectId!==e.projectId||r.baseline?.source.id!==e.sourceId)throw Error('重验结论或负责人无效。');
   if(r.result==='passed'&&(!text(r.evidence)||!p||!['approved','revoked'].includes(p.status)||p.sourceId!==e.sourceId||p.sourceSnapshot.fingerprint!==r.baseline.source.fingerprint||Date.parse(p.validUntil)<=Date.parse(r.at)||p.withdrawal&&Date.parse(p.withdrawal.at)<=Date.parse(r.at)))throw Error('重验通过依据无效。');state=r.result;
  }
  if(e.status!==state)throw Error('重验状态与审计记录不一致。');
  if(state==='passed'&&e===events.find(x=>x.sourceId===e.sourceId)&&JSON.stringify(e.attempts.at(-1).baseline)!==JSON.stringify(changeBaseline(w,e.sourceId)))throw Error('已通过重验的最新基线不匹配，请先登记后续变更。');
 }
}
