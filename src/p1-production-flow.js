import {clone,validatePlan,validateRules,evaluateRules,taskPlanIssues,planForProject} from './p1-quality.js';
import {createTextBatch} from './text-production-state.js';
export const createProductionFlowState=()=>({sequence:0,planVersions:[],jobs:[],versions:[],ruleVersions:[],qualityReports:[]});
const txt=x=>typeof x==='string'?x.trim():'';
const next=(s,p)=>`${p}-${++s.sequence}`;
export function flowInputCatalog(w){
 return [...Object.values(w.textBatches||{}).map(b=>({id:`raw:${b.datasetId}`,datasetId:b.datasetId,batchId:b.batchId,projectId:b.projectId,projectName:b.projectName,datasetName:`${b.name} · 原始接入`,version:'原始',type:'text',sourceProjects:clone(b.sourceProjects||[b.projectId]),specSnapshot:clone(b.specSnapshot),records:clone(b.rawRecords),...(b.taskPlan?{taskPlan:clone(b.taskPlan)}:{})})),...Object.values(w.textBatches||{}).flatMap(b=>b.versions),...Object.values(w.imageBatches||{}).flatMap(b=>b.versions),...(w.versions||[]).map(v=>({...clone(v),id:`customer:${v.version}`,datasetId:'customer',batchId:'CUSTOMER-DEMO',projectId:'PRJ-001',type:'text',datasetName:'客户反馈意图分类'})),...(w.flow?.versions||[])];
}
function input(w,id){const found=flowInputCatalog(w).filter(v=>v.id===id);if(found.length!==1)throw Error('请选择存在且唯一的输入版本。');return found[0];}
function configValid(kind,c={}){
 if(kind==='aggregation'&&!['reject','keepFirst','namespace'].includes(c.conflict))throw Error('请选择明确的冲突处理策略。');
 if(kind==='enhancement'&&c.operation!=='repair'&&(!txt(c.prefix)&&!txt(c.suffix)))throw Error('模板扩写需要前缀或后缀。');
 if((c.prefix||'').length>2000||(c.suffix||'').length>2000)throw Error('模板前后缀各限 2000 字符。');
 if(c.skipInvalid!==undefined&&typeof c.skipInvalid!=='boolean')throw Error('是否排除错误记录必须明确选择。');
 if(c.operation&&!['repair','template'].includes(c.operation))throw Error('增强操作类型无效。');
 if(c.mappings)for(const m of Object.values(c.mappings))for(const [k,v]of Object.entries(m))if(!['id','text','label','channel'].includes(k)||typeof v!=='string'||(!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(v)||['__proto__','prototype','constructor'].includes(v)))throw Error('字段映射无效。');
 return clone(c);
}
function reportIssues(job,rule){
 const issues=taskPlanIssues(job.records,job.taskPlan,'text'),ids=new Set();
 for(const r of job.records){if(!txt(r.id)||ids.has(r.id)||!txt(r.text))issues.push({recordId:r.id,ruleId:'base',reason:'样本编号重复/缺失或正文为空'});ids.add(r.id)}
 if(!job.records.length)issues.push({recordId:'*',ruleId:'scope',reason:'输出为空'});
 return issues.concat(evaluateRules(job.records,rule));
}
export function applyProductionFlowAction(workspace,a,ctx={}){
 const no=error=>({ok:false,workspace,error,events:[]});
 if(!a||!Number.isFinite(Date.parse(a.at)))return no('操作时间无效。');
 try{
  const w=clone(workspace),s=w.flow=w.flow||createProductionFlowState();let entity;
  const job=()=>{const j=s.jobs.find(x=>x.id===a.jobId);if(!j)throw Error('任务不存在。');return j;};
  const rule=id=>{if(!id)return null;const r=s.ruleVersions.find(x=>x.id===id);if(!r)throw Error('规则版本不存在。');return r;};
  if(a.type==='saveTaskPlan'){
   let project=w.production.projects.find(x=>x.id===a.projectId);
   if(!project&&a.project){const p=a.project,t=w.production.templates.find(x=>x.id===p.templateId),labels=w.production.taxonomies.find(x=>x.id===p.taxonomyId);if(!txt(p.name)||!t||!labels?.tags.length)throw Error('请选择名称、已保存规范和标签体系。');
    const projectId=next(s,'PRJ-P1');project={id:projectId,name:txt(p.name),scene:txt(p.scene)||'其他业务',goal:txt(p.goal),type:t.type,owner:ctx.actorName||'演示管理员',date:a.at.slice(0,10),phase:'待接入',count:'暂无数据',progress:0,tone:'neutral',target:'ingestion',action:'接入数据',issue:'等待接入数据',detail:`${p.scene||'其他业务'} · ${t.name}`,specSnapshot:{type:t.type,versionId:`${t.id}:v${t.revision||1}:${labels.id}:v${labels.revision||1}`,name:t.name,version:`v${t.revision||1}`,guide:t.guide,review:t.review,input:t.input,output:t.output,labels:clone(labels.tags),taxonomyId:labels.id}};w.production.projects.unshift(project);
   }
   if(!project)throw Error('关联项目不存在。');const contract=validatePlan(a.requirements,a.metrics);if(project.type!==contract.requirements.type)throw Error('任务类型与项目规范不兼容。');
   const previous=s.planVersions.find(p=>p.projectId===project.id);entity={id:next(s,'PLAN'),projectId:project.id,name:project.name,revision:(previous?.revision||0)+1,...contract,at:a.at};s.planVersions.unshift(entity);project.taskPlanId=entity.id;
  }else if(a.type==='saveRuleModule'){
   if(!w.production.projects.some(p=>p.id===a.projectId)||!txt(a.name))throw Error('请选择项目并填写规则模块名称。');const previous=a.moduleId?s.ruleVersions.find(r=>r.moduleId===a.moduleId):null;
   if(a.moduleId&&(!previous||previous.projectId!==a.projectId))throw Error('规则模块与项目不一致。');if(s.ruleVersions.some(r=>r.projectId===a.projectId&&r.name===txt(a.name)&&r.moduleId!==a.moduleId))throw Error('同项目规则模块名称重复。');
   entity={id:next(s,'RULESET'),moduleId:previous?.moduleId||next(s,'RULEMODULE'),projectId:a.projectId,name:txt(a.name),revision:(previous?.revision||0)+1,rules:validateRules(a.rules),at:a.at};s.ruleVersions.unshift(entity);
  }else if(a.type==='createJob'){
   const project=w.production.projects.find(p=>p.id===a.projectId);if(!project||project.type!=='text'||!txt(a.name)||!['aggregation','enhancement'].includes(a.kind))throw Error('请选择文本项目、任务类型并填写名称。');
   if(!Array.isArray(a.inputVersionIds)||new Set(a.inputVersionIds).size!==a.inputVersionIds.length||(a.kind==='aggregation'?a.inputVersionIds.length<2:a.inputVersionIds.length!==1))throw Error('汇聚需要至少两个不同输入；增强需要一个输入。');
   const inputs=a.inputVersionIds.map(id=>input(w,id));if(inputs.some(v=>v.type==='image'||!Array.isArray(v.records)||!v.records.length))throw Error('当前仅支持非空文本版本。');
   const selectedRule=rule(a.ruleVersionId);if(selectedRule&&selectedRule.projectId!==project.id)throw Error('规则与目标项目不一致。');const plan=planForProject(w,project.id);if(plan&&!plan.requirements.sources.includes(a.kind))throw Error('该任务计划不允许此来源。');
   entity={id:next(s,'PIPE'),kind:a.kind,name:txt(a.name),projectId:project.id,projectName:project.name,specSnapshot:clone(project.specSnapshot),taskPlan:plan?clone(plan):null,inputSnapshots:clone(inputs),sourceProjects:[...new Set([project.id,...inputs.flatMap(v=>v.sourceProjects||[v.projectId])])],config:configValid(a.kind,a.config),status:'draft',revision:0,records:[],attempts:[],excluded:[],conflicts:[],qualityReportId:null,ruleVersionId:a.ruleVersionId||'',at:a.at};s.jobs.unshift(entity);
  }else if(a.type==='runJob'){
   entity=job();if(!['draft','failed'].includes(entity.status))throw Error('只有草稿或失败任务可执行/重试；已有产物请新建任务。');if(a.config)entity.config=configValid(entity.kind,a.config);
   const records=[],excluded=[],conflicts=[],seen=new Map();let failed=false;
   for(const [sourceIndex,v]of entity.inputSnapshots.entries())for(const raw of v.records){const m=entity.config.mappings?.[v.id]||{};const rid=txt(raw[m.id||'id']),text=raw[m.text||'text'];
    if(!rid||typeof text!=='string'||!text.trim()){excluded.push({versionId:v.id,recordId:rid,reason:'编号/正文缺失或字段映射无效'});if(!entity.config.skipInvalid)failed=true;continue;}
    const id=entity.kind==='enhancement'?`${entity.id}:${rid}`:entity.config.conflict==='namespace'?`${sourceIndex+1}:${rid}`:rid;
    if(seen.has(id)){conflicts.push({recordId:rid,versionId:v.id,existingVersionId:seen.get(id),reason:'输出编号冲突'});if(entity.config.conflict==='reject')failed=true;else excluded.push({versionId:v.id,recordId:rid,reason:'编号冲突，明确保留首次记录'});continue;}
    seen.set(id,v.id);records.push({id,text:entity.kind==='enhancement'?`${entity.config.prefix||''}${text}${entity.config.suffix||''}`:text,label:raw[m.label||'label']||'',channel:raw[m.channel||'channel']||'',status:'review',parents:[{versionId:v.id,recordId:txt(raw.id)||rid,projectId:v.projectId}]});
   }
   entity.revision++;entity.records=failed?[]:records;entity.excluded=excluded;entity.conflicts=conflicts;entity.status=failed||!records.length?'failed':'review';entity.error=failed?'输入存在冲突或错误，请修正策略后重试。':!records.length?'处理输出为空。':'';entity.qualityReportId=null;entity.attempts.push({id:next(s,'PIPEATTEMPT'),at:a.at,config:clone(entity.config),status:entity.status,error:entity.error,excluded:clone(excluded),conflicts:clone(conflicts)});
  }else if(a.type==='reviewJob'){
   entity=job();if(!['review','rework','approved'].includes(entity.status)||!txt(a.note)||!['approve','reject'].includes(a.decision))throw Error('请审核已有产物并填写处理说明。');entity.status=a.decision==='approve'?'approved':'rework';entity.review={decision:a.decision,note:txt(a.note),actorId:ctx.actorId,at:a.at};entity.revision++;entity.qualityReportId=null;
  }else if(a.type==='repairJobRecord'){
   entity=job();if(!['review','rework','approved'].includes(entity.status)||!txt(a.note)||!txt(a.text)||a.text.length>500000)throw Error('仅未发布产物可修正，正文和原因必填。');const row=entity.records.find(r=>r.id===a.recordId);if(!row)throw Error('产物样本不存在。');
   if(a.label!==undefined&&!entity.specSnapshot.labels.some(l=>(l.name||l)===a.label))throw Error('标签不属于目标项目规范。');row.text=a.text;if(a.label!==undefined)row.label=a.label;entity.status='rework';entity.revision++;entity.qualityReportId=null;(entity.repairs||=[]).push({recordId:row.id,note:txt(a.note),at:a.at});
  }else if(a.type==='selectJobRules'){
   entity=job();if(entity.status==='published')throw Error('已发布任务不可变更规则。');const r=rule(a.ruleVersionId);if(r&&r.projectId!==entity.projectId)throw Error('规则与目标项目不一致。');entity.ruleVersionId=r?.id||'';entity.qualityReportId=null;
  }else if(a.type==='assessJob'){
   const j=job();if(j.status!=='approved')throw Error('请先人工审核通过当前修订。');const r=rule(a.ruleVersionId||j.ruleVersionId);if(r&&r.projectId!==j.projectId)throw Error('规则与目标项目不一致。');j.ruleVersionId=r?.id||'';
   const issues=reportIssues(j,r);entity={id:next(s,'QREPORT'),jobId:j.id,projectId:j.projectId,sourceProjects:clone(j.sourceProjects),inputVersionIds:j.inputSnapshots.map(v=>v.id),sourceRevision:j.revision,recordsSnapshot:clone(j.records),taskPlan:j.taskPlan?clone(j.taskPlan):null,ruleSnapshot:r?clone(r):null,status:issues.length?'failed':'passed',issues,recordCount:j.records.length,stage:j.kind,at:a.at};s.qualityReports.unshift(entity);j.qualityReportId=entity.id;
  }else if(a.type==='assessVersion'){
   const v=input(w,a.versionId),r=rule(a.ruleVersionId);if(v.type==='image')throw Error('新增输入质评当前仅支持文本；图片继续使用既有图片质检。');if(r&&r.projectId!==v.projectId)throw Error('规则与输入项目不一致。');const issues=reportIssues({records:v.records,taskPlan:v.taskPlan},r);entity={id:next(s,'QREPORT'),versionId:v.id,inputSnapshot:clone(v),projectId:v.projectId,sourceProjects:[v.projectId],ruleSnapshot:r?clone(r):null,status:issues.length?'failed':'passed',issues,recordCount:v.records.length,stage:a.stage==='ingestion'?'ingestion':'processing',at:a.at};s.qualityReports.unshift(entity);
  }else if(a.type==='publishJob'){
   const j=job(),q=s.qualityReports.find(r=>r.id===j.qualityReportId);if(j.status!=='approved'||!q||q.status!=='passed'||q.sourceRevision!==j.revision||q.ruleSnapshot?.id!==(j.ruleVersionId||undefined)||!txt(a.note))throw Error('当前审核、规则或质评无效，请复检并填写发布说明。');const r=rule(j.ruleVersionId);if(reportIssues(j,r).length)throw Error('最终复检失败，未发布。');
   entity={id:next(s,'PIPEVERSION'),datasetId:`prepared-${ctx.spaceId||'local'}-${j.id}`,batchId:j.id,projectId:j.projectId,projectName:j.projectName,datasetName:j.name,type:'text',version:'v1',jobId:j.id,sourceRevision:j.revision,sourceProjects:clone(j.sourceProjects),parents:j.inputSnapshots.map(v=>({versionId:v.id,projectId:v.projectId})),records:j.records.map(r=>({...clone(r),status:'approved'})),count:j.records.length,specSnapshot:clone(j.specSnapshot),taskPlan:j.taskPlan?clone(j.taskPlan):null,qualitySnapshot:clone(q),ruleModuleSnapshot:r?clone(r):null,note:txt(a.note),date:a.at};s.versions.unshift(entity);j.status='published';j.outputVersionId=entity.id;
  }else if(a.type==='sendToProduction'){
   const j=job(),v=s.versions.find(v=>v.id===j.outputVersionId);if(!v||j.status!=='published'||j.linkedDatasetId)throw Error('请先发布产物；同任务只能接续一次标注批次。');const datasetId=`pipeline-${ctx.spaceId||'local'}-${j.id}`;
   entity=createTextBatch({datasetId,name:`${j.name} · 标注批次`,projectId:j.projectId,projectName:j.projectName,specSnapshot:j.specSnapshot,taskPlan:j.taskPlan,rawRecords:clone(v.records),at:a.at});entity.sourceProjects=clone(v.sourceProjects||[v.projectId]);if(v.ruleModuleSnapshot)entity.ruleModuleSnapshot=clone(v.ruleModuleSnapshot);w.textBatches[datasetId]=entity;w.datasets.push({id:datasetId,name:entity.name,type:'text',total:entity.rawRecords.length,status:'cleaning',version:'未发布',owner:ctx.actorName||'演示管理员'});j.linkedDatasetId=datasetId;w.selectedId=datasetId;
  }else if(a.type==='deleteJob'){
   entity=job();if(!['draft','failed'].includes(entity.status)||s.qualityReports.some(q=>q.jobId===entity.id)||s.versions.some(v=>v.jobId===entity.id)||!txt(a.note))throw Error('已有审核/质评/发布来源的任务不可删除，请保留追溯。');s.jobs=s.jobs.filter(j=>j.id!==entity.id);
  }else throw Error('不支持的生产衔接操作。');
  return {ok:true,workspace:w,entity,events:[{action:`生产衔接 · ${a.type}`,object:entity.name||entity.id,result:entity.status==='failed'?'失败':'成功',at:a.at,details:a.note||entity.error||'本地规则演示',after:{编号:entity.id,项目:entity.projectId,状态:entity.status,修订:entity.revision}}]};
 }catch(e){return no(e.message)}
}
export function flowActionProjects(w,a){
 const s=w.flow||createProductionFlowState(),j=s.jobs.find(j=>j.id===a.jobId),r=s.ruleVersions.find(r=>r.id===a.ruleVersionId||r.moduleId===a.moduleId),p=s.planVersions.find(p=>p.id===a.planId);const projects=[a.projectId,j?.projectId,...(j?.sourceProjects||[]),r?.projectId,p?.projectId];
 for(const id of a.inputVersionIds||[]){const v=flowInputCatalog(w).find(v=>v.id===id);projects.push(v?.projectId,...(v?.sourceProjects||[]));}if(a.versionId)projects.push(flowInputCatalog(w).find(v=>v.id===a.versionId)?.projectId);return [...new Set(projects.filter(Boolean))];
}
export function visibleProductionFlow(flow,allowed){
 const s=clone(flow||createProductionFlowState()),visible=x=>allowed(x.projectId)&&(x.sourceProjects||[]).every(allowed);for(const key of ['planVersions','jobs','versions','ruleVersions','qualityReports'])s[key]=s[key].filter(visible);return s;
}
export function validateProductionFlow(w){
 if(!w.flow){if(Object.values(w.textBatches||{}).concat(Object.values(w.imageBatches||{})).some(b=>b.taskPlan||b.ruleModuleSnapshot))throw Error('任务计划或规则状态缺失。');return;}const s=w.flow;if(!Number.isInteger(s.sequence)||s.sequence<0)throw Error('生产衔接序列无效。');for(const key of ['planVersions','jobs','versions','ruleVersions','qualityReports']){if(!Array.isArray(s[key])||s[key].some(x=>!txt(x.id))||new Set(s[key].map(x=>x.id)).size!==s[key].length)throw Error('生产衔接集合编号或结构无效。');}
 const projects=new Set(w.production.projects.map(p=>p.id));for(const key of ['planVersions','jobs','versions','ruleVersions','qualityReports'])if(s[key].some(x=>!projects.has(x.projectId)))throw Error('生产衔接项目引用缺失。');
 for(const p of s.planVersions)validatePlan(p.requirements,p.metrics);for(const r of s.ruleVersions)validateRules(r.rules);
 const catalog=flowInputCatalog(w),ids=new Set(catalog.map(v=>v.id));if(ids.size!==catalog.length)throw Error('输入版本身份重复。');const versionsById=new Map(s.versions.map(v=>[v.id,v]));const visit=(id,path=[])=>{if(path.includes(id))throw Error('处理版本来源存在循环。');for(const p of versionsById.get(id)?.parents||[])if(versionsById.has(p.versionId))visit(p.versionId,[...path,id]);};for(const v of s.versions)visit(v.id);for(const v of s.versions)if((v.parents||[]).some(p=>!ids.has(p.versionId)))throw Error('处理版本父来源缺失。');
 for(const j of s.jobs){if(!['aggregation','enhancement'].includes(j.kind)||!['draft','failed','review','rework','approved','published'].includes(j.status))throw Error('处理任务类型或状态无效。');for(const v of j.inputSnapshots||[]){const canonical=catalog.find(c=>c.id===v.id);if(canonical&&JSON.stringify(canonical)!==JSON.stringify(v))throw Error('冻结输入来源内容与版本不一致。');}configValid(j.kind,j.config);if(!Array.isArray(j.records))throw Error('处理产物结构无效。');for(const row of j.records){if(!Array.isArray(row.parents)||!row.parents.length||row.parents.some(p=>!j.inputSnapshots?.some(v=>v.id===p.versionId&&v.projectId===p.projectId&&v.records.some(r=>r.id===p.recordId))))throw Error('产物父来源样本引用缺失。');}if(j.taskPlan&&JSON.stringify(j.taskPlan)!==JSON.stringify(s.planVersions.find(p=>p.id===j.taskPlan.id)))throw Error('冻结任务计划被改写。');if(!Array.isArray(j.inputSnapshots)||j.inputSnapshots.some(v=>!ids.has(v.id))||j.taskPlan&&!s.planVersions.some(p=>p.id===j.taskPlan.id)||j.ruleVersionId&&!s.ruleVersions.some(r=>r.id===j.ruleVersionId)||j.outputVersionId&&!s.versions.some(v=>v.id===j.outputVersionId&&v.jobId===j.id)||j.linkedDatasetId&&!w.textBatches[j.linkedDatasetId])throw Error('处理任务来源、计划、规则或产物引用缺失。');if(j.qualityReportId&&!s.qualityReports.some(q=>q.id===j.qualityReportId&&q.jobId===j.id))throw Error('当前质评引用缺失。');}
 for(const b of [...Object.values(w.textBatches||{}),...Object.values(w.imageBatches||{}),...s.versions]){if(b.taskPlan&&JSON.stringify(b.taskPlan)!==JSON.stringify(s.planVersions.find(p=>p.id===b.taskPlan.id&&p.projectId===b.projectId)))throw Error('批次或版本任务计划引用失效。');if(b.ruleModuleSnapshot&&JSON.stringify(b.ruleModuleSnapshot)!==JSON.stringify(s.ruleVersions.find(r=>r.id===b.ruleModuleSnapshot.id&&r.projectId===b.projectId)))throw Error('批次或版本规则引用失效。');}for(const q of s.qualityReports){if(q.ruleSnapshot&&JSON.stringify(q.ruleSnapshot)!==JSON.stringify(s.ruleVersions.find(r=>r.id===q.ruleSnapshot.id)))throw Error('质评规则快照被改写。');if(q.jobId&&!s.jobs.some(j=>j.id===q.jobId)||q.versionId&&!ids.has(q.versionId)||q.ruleSnapshot&&!s.ruleVersions.some(r=>r.id===q.ruleSnapshot.id))throw Error('质评来源引用缺失。');}
}
