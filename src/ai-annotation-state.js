// Deterministic local suggestions only. No network, weights, image recognition or real confidence.
import {createTextBatch,applyTextBatchAction} from './text-production-state.js';
import {createImageBatch,applyImageBatchAction,imageRecordIssues} from './image-production-state.js';
import {bindTaskPlan} from './p1-quality.js';
const clone=v=>JSON.parse(JSON.stringify(v));
const text=v=>typeof v==='string'?v.trim():'';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const createAIAnnotationState=()=>({sequence:0,bindings:[],jobs:[],predictions:[]});
export const BASELINE_MODELS=[{id:'SIM-TEXT-1',name:'文本规则模拟基线',version:'v1',type:'text',algorithm:'local-text-rules-v1',demo:true},{id:'SIM-VISION-1',name:'图片几何模拟基线',version:'v1',type:'image',algorithm:'local-geometry-v1',demo:true}];
export function annotationBatches(w){return [...Object.values(w.textBatches||{}).filter(b=>b.stage==='cleaned'),...Object.values(w.imageBatches||{})];}
export function annotationVersions(w){return [...Object.values(w.textBatches||{}).flatMap(b=>b.versions),...Object.values(w.imageBatches||{}).flatMap(b=>b.versions),...(w.flow?.versions||[]),...(w.versions||[]).map(v=>({...clone(v),id:`customer:${v.version}`,type:'text',projectId:'PRJ-001',projectName:'客户反馈意图分类',datasetName:'客户反馈意图分类',datasetId:'customer',batchId:'CUSTOMER-DEMO'}))];}
const batchFor=(w,id)=>annotationBatches(w).find(b=>b.datasetId===id);
const labels=b=>(b.specSnapshot?.labels||b.labels||[]).map(l=>typeof l==='string'?l:l.name);
const modality=b=>b.type==='image'?'image':'text';
const sourceProjects=v=>[...new Set([v?.projectId,...(v?.sourceProjects||[])].filter(Boolean))];
function hash(v){let h=2166136261;for(const c of JSON.stringify(v)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0');}
function recordSignature(b,r){return hash({datasetId:b.datasetId,batchId:b.batchId,projectId:b.projectId,type:modality(b),spec:b.specSnapshot,source:modality(b)==='image'?{id:r.id,name:r.name,src:r.src,width:r.width,height:r.height,mimeType:r.mimeType}:{id:r.id,text:r.text,channel:r.channel||''},work:modality(b)==='image'?{boxes:r.boxes,noDefect:r.noDefect,note:r.note,status:r.status}: {label:r.label,note:r.draftNote||'',status:r.status},history:(r.history||[]).filter(h=>!['assign','assignReviewer'].includes(h.type)).map(h=>[h.type,h.at,h.note]),prior:r.aiAnnotation?.predictionId||null});}
function untouched(r,type){return r.status==='todo'&&!r.aiAnnotation&&!(r.history||[]).some(h=>!['assign','assignReviewer'].includes(h.type))&&(type==='image'?!(r.boxes?.length||r.noDefect||text(r.note)):!text(r.label)&&!text(r.draftNote));}
export function currentAnnotationBinding(w,datasetId){return w.aiAnnotation?.bindings.find(b=>b.datasetId===datasetId)||null;}
function resolveModel(w,batch,modelVersionId,serviceId){
 const base=BASELINE_MODELS.find(m=>m.id===modelVersionId);if(base){if(serviceId)throw Error('本地规则基线不绑定远程服务。');if(base.type!==modality(batch))throw Error('模型模态与批次不兼容。');return {modelSnapshot:clone(base),serviceId:null,sourceProjects:[]};}
 const model=w.modelState.models.find(m=>m.id===modelVersionId);if(!model)throw Error('模型版本不存在。');
 if((model.type||'text')!==modality(batch))throw Error('模型模态与批次不兼容。');
 if(!same([...labels(batch)].sort(),[...(model.labels||labels(model.dataVersion))].sort()))throw Error('模型标签与批次冻结规范不兼容。');
 const service=w.modelState.services.find(s=>s.id===serviceId&&s.modelVersionId===model.id);if(!service||service.status!=='running')throw Error('请选择该模型版本的运行中模拟服务；服务下线后不能继续预标注。');
 if(!same(service.modelSnapshot,model))throw Error('服务冻结模型来源不一致。');
 return {modelSnapshot:clone(model),serviceId:service.id,sourceProjects:sourceProjects(model.dataVersion)};
}
export function annotationModelOptions(w,batch){if(!batch)return [];const result=BASELINE_MODELS.filter(m=>m.type===modality(batch)).map(m=>({key:m.id,modelVersionId:m.id,serviceId:null,label:`${m.name} ${m.version} · 本地规则模拟`,compatible:true}));
 for(const m of w.modelState.models){if((m.type||'text')!==modality(batch))continue;const services=w.modelState.services.filter(s=>s.modelVersionId===m.id);for(const s of services.length?services:[null]){let error='';try{resolveModel(w,batch,m.id,s?.id)}catch(e){error=e.message}result.push({key:`${m.id}:${s?.id||''}`,modelVersionId:m.id,serviceId:s?.id||null,label:`${m.name} ${m.version} · ${s?.name||'尚未发布服务'} · ${s?.status||'未就绪'}`,compatible:!error,error});}}
 return result;
}
function usableBinding(w,binding){
 const b=batchFor(w,binding?.datasetId);if(!b||!binding?.active)throw Error('模型绑定已解除或批次不可用。');
 if(currentAnnotationBinding(w,b.datasetId)?.id!==binding.id)throw Error('模型绑定已经更新，旧建议只供回查。');
 if(!same(binding.specSnapshot,b.specSnapshot))throw Error('标注规范已变化，请重新绑定模型。');
 const model=resolveModel(w,b,binding.modelVersionId,binding.serviceId);if(!same(binding.modelSnapshot,model.modelSnapshot))throw Error('绑定模型来源已变化。');return b;
}
export function predictionAvailability(w,p){
 if(p.acceptedAt)return {code:'accepted',reason:'已接受为草稿，后续以人工标注为准。'};
 const job=w.aiAnnotation?.jobs.find(j=>j.id===p.jobId),binding=w.aiAnnotation?.bindings.find(b=>b.id===job?.bindingId);
 try{const b=usableBinding(w,binding);const r=b.records.find(r=>r.id===p.recordId);if(!r||recordSignature(b,r)!==p.inputSignature)return {code:'expired',reason:'输入或标注修订已变化，旧建议已过期。'};if(!untouched(r,modality(b)))return {code:'protected',reason:'该记录已有人工工作或提交状态，不覆盖现有标注。'};if(!(r.annotator||r.assignee))return {code:'unassigned',reason:'请先在标注工作台分配标注人，再接受建议。'};return {code:'available',reason:'可接受为待人工核对的草稿。'};}catch(e){return {code:'expired',reason:e.message};}
}
function suggestion(binding,input,r){
 const type=modality(input),names=labels(input),seed=parseInt(hash([binding.modelVersionId,r.id,type==='text'?r.text:r.src]),16),confidence=Number((0.61+(seed%34)/100).toFixed(2));
 if(!names.length)throw Error('缺少标注标签。');
 const source=binding.modelSnapshot.dataVersion?.records||[];
 if(type==='text'){
  const trained=source.find(x=>text(x.text)===text(r.text)&&names.includes(x.label));
  const groups=[['物流',/物流|快递|配送|签收|未送达/],['售后',/退货|退款|维修|故障|更换/],['商品',/参数|尺寸|容量|型号/],['咨询',/有货|库存|购买|周末/]];
  const label=trained?.label||groups.find(([name,rx])=>names.includes(name)&&rx.test(r.text))?.[0]||names[seed%names.length];
  return {suggestion:{label},confidence,method:trained?'已发布训练样本精确回放（模拟）':'输入文本规则与版本种子（模拟）'};
 }
 const trained=source.find(x=>x.src===r.src&&x.width===r.width&&x.height===r.height);
 let result;if(trained)result={boxes:clone(trained.boxes),noDefect:trained.noDefect};else if(seed%5===0)result={boxes:[],noDefect:true};else{const width=Math.max(1,Math.floor(r.width*(0.15+(seed%15)/100))),height=Math.max(1,Math.floor(r.height*(0.15+((seed>>>4)%15)/100)));result={boxes:[{id:`SIMBOX-${r.id}`,x:Math.floor((r.width-width)*((seed%50)/100)),y:Math.floor((r.height-height)*(((seed>>>6)%50)/100)),width,height,label:names[seed%names.length],severity:'一般'}],noDefect:false};}
 result.boxes=result.boxes.map(b=>({...b,confidence}));return {suggestion:result,confidence,method:trained?'已发布训练图片标注回放（模拟）':'按版本种子生成示意框（不识别图像）'};
}
function jobInputCurrent(w,j){const b=batchFor(w,j.datasetId);return !!b&&j.input.records.every(r=>{const current=b.records.find(x=>x.id===r.id);return current&&recordSignature(b,current)===j.inputSignatures[r.id];});}
export function annotationActionProjects(w,a){const s=w.aiAnnotation||createAIAnnotationState(),j=s.jobs.find(j=>j.id===a.jobId),b=batchFor(w,a.datasetId||j?.datasetId),binding=s.bindings.find(x=>x.id===(j?.bindingId||currentAnnotationBinding(w,b?.datasetId)?.id));const out=new Set(sourceProjects(b));for(const p of binding?.sourceProjects||[])out.add(p);const model=w.modelState.models.find(m=>m.id===a.modelVersionId);for(const p of sourceProjects(model?.dataVersion))out.add(p);const version=annotationVersions(w).find(v=>v.id===a.versionId);for(const p of sourceProjects(version))out.add(p);for(const id of a.predictionIds||[]){const p=s.predictions.find(p=>p.id===id),j=s.jobs.find(j=>j.id===p?.jobId);for(const x of j?.sourceProjects||[])out.add(x);if(j?.projectId)out.add(j.projectId);}return [...out];}
export function visibleAIAnnotation(s,allowed){if(!s)return createAIAnnotationState();const bindings=s.bindings.filter(b=>allowed(b.projectId)&&b.sourceProjects.every(allowed)),ids=new Set(bindings.map(b=>b.id));const jobs=s.jobs.filter(j=>ids.has(j.bindingId)&&allowed(j.projectId)&&j.sourceProjects.every(allowed)),jobIds=new Set(jobs.map(j=>j.id));return {...s,bindings,jobs,predictions:s.predictions.filter(p=>jobIds.has(p.jobId))};}
export function applyAIAnnotationAction(workspace,a,ctx={}){
 const no=error=>({ok:false,workspace,error,events:[]});
 if(!a||!Number.isFinite(Date.parse(a.at)))return no('操作时间无效。');
 try{
  const w=clone(workspace),s=w.aiAnnotation=w.aiAnnotation||createAIAnnotationState(),next=p=>`${p}-${++s.sequence}`;let entity;
  const getJob=()=>{const j=s.jobs.find(j=>j.id===a.jobId);if(!j)throw Error('预标注任务不存在。');return j;};
  const start=j=>{if(!['queued','failed','cancelled'].includes(j.status))throw Error('当前任务不能启动或重试。');const binding=s.bindings.find(b=>b.id===j.bindingId);usableBinding(w,binding);if(!jobInputCurrent(w,j))throw Error('任务输入已过期，请创建新任务。');if(!['success','fail'].includes(a.scenario||j.scenario))throw Error('模拟场景无效。');j.scenario=a.scenario||j.scenario;j.status='running';j.progress=0;j.error='';j.attempts.push({id:next('AI-ATTEMPT'),startedAt:a.at,status:'running',scenario:j.scenario,note:text(a.note)});};
  if(a.type==='bindModel'){
   const b=batchFor(w,a.datasetId);if(!b)throw Error('请选择已清洗文本或有效图片批次。');const model=resolveModel(w,b,a.modelVersionId,a.serviceId);entity={id:next('AI-BINDING'),datasetId:b.datasetId,projectId:b.projectId,type:modality(b),modelVersionId:a.modelVersionId,specSnapshot:clone(b.specSnapshot),...model,sourceProjects:[...new Set([...sourceProjects(b),...model.sourceProjects])],active:true,at:a.at};s.bindings.unshift(entity);
  }else if(a.type==='unbindModel'){
   entity=currentAnnotationBinding(w,a.datasetId);if(!entity?.active||!text(a.note))throw Error('请选择有效绑定并填写解除原因。');entity.active=false;entity.closedAt=a.at;entity.closeNote=text(a.note);
  }else if(a.type==='createPredictionJob'){
   const binding=currentAnnotationBinding(w,a.datasetId),b=usableBinding(w,binding);if(!text(a.name)||a.name.length>100)throw Error('请填写 100 字以内任务名称。');
   const ids=a.recordIds||b.records.map(r=>r.id);if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!b.records.some(r=>r.id===id)))throw Error('预标注范围必须是当前批次的不重复样本。');
   if(s.jobs.some(j=>j.datasetId===b.datasetId&&['queued','running'].includes(j.status)))throw Error('本批次已有待处理预标注任务，请先完成或取消。');
   const records=b.records.filter(r=>ids.includes(r.id));const scenario=a.scenario||'success';if(!['success','fail'].includes(scenario))throw Error('模拟场景无效。');
   const input={datasetId:b.datasetId,batchId:b.batchId,projectId:b.projectId,type:modality(b),specSnapshot:clone(b.specSnapshot),revision:b.revision,records:clone(records)};
   entity={id:next('AI-JOB'),name:text(a.name),datasetId:b.datasetId,projectId:b.projectId,type:modality(b),bindingId:binding.id,modelVersionId:binding.modelVersionId,serviceId:binding.serviceId,sourceProjects:clone(binding.sourceProjects),input,inputSignatures:Object.fromEntries(records.map(r=>[r.id,recordSignature(b,r)])),status:'queued',scenario,progress:0,predictionIds:[],attempts:[],createdAt:a.at,createdBy:ctx.actorId||'henry',demo:true};s.jobs.unshift(entity);
  }else if(a.type==='startPredictionJob'||a.type==='retryPredictionJob'){
   entity=getJob();if(a.type==='startPredictionJob'&&entity.status!=='queued'||a.type==='retryPredictionJob'&&(!['failed','cancelled'].includes(entity.status)||!text(a.note)))throw Error('启动/重试状态无效，重试需填写说明。');start(entity);
  }else if(a.type==='cancelPredictionJob'){
   entity=getJob();if(!['queued','running'].includes(entity.status)||!text(a.note))throw Error('只有待执行或运行任务可以取消，需填写原因。');entity.status='cancelled';entity.error=text(a.note);entity.endedAt=a.at;if(entity.attempts.at(-1)?.status==='running')Object.assign(entity.attempts.at(-1),{status:'cancelled',endedAt:a.at,error:entity.error});
  }else if(a.type==='advancePredictionJobs'){
   let changed=false;for(const j of s.jobs.filter(j=>j.status==='running')){changed=true;let error='';const binding=s.bindings.find(b=>b.id===j.bindingId);try{usableBinding(w,binding);if(!jobInputCurrent(w,j))throw Error('输入或人工标注已变化，任务过期。');const blocked=ctx.checkJob?.(j);if(blocked)throw Error(blocked);for(const projectId of [j.projectId,...j.sourceProjects])if(ctx.canRun&&!ctx.canRun(projectId,j.createdBy))throw Error('任务发起人的项目调用权限已失效。');}catch(e){error=e.message;}
    j.progress=Math.min(100,j.progress+25);if(!error&&j.progress<100)continue;if(!error&&j.scenario==='fail')error='本地模拟预测失败；未创建建议、草稿或审核结果。';j.endedAt=a.at;j.status=error?'failed':'completed';j.error=error;Object.assign(j.attempts.at(-1),{status:j.status,endedAt:a.at,error});
    if(!error)for(const r of j.input.records){const result=suggestion(binding,j.input,r),p={id:next('AI-PREDICTION'),jobId:j.id,bindingId:j.bindingId,datasetId:j.datasetId,recordId:r.id,modelVersionId:j.modelVersionId,serviceId:j.serviceId,inputRevision:j.input.revision,inputSignature:j.inputSignatures[r.id],...result,at:a.at,demo:true};s.predictions.push(p);j.predictionIds.push(p.id);}
   }if(!changed)return {ok:true,workspace,entity:null,events:[],unchanged:true};
  }else if(a.type==='acceptPredictions'){
   if(!Array.isArray(a.predictionIds)||!a.predictionIds.length||new Set(a.predictionIds).size!==a.predictionIds.length)throw Error('请选择不重复的建议。');
   for(const id of a.predictionIds){const p=s.predictions.find(p=>p.id===id);if(!p)throw Error('预测记录不存在。');const available=predictionAvailability(w,p);if(available.code!=='available')throw Error(available.reason);const j=s.jobs.find(j=>j.id===p.jobId),b=batchFor(w,p.datasetId),r=b.records.find(r=>r.id===p.recordId),assignee=r.annotator||r.assignee;if(!assignee)throw Error('请先在标注工作台分配标注人。');if(ctx.roleId==='annotator'&&assignee!==ctx.actorName)throw Error('只能接受分配给当前标注员的样本。');
    const type=modality(b),draft=type==='image'?{type:'saveDraft',recordId:r.id,boxes:p.suggestion.boxes.map(({confidence,...box})=>box),noDefect:p.suggestion.noDefect,note:'AI 模拟建议，待人工核对',at:a.at}:{type:'saveDraft',taskId:r.id,label:p.suggestion.label,note:'AI 模拟建议，待人工核对',at:a.at};const result=(type==='image'?applyImageBatchAction:applyTextBatchAction)(b,draft);if(!result.ok)throw Error(result.error);
    const provenance={predictionId:p.id,jobId:j.id,bindingId:p.bindingId,modelVersionId:p.modelVersionId,serviceId:p.serviceId,inputRevision:p.inputRevision,inputSignature:p.inputSignature,suggestion:clone(p.suggestion),confidence:p.confidence,method:p.method,acceptedAt:a.at,acceptedBy:ctx.actorId||'henry',demo:true};const updated={...result.batch,records:result.batch.records.map(row=>row.id===r.id?{...row,aiAnnotation:provenance}:row)};w[type==='image'?'imageBatches':'textBatches'][b.datasetId]=updated;p.acceptedAt=a.at;p.acceptedBy=ctx.actorId||'henry';entity=p;
   }
  }else if(a.type==='createAnnotationBatch'){
   const source=annotationVersions(w).find(v=>v.id===a.versionId);if(!source||!source.records?.length||!text(a.name))throw Error('请选择实际已发布版本并填写新批次名称。');const type=modality(source),spec=source.specSnapshot||w.production.projects.find(p=>p.id===source.projectId)?.specSnapshot;if(!spec)throw Error('来源没有可用的标注规范。');const id=next('AI-DATA'),parents=sourceProjects(source);
   let data={datasetId:id,name:text(a.name),projectId:source.projectId,projectName:source.projectName||source.datasetName,specSnapshot:spec,at:a.at};data=bindTaskPlan(w,data,type,'published');
   if(type==='image')entity=createImageBatch({...data,records:source.records.map(r=>({...clone(r),feedbackId:null,originSnapshot:{versionId:source.id,recordId:r.id}}))});else entity=createTextBatch({...data,rawRecords:source.records.map(r=>({id:r.id,text:r.text,channel:r.channel||'',referenceLabel:r.label,parents:[{versionId:source.id,recordId:r.id}],originSnapshot:{versionId:source.id,recordId:r.id}}))});
   entity.sourceProjects=parents;entity.annotationSourceVersionId=source.id;w[type==='image'?'imageBatches':'textBatches'][id]=entity;w.datasets.push({id,name:entity.name,type,total:source.records.length,status:type==='image'?'production':'cleaning',owner:ctx.actorName||'演示管理员',version:'未发布',description:'从发布版本建立独立标注批次；旧版本不变。'});w.selectedId=id;
  }else throw Error('不支持的 AI 标注操作。');
  const title={bindModel:'绑定预标注模型版本',unbindModel:'解除预标注绑定',createPredictionJob:'创建批量预标注任务',startPredictionJob:'启动模拟预标注',retryPredictionJob:'重试模拟预标注',cancelPredictionJob:'取消预标注任务',advancePredictionJobs:'推进模拟预标注',acceptPredictions:'接受模拟建议为草稿',createAnnotationBatch:'建立下一轮标注批次'}[a.type];
  const event=e=>({action:title,object:e?.id||'AI 标注',result:e?.status==='failed'?'失败':'成功',details:e?.error||'本地确定性模拟，未调用模型或外部 API。',after:{任务:e?.id,模型:e?.modelVersionId,批次:e?.datasetId,状态:e?.status,输入修订:e?.input?.revision,操作:a.type}});
  const events=a.type==='advancePredictionJobs'?s.jobs.filter(j=>['completed','failed'].includes(j.status)&&workspace.aiAnnotation?.jobs.find(old=>old.id===j.id)?.status==='running').map(event):[event(entity)];
  return {ok:true,workspace:w,entity,events};
 }catch(e){return no(e.message);}
}

export function validateAIAnnotation(w){
 const s=w.aiAnnotation;const batches=[...Object.values(w.textBatches||{}),...Object.values(w.imageBatches||{})],entries=batches.flatMap(b=>[...b.records,...b.versions.flatMap(v=>v.records)].map(r=>({r,datasetId:b.datasetId}))),allRecords=entries.map(e=>e.r);
 if(!s){if(allRecords.some(r=>r.aiAnnotation))throw Error('AI 标注来源缺失。');return;}
 const check=(rows,name)=>{if(!Array.isArray(rows)||rows.some(x=>!text(x.id))||new Set(rows.map(x=>x.id)).size!==rows.length)throw Error(`AI 标注${name}编号或结构无效。`);};
 if(!Number.isSafeInteger(s.sequence)||s.sequence<0)throw Error('AI 标注序列无效。');for(const key of ['bindings','jobs','predictions'])check(s[key],key);
 const usedIds=[...s.bindings,...s.jobs,...s.predictions,...s.jobs.flatMap(j=>j.attempts||[]),...batches.filter(b=>/^AI-DATA-/.test(b.datasetId)).map(b=>({id:b.datasetId}))];if(new Set(usedIds.map(x=>x.id)).size!==usedIds.length||usedIds.some(x=>Number(x.id.match(/-(\d+)$/)?.[1]||0)>s.sequence))throw Error('AI 标注序列与已有对象不一致。');
 for(const b of batches)if(b.annotationSourceVersionId&&!annotationVersions(w).some(v=>v.id===b.annotationSourceVersionId))throw Error('AI 标注下一轮批次来源版本缺失。');
 for(const b of s.bindings){const batch=batchFor(w,b.datasetId);if(!batch||batch.projectId!==b.projectId||!same(batch.specSnapshot,b.specSnapshot)||b.type!==modality(batch)||typeof b.active!=='boolean'||!Array.isArray(b.sourceProjects))throw Error('AI 标注绑定来源不一致。');const base=BASELINE_MODELS.find(m=>m.id===b.modelVersionId),m=base||w.modelState.models.find(m=>m.id===b.modelVersionId);if(!m||!same(m,b.modelSnapshot)||modality(m)!==modality(batch)||!base&&(!w.modelState.services.some(s=>s.id===b.serviceId&&s.modelVersionId===m.id)||!same([...labels(batch)].sort(),[...(m.labels||labels(m.dataVersion))].sort()))||!same(b.sourceProjects,[...new Set([...sourceProjects(batch),...(base?[]:sourceProjects(m.dataVersion))])]))throw Error('AI 标注模型版本引用不一致。');}
 for(const j of s.jobs){const b=s.bindings.find(b=>b.id===j.bindingId),batch=batchFor(w,j.datasetId);if(!b||!batch||j.datasetId!==b.datasetId||j.projectId!==b.projectId||j.modelVersionId!==b.modelVersionId||j.serviceId!==b.serviceId||!same(j.sourceProjects,b.sourceProjects)||!['queued','running','completed','failed','cancelled'].includes(j.status)||!Array.isArray(j.attempts)||!Array.isArray(j.predictionIds)||!same(j.input.specSnapshot,b.specSnapshot)||j.input.datasetId!==j.datasetId||j.input.type!==b.type||!Number.isSafeInteger(j.input.revision)||!j.demo)throw Error('AI 标注任务来源或状态无效。');check(j.input.records,'任务输入');for(const r of j.input.records){if(!batch.records.some(x=>x.id===r.id)||j.inputSignatures[r.id]!==recordSignature(j.input,r))throw Error('AI 标注输入签名无效。');}if(j.status!=='completed'&&j.predictionIds.length||j.status==='completed'&&j.predictionIds.length!==j.input.records.length||new Set(j.predictionIds).size!==j.predictionIds.length)throw Error('AI 标注任务预测范围无效。');}
 for(const j of s.jobs){const outputs=s.predictions.filter(p=>p.jobId===j.id);if(!same([...j.predictionIds].sort(),outputs.map(p=>p.id).sort())||new Set(outputs.map(p=>p.recordId)).size!==outputs.length||j.status==='completed'&&!same(j.input.records.map(r=>r.id).sort(),outputs.map(p=>p.recordId).sort()))throw Error('AI 标注预测集合与输入不一致。');if(!['success','fail'].includes(j.scenario)||!Number.isInteger(j.progress)||j.progress<0||j.progress>100||j.status==='queued'&&j.attempts.length||j.status==='running'&&j.attempts.at(-1)?.status!=='running'||['failed','completed'].includes(j.status)&&j.attempts.at(-1)?.status!==j.status||j.attempts.some(a=>!['running','completed','failed','cancelled'].includes(a.status)||!Number.isFinite(Date.parse(a.startedAt))))throw Error('AI 标注执行历史无效。');}
 for(const p of s.predictions){const j=s.jobs.find(j=>j.id===p.jobId),b=s.bindings.find(b=>b.id===j?.bindingId),r=j?.input.records.find(r=>r.id===p.recordId);if(!j||!b||!r||j.status!=='completed'||!j.predictionIds.includes(p.id)||p.bindingId!==b.id||p.datasetId!==j.datasetId||p.modelVersionId!==b.modelVersionId||p.serviceId!==b.serviceId||p.inputRevision!==j.input.revision||p.inputSignature!==j.inputSignatures[r.id]||!p.demo)throw Error('AI 标注预测来源缺失。');const expected=suggestion(b,j.input,r);if(!same(p.suggestion,expected.suggestion)||p.confidence!==expected.confidence||p.method!==expected.method)throw Error('AI 标注预测或置信度无效。');if(p.acceptedAt&&!entries.some(({r,datasetId})=>datasetId===p.datasetId&&r.id===p.recordId&&r.aiAnnotation?.predictionId===p.id))throw Error('AI 标注接受来源缺失。');}
 for(const {r,datasetId} of entries.filter(e=>e.r.aiAnnotation)){const a=r.aiAnnotation,p=s.predictions.find(p=>p.id===a.predictionId);if(!p?.acceptedAt||datasetId!==p.datasetId||r.id!==p.recordId||a.jobId!==p.jobId||a.bindingId!==p.bindingId||a.modelVersionId!==p.modelVersionId||a.serviceId!==p.serviceId||a.inputRevision!==p.inputRevision||a.inputSignature!==p.inputSignature||a.acceptedAt!==p.acceptedAt||a.acceptedBy!==p.acceptedBy||a.method!==p.method||!same(a.suggestion,p.suggestion)||a.confidence!==p.confidence||a.demo!==true)throw Error('AI 标注草稿或版本来源不一致。');}
}
