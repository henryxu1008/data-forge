// Plain, local prototype objects. Identity and record counts remain real even
// though all actors, input examples and the quality workflow are demonstrations.
import {taskPlanIssues,evaluateRules} from './p1-quality.js';
const copy = value => JSON.parse(JSON.stringify(value));
const text = value => typeof value === 'string' ? value.trim() : '';
const time = value => text(value) || new Date().toISOString();
const defaultRules = {trim:true,dedupe:true,empty:true,pii:true};

export function createDemoTextRecords(prefix = 'TXT') {
  const examples = [
    {text:'  订单已经发货三天，想了解配送进度。联系电话 13800138000。  ',channel:'在线客服',referenceLabel:'物流'},
    {text:'商品收到后发现有划痕，可以申请换货吗？',channel:'售后工单',referenceLabel:'售后'},
    {text:'请问这款设备是否支持蓝牙连接？',channel:'产品咨询',referenceLabel:'商品'},
    {text:'请问白色款还有现货吗？可以发邮件到 henry@example.com 告知吗？',channel:'在线客服',referenceLabel:'咨询'},
  ];
  return [...examples,examples[0],examples[1]].map((record,index)=>({
    ...record,id:`${prefix}-${String(index+1).padStart(3,'0')}`,
  }));
}

function normaliseSpec(spec = {}) {
  return {
    ...copy(spec),
    labels:(Array.isArray(spec.labels)?spec.labels:[]).map(label=>typeof label==='string'
      ? {name:label,description:'',color:'#42d8c1'}
      : {...copy(label),name:text(label.name)}),
  };
}

export function createTextBatch({datasetId,name,projectId,projectName,specSnapshot,rawRecords,batchId,importReport,taskPlan,sourceProjects,at}) {
  if(!text(datasetId))throw new Error('新批次必须具有数据集 ID。');
  const snapshot=normaliseSpec(specSnapshot);
  const source=(Array.isArray(rawRecords)?rawRecords:createDemoTextRecords(datasetId)).map((record,index)=>({
    ...copy(record),id:text(record.id)||`${datasetId}-${String(index+1).padStart(3,'0')}`,
    text:typeof record.text==='string'?record.text:'',
    referenceLabel:text(record.referenceLabel)||text(record.label),
  }));
  return {
    id:datasetId,datasetId,batchId:text(batchId)||`B-${datasetId}`,name:text(name),
    projectId:text(projectId),projectName:text(projectName),
    taskSpecVersionId:text(snapshot.versionId),specSnapshot:snapshot,
    rawRecords:source,records:[],stage:'ingested',revision:0,quality:null,
    versions:[],events:[{id:`${datasetId}-event-1`,type:'ingest',action:'接入文本批次',at:time(at),count:source.length}],
    cleaningReport:null,workflowStarted:false,importReport:importReport?copy(importReport):null,...(taskPlan?{taskPlan:copy(taskPlan)}:{}),...(sourceProjects?{sourceProjects:copy(sourceProjects)}:{}),
  };
}

function addEvent(batch,event) {
  return [...batch.events,{id:`${batch.datasetId}-event-${batch.events.length+1}`,...event}];
}

function staleQuality(batch) {
  return batch.quality?{...batch.quality,status:'stale'}:null;
}

function canClean(batch) {
  return !!batch && !batch.workflowStarted && !batch.versions.length
    && !batch.records.some(record=>record.status!=='todo'||record.history?.length||record.annotator||record.label);
}

function redact(value) {
  return value.replace(/\b(1[3-9]\d)(\d{4})(\d{4})\b/g,'$1****$3')
    .replace(/\b([A-Z0-9._%+-])[A-Z0-9._%+-]*@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi,'$1***@$2');
}

export function cleanTextBatch(batch,{rules=defaultRules,at}={}) {
  if(!canClean(batch))return batch;
  const selected=Object.fromEntries(Object.keys(defaultRules).map(key=>[key,rules[key]!==false]));
  const hits={trim:0,dedupe:0,empty:0,pii:0};
  const removed=[],records=[],seenText=new Map(),seenIds=new Set();
  // IDs identify source records; duplicate IDs cannot safely enter production.
  for(const record of batch.rawRecords){
    if(!text(record.id)||seenIds.has(record.id))return batch;
    seenIds.add(record.id);
  }
  for(const raw of batch.rawRecords){
    let value=raw.text;
    if(selected.trim){
      const next=value.replace(/\u3000/g,' ').replace(/\r\n/g,'\n').replace(/\n\s*\n/g,'\n').trim();
      if(next!==value)hits.trim++;
      value=next;
    }
    if(selected.empty&&!value.trim()){
      hits.empty++;removed.push({id:raw.id,reason:'空内容'});continue;
    }
    // Dedupe precedes masking so two distinct private values are not collapsed.
    if(selected.dedupe&&seenText.has(value)){
      hits.dedupe++;removed.push({id:raw.id,reason:'重复内容',duplicateOf:seenText.get(value)});continue;
    }
    if(!seenText.has(value))seenText.set(value,raw.id);
    if(selected.pii){const next=redact(value);if(next!==value)hits.pii++;value=next;}
    records.push({
      ...copy(raw),id:raw.id,sourceId:raw.id,text:value,channel:raw.channel||'',referenceLabel:raw.referenceLabel||'',
      label:'',status:'todo',annotator:'',draftNote:'',history:[],resubmissions:0,
    });
  }
  const report={input:batch.rawRecords.length,output:records.length,filtered:removed.length,rules:selected,hits,removed,at:time(at)};
  return {
    ...batch,records,stage:'cleaned',revision:batch.revision+1,quality:staleQuality(batch),cleaningReport:report,
    events:addEvent(batch,{type:'clean',action:'完成文本清洗',at:report.at,input:report.input,output:report.output}),
  };
}

export function textBatchCounts(batch) {
  const records=batch?.records||[];
  const counts={todo:0,review:0,rework:0,approved:0,unassigned:0,total:records.length};
  for(const record of records){
    if(['todo','review','rework','approved'].includes(record.status))counts[record.status]++;
    if(record.status==='todo'&&!text(record.annotator))counts.unassigned++;
  }
  return counts;
}

const fail=(batch,error)=>({ok:false,error,batch});
const succeed=(batch,extra={})=>({ok:true,batch,...extra});
const labelsOf=batch=>batch.specSnapshot.labels.map(label=>label.name);

function editRecord(batch,record,patch,{type,action,note='',at,actor}) {
  const nextStatus=patch.status||record.status;
  const event={
    id:`${record.id}-history-${(record.history||[]).length+1}`,type,action,
    from:record.status,to:nextStatus,actor:actor||`${record.annotator||'未分配'} · 演示标注人`,
    at:time(at),label:patch.label??record.label,note,
  };
  const updated={...record,...patch,updatedAt:event.at,history:[...(record.history||[]),event]};
  const next={
    ...batch,records:batch.records.map(item=>item.id===record.id?updated:item),
    revision:batch.revision+1,quality:staleQuality(batch),workflowStarted:true,
    events:addEvent(batch,{type,action,at:event.at,taskId:record.id,actor:event.actor,note}),
  };
  return succeed(next);
}

function inspectQuality(batch,at) {
  const approved=batch.records.filter(record=>record.status==='approved');
  const labels=labelsOf(batch);
  const uniqueLabels=new Set(labels);
  const invalidStructure=approved.filter(record=>!text(record.id)||!text(record.text)||!text(record.label)).length;
  const invalidLabels=approved.filter(record=>!uniqueLabels.has(record.label)).length;
  const duplicates=approved.length-new Set(approved.map(record=>record.text.trim())).size;
  const uniqueIds=new Set(approved.map(record=>record.id)).size===approved.length;
  const checks=[
    {id:'scope',name:'审核通过范围',passed:approved.length>0,detail:approved.length?`纳入 ${approved.length} 条已通过记录，其他状态继续留在工作批次。`:'还没有审核通过的记录，不能发布空版本。'},
    {id:'structure',name:'结构完整性',passed:invalidStructure===0&&uniqueIds,detail:`缺失字段 ${invalidStructure} 条${uniqueIds?'':'，样本编号存在重复'}。`},
    {id:'labels',name:'规范与标签',passed:labels.length>0&&labels.every(Boolean)&&uniqueLabels.size===labels.length&&invalidLabels===0,detail:labels.length?`固定规范 ${batch.specSnapshot.version||batch.taskSpecVersionId}，未定义标签 ${invalidLabels} 条。`:'当前任务规范没有有效标签。'},
    {id:'duplicates',name:'重复与空内容',passed:duplicates===0&&approved.every(record=>record.text.trim()),detail:`重复 ${duplicates} 条，空文本 ${approved.filter(record=>!record.text.trim()).length} 条。`},
    {id:'source',name:'来源与规范版本',passed:!!batch.projectId&&!!batch.batchId&&!!batch.taskSpecVersionId&&batch.stage==='cleaned'&&approved.every(record=>batch.rawRecords.some(raw=>raw.id===record.sourceId)),detail:`项目 ${batch.projectName||batch.projectId||'未关联'} · 批次 ${batch.batchId} · 规范 ${batch.taskSpecVersionId||'未绑定'}。`},
  ];
  const issues=[...taskPlanIssues(approved,batch.taskPlan,'text'),...evaluateRules(approved,batch.ruleModuleSnapshot)];
  if(batch.taskPlan)checks.push({id:'task-plan',name:`任务指标 ${batch.taskPlan.id}`,passed:!issues.some(x=>x.ruleId.startsWith('task-')),detail:`需求与指标固定到 R${batch.taskPlan.revision}`});
  if(batch.ruleModuleSnapshot)checks.push({id:'configured-rules',name:`规则模块 ${batch.ruleModuleSnapshot.name} R${batch.ruleModuleSnapshot.revision}`,passed:!evaluateRules(approved,batch.ruleModuleSnapshot).length,detail:'按固定规则版本逐样本检查'});
  const quality={status:checks.every(check=>check.passed)?'passed':'failed',revision:batch.revision,count:approved.length,checks,issues,checkedAt:time(at),taskPlan:batch.taskPlan?copy(batch.taskPlan):null,ruleSnapshot:batch.ruleModuleSnapshot?copy(batch.ruleModuleSnapshot):null};
  return {...batch,quality,qualityHistory:[...(batch.qualityHistory||[]),copy(quality)],events:addEvent(batch,{type:'checkQuality',action:'完成发布前质量检查',at:quality.checkedAt,result:quality.status,count:quality.count})};
}

export function applyTextBatchAction(batch,action={}) {
  if(!batch)return fail(batch,'没有找到该文本批次，请返回数据集重新选择。');
  const at=time(action.at);
  if(action.type==='clean'){
    if(!canClean(batch))return fail(batch,'本批次已进入标注或发布流程，不能覆盖清洗结果；请接入新批次。');
    const next=cleanTextBatch(batch,{rules:action.rules,at});
    return next===batch?fail(batch,'原始样本编号缺失或重复，无法建立可靠的清洗结果。'):succeed(next);
  }
  if(batch.stage!=='cleaned')return fail(batch,'请先完成本批次清洗，再进入标注与发布流程。');
  if(action.type==='assign'){
    const assignee=text(action.assignee);
    if(!assignee)return fail(batch,'请选择本批次的演示标注人。');
    const ids=action.sampleIds===undefined?batch.records.filter(record=>['todo','rework'].includes(record.status)).map(record=>record.id):action.sampleIds;
    if(!Array.isArray(ids)||!ids.length)return fail(batch,'没有可分配的待标注样本。');
    if(new Set(ids).size!==ids.length||ids.some(id=>!batch.records.some(record=>record.id===id&&['todo','rework'].includes(record.status))))return fail(batch,'分配范围必须是本批次的待标注样本。');
    const selected=new Set(ids);
    const changed=batch.records.some(record=>selected.has(record.id)&&record.annotator!==assignee);
    if(!changed)return fail(batch,'所选样本已经分配给该标注人。');
    const records=batch.records.map(record=>selected.has(record.id)?{...record,annotator:assignee,assignedAt:at}:record);
    return succeed({...batch,records,revision:batch.revision+1,quality:staleQuality(batch),workflowStarted:true,
      events:addEvent(batch,{type:'assign',action:'分配标注任务',at,assignee,sampleIds:[...ids],count:ids.length})});
  }
  if(action.type==='checkQuality')return succeed(inspectQuality(batch,at));
  if(action.type==='publish'){
    const note=text(action.note);
    if(!note)return fail(batch,'请填写发布说明。');
    if(!batch.quality||batch.quality.status!=='passed'||batch.quality.revision!==batch.revision)return fail(batch,'当前工作批次尚未通过质量检查，或检查后发生变化，请重新检查。');
    if(batch.versions.some(version=>version.sourceRevision===batch.revision))return fail(batch,'当前检查范围已经发布，请在工作批次产生新变更后再发布。');
    // Recheck invariants at the final action, even if a caller supplied stale state.
    const verified=inspectQuality(batch,at).quality;
    if(verified.status!=='passed'||verified.count!==batch.quality.count)return fail(batch,'发布范围与质量检查不一致，请重新检查。');
    const index=batch.versions.length+1;
    const version={
      id:`${batch.datasetId}-version-${index}`,datasetId:batch.datasetId,batchId:batch.batchId,
      projectId:batch.projectId,projectName:batch.projectName,datasetName:batch.name,
      version:`v0.${index}`,count:verified.count,
      records:copy(batch.records.filter(record=>record.status==='approved')),
      specSnapshot:copy(batch.specSnapshot),sourceRevision:batch.revision,date:at,
      owner:text(action.owner)||'演示管理员',note,...(batch.sourceProjects?{sourceProjects:copy(batch.sourceProjects)}:{}),...(batch.taskPlan?{taskPlan:copy(batch.taskPlan)}:{}),...(batch.ruleModuleSnapshot?{ruleModuleSnapshot:copy(batch.ruleModuleSnapshot)}:{}),qualitySnapshot:copy(batch.quality),
    };
    return succeed({...batch,versions:[version,...batch.versions],workflowStarted:true,
      events:addEvent(batch,{type:'publish',action:'发布独立数据版本',at,versionId:version.id,version:version.version,count:version.count})},{version});
  }
  const record=batch.records.find(item=>item.id===action.taskId);
  if(!record)return fail(batch,'没有找到本批次中的样本，操作未生效。');
  const note=text(action.note);
  const label=action.label===undefined?record.label:text(action.label);
  const validLabel=labelsOf(batch).includes(label);
  if(action.type==='saveDraft'){
    if(!['todo','rework'].includes(record.status))return fail(batch,'只有待标注或返工样本可以保存草稿。');
    if(!record.annotator)return fail(batch,'请先分配标注人，再保存草稿。');
    if(label&&!validLabel)return fail(batch,'所选标签不属于本批次固定的标注规范。');
    if(record.label===label&&(record.draftNote||'')===note)return fail(batch,'草稿没有新的修改。');
    return editRecord(batch,record,{label,draftNote:note},{type:'saveDraft',action:'保存标注草稿',note,at});
  }
  if(action.type==='submit'||action.type==='resubmit'){
    const resubmitting=action.type==='resubmit';
    if(record.status!==(resubmitting?'rework':'todo'))return fail(batch,resubmitting?'仅返工样本可以重新提交。':'仅待标注样本可以提交审核。');
    if(!record.annotator)return fail(batch,'请先分配标注人，再提交审核。');
    if(!validLabel)return fail(batch,'请选择本批次规范中的有效标签。');
    if(!record.text.trim())return fail(batch,'文本为空，不能提交审核；请修复来源并接入新批次。');
    if(resubmitting&&!note)return fail(batch,'请填写返工说明，再重新提交审核。');
    return editRecord(batch,record,{status:'review',label,draftNote:note,
      ...(resubmitting?{reworkNote:note,resubmissions:(record.resubmissions||0)+1}:{submissionNote:note})},
      {type:action.type,action:resubmitting?'返工后重新提交':'提交标注审核',note,at});
  }
  if(action.type==='reject'){
    if(record.status!=='review')return fail(batch,'仅待审核样本可以退回修改。');
    if(!note)return fail(batch,'请填写退回原因。');
    return editRecord(batch,record,{status:'rework',returnReason:note,reason:note,draftNote:''},
      {type:'reject',action:'退回修改',note,at,actor:'演示管理员 · 演示审核员'});
  }
  if(action.type==='approve'){
    if(record.status!=='review')return fail(batch,'仅待审核样本可以通过审核。');
    if(!validLabel)return fail(batch,'审核标签必须属于本批次固定的标注规范。');
    return editRecord(batch,record,{status:'approved',label,reviewNote:note},
      {type:'approve',action:'审核通过',note,at,actor:'演示管理员 · 演示审核员'});
  }
  if(action.type==='reopen'){
    if(record.status!=='approved')return fail(batch,'只有已通过样本可以重新标注。');
    if(!note)return fail(batch,'请填写重新标注原因；历史发布版本仍保持不变。');
    return editRecord(batch,record,{status:'todo',reopenReason:note,draftNote:'',reviewNote:''},
      {type:'reopen',action:'重新打开标注',note,at,actor:'演示管理员 · 演示审核员'});
  }
  return fail(batch,'不支持的批次操作。');
}
