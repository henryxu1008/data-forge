import {workspaceVersions} from './platform-policy.js';
import {validateWorkOrders} from './production-workflow.js';
import {validateDeliveryState} from './delivery-lifecycle-state.js';
import {validateProductionFlow} from './p1-production-flow.js';
import {validateAIAnnotation} from './ai-annotation-state.js';
import {validateGovernance} from './governance-state.js';
const FORMAT='shuzhi-workbench-snapshot';
const clone=value=>JSON.parse(JSON.stringify(value));
function checksum(value){let hash=2166136261;for(const c of value){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619)}return (hash>>>0).toString(16).padStart(8,'0')}
export function encodeSnapshot(platform,at=new Date().toISOString()){
 const payload=clone(platform);const result=JSON.stringify({format:FORMAT,schemaVersion:2,exportedAt:at,checksum:checksum(JSON.stringify(payload)),payload},null,2);if(result.length>80*1024*1024)throw new Error('完整快照超过 80 MB，当前原型无法导出；请减少重复模型或运行样例后重试。');return result;
}
function requireArray(v,label){if(!Array.isArray(v))throw new Error(`${label}结构无效。`);const ids=v.map(x=>x?.id);if(ids.some(x=>typeof x!=='string'||!x)||new Set(ids).size!==ids.length)throw new Error(`${label}编号缺失或重复。`)}
export function decodeSnapshot(content){
 if(typeof content!=='string'||content.length>80*1024*1024)throw new Error('快照须小于 80 MB。');
 const env=JSON.parse(content);if(env.format!==FORMAT||env.schemaVersion!==2)throw new Error('不是当前格式的完整会话快照。');
 if(checksum(JSON.stringify(env.payload))!==env.checksum)throw new Error('快照内容校验不一致，未执行恢复。');
 const p=env.payload;if(!p?.settings||!p.workspaces||!p.activeSpaceId||!p.actorId||!p.workspaces[p.activeSpaceId])throw new Error('快照缺少平台或当前空间信息。');
 for(const key of ['spaces','users','members','roles','projects','apiApps'])requireArray(p.settings[key],`设置 ${key}`);
 if(!p.settings.spaces.some(s=>s.id===p.activeSpaceId)||!p.settings.users.some(u=>u.id===p.actorId))throw new Error('当前身份或空间引用缺失。');
 for(const [spaceId,w]of Object.entries(p.workspaces)){
  if(!p.settings.spaces.some(s=>s.id===spaceId)||!w.textBatches||!w.imageBatches||!w.production)throw new Error('空间业务结构不完整。');
  requireArray(w.datasets,'数据集');requireArray(w.events,'审计事件');requireArray(w.production.projects,'项目');requireArray(w.production.templates,'模板');requireArray(w.production.taxonomies,'标签体系');
  const versions=[];
  for(const [key,b]of Object.entries({...w.textBatches,...w.imageBatches})){
   if(b.datasetId!==key||!w.datasets.some(d=>d.id===key)||!b.projectId||!b.batchId||!b.specSnapshot?.versionId)throw new Error('批次来源引用不完整。');
   requireArray(b.records,'批次记录');requireArray(b.versions,'发布版本');
   if(b.rawRecords)requireArray(b.rawRecords,'原始记录');
   for(const v of b.versions){if(v.datasetId!==key||v.batchId!==b.batchId||!v.records?.length||v.projectId!==b.projectId)throw new Error('发布版本来源不一致。');requireArray(v.records,'版本样本');versions.push(v)}
  }
  if(!Array.isArray(w.versions)||!w.reviewState?.tasks)throw new Error('预置业务数据缺失。');
  versions.push(...w.versions.map(v=>({...v,id:`customer:${v.version}`})));
  for(const key of ['trainings','models','evaluations','services','calls'])requireArray(w.modelState?.[key],`模型 ${key}`);
   validateProductionFlow(w);versions.push(...(w.flow?.versions||[]));
   validateAIAnnotation(w);validateGovernance(w);validateDeliveryState(w.delivery,workspaceVersions(w));validateWorkOrders(w,p.settings,spaceId);for(const o of w.delivery?.orders||[]){if(!p.settings.users.some(u=>u.id===o.customerId)||!p.settings.projects.some(pr=>pr.id===o.projectId&&pr.spaceId===spaceId))throw new Error('交付客户或项目引用缺失。');}const m=w.modelState;
  for(const t of m.trainings){if(!versions.some(v=>v.id===t.dataVersionId)||t.dataVersion?.id!==t.dataVersionId||!t.params)throw new Error('训练数据版本引用缺失。')}
  for(const x of m.models){if(!m.trainings.some(t=>t.id===x.trainingId&&t.modelVersionId===x.id&&t.status==='completed'))throw new Error('模型缺少成功训练来源。')}
  for(const x of m.evaluations){if(!m.models.some(t=>t.id===x.modelVersionId)||x.modelSnapshot?.id!==x.modelVersionId||!versions.some(v=>v.id===x.dataVersionId))throw new Error('评测来源缺失。')}
  for(const x of m.services){if(!m.models.some(t=>t.id===x.modelVersionId)||!m.evaluations.some(t=>t.id===x.evaluationId)||x.modelSnapshot?.id!==x.modelVersionId||x.evaluationSnapshot?.id!==x.evaluationId)throw new Error('服务来源缺失。')}
  for(const c of m.calls){if(!m.services.some(t=>t.id===c.serviceId))throw new Error('调用服务引用缺失。')}
  const c=w.completion;
  for(const key of ['documents','qas','sourceVersions','libraries','indexes','retrievals','agents','runs','feedback','listings','grants','accesses','alerts'])requireArray(c?.[key],`业务 ${key}`);
  for(const q of c.qas){if(!c.documents.some(d=>d.id===q.documentId))throw new Error('问答文档引用缺失。')}
  for(const l of c.libraries){if(l.sourceVersionId&&!c.sourceVersions.some(v=>v.id===l.sourceVersionId))throw new Error('知识库来源缺失。')}
  for(const i of c.indexes){if(!c.libraries.some(l=>l.id===i.libraryId)||!c.sourceVersions.some(v=>v.id===i.sourceVersionId)||i.sourceSnapshot?.id!==i.sourceVersionId)throw new Error('索引来源缺失。')}
  for(const r of c.runs){if(!c.agents.some(a=>a.id===r.agentId)||r.configSnapshot?.id!==r.agentId||!Array.isArray(r.dependencies)||r.dependencies.some(d=>d.service&&!m.services.some(s=>s.id===d.service.id)||d.index&&!c.indexes.some(i=>i.id===d.index.id)))throw new Error('运行来源缺失。')}
  for(const f of c.feedback){if(!(f.originType==='agent'?c.runs:m.calls).some(r=>r.id===f.originId)||f.datasetId&&!w.textBatches[f.datasetId]&&!w.imageBatches[f.datasetId]||f.qaId&&!c.qas.some(q=>q.id===f.qaId))throw new Error('反馈改进来源缺失。')}
  for(const l of c.listings){const id=l.assetSnapshot?.versionId;if(!id||!versions.concat(m.services,c.indexes).some(v=>v.id===id))throw new Error('上架资产引用缺失。')}
  for(const g of c.grants){if(!c.listings.some(l=>l.id===g.listingId)||!p.settings.apiApps.some(a=>a.id===g.appId&&a.spaceId===spaceId))throw new Error('资产授权引用缺失。')}
  for(const a of c.accesses){if(!c.grants.some(g=>g.id===a.grantId))throw new Error('资产访问授权引用缺失。')}
 }
 return {platform:p,exportedAt:env.exportedAt};
}
const DB='shuzhi-workbench-v2';
async function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('snapshots');r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result)})}
export async function loadSaved(){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readonly'),r=tx.objectStore('snapshots').get('current');r.onsuccess=()=>{db.close();resolve(r.result?decodeSnapshot(r.result).platform:null)};r.onerror=()=>{db.close();reject(r.error)}})}
export async function saveCurrent(platform){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(encodeSnapshot(platform),'current');tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}})}
