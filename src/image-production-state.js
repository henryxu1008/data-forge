import {taskPlanIssues} from './p1-quality.js';
// Image annotations use original-image pixel coordinates. These objects are
// local prototype state, not a backend, authorization layer or training engine.
export {createDemoImageRecords} from './image-demo-assets.js';

const clone = value => JSON.parse(JSON.stringify(value));
const text = value => typeof value==='string'?value.trim():'';
const timestamp = value => text(value)||new Date().toISOString();
const statuses = ['todo','review','rework','approved'];
const editableStatuses = ['todo','rework'];
const severities = ['轻微','一般','严重'];
const rasterTypes = ['image/png','image/jpeg','image/webp'];
const epsilon = 1e-6;

export const defaultImageSpec = {
  versionId:'detection:v1:defects:v1',name:'图像目标检测',version:'v1',type:'image',
  taxonomyId:'defects',taxonomyVersionId:'defects:v1',
  input:'原始图片、图片尺寸、采集来源与批次',output:'目标框、缺陷类别、严重程度与审核记录',
  guide:'逐一圈定可见缺陷，标注框紧贴目标。坐标以原图左上角为原点；确认没有缺陷的图片应显式勾选“无缺陷”，不能直接空框提交。',
  review:'每张图片均需人工审核；不合格图片记录原因和关联框，修改后重新提交。',
  labels:[
    {name:'划痕',description:'表面线状损伤',color:'#f2b84c'},
    {name:'凹陷',description:'表面局部变形',color:'#77a9ed'},
    {name:'裂纹',description:'连续或断续裂缝',color:'#f18b94'},
  ],
  severities:[...severities],
};

function normaliseSpec(input) {
  const spec=input&&typeof input==='object'?clone(input):{};
  const labels=(Array.isArray(spec.labels)?spec.labels:[]).map(label=>typeof label==='string'
    ?{name:text(label),description:'',color:'#42d8c1'}
    :{...label,name:text(label?.name)});
  return {...spec,labels,severities:[...severities]};
}

function specIssues(spec) {
  const labels=(Array.isArray(spec?.labels)?spec.labels:[]).map(label=>text(typeof label==='string'?label:label?.name));
  const issues=[];
  if(!text(spec?.versionId))issues.push('缺少冻结规范版本编号。');
  if(!labels.length||labels.some(label=>!label)||new Set(labels).size!==labels.length)issues.push('标签规范必须包含不重复的有效类别。');
  return issues;
}

function sourceIssues(record) {
  const issues=[];
  if(!text(record?.id)||!text(record?.name))issues.push('图片编号或文件名缺失。');
  if(!Number.isSafeInteger(record?.width)||!Number.isSafeInteger(record?.height)||record.width<1||record.height<1||record.width>8192||record.height>8192||record.width*record.height>24000000)issues.push('图片尺寸无效：长边应不超过 8192 像素，总像素不超过 2400 万。');
  if(!['built-in','upload'].includes(record?.source))issues.push('图片来源标识无效。');
  const mime=record?.mimeType,src=record?.src;
  if(typeof src!=='string'||!src.startsWith('data:'))issues.push('缺少本地图片数据，不能使用远程地址或临时引用发布。');
  else if(mime==='image/svg+xml'){
    if(record.source!=='built-in'||!/^data:image\/svg\+xml(?:;charset=[^,;]+)?(?:;base64)?,.+/i.test(src))issues.push('仅内置示意图可以使用 SVG 图片数据。');
  }else if(!rasterTypes.includes(mime)||!src.startsWith(`data:${mime};base64,`)||src.length<=`data:${mime};base64,`.length)issues.push('本地图片数据格式应为 PNG、JPEG 或 WebP。');
  return issues;
}

function annotationIssues(record,spec,{draft=false}={}) {
  const issues=[];
  if(!Array.isArray(record?.boxes))return ['目标框列表无效。'];
  const boxes=record.boxes;
  if(typeof record.noDefect!=='boolean')issues.push('请明确当前图片是否无缺陷。');
  if(record.noDefect&&boxes.length)issues.push('无缺陷标记不能与目标框同时存在。');
  if(!draft&&!record.noDefect&&!boxes.length)issues.push('请至少画一个目标框，或明确标记为无缺陷。');
  const ids=new Set();
  const labels=new Set((Array.isArray(spec?.labels)?spec.labels:[]).map(label=>text(typeof label==='string'?label:label?.name)));
  boxes.forEach((box,index)=>{
    const caption=`第 ${index+1} 个目标框`;
    const boxId=text(box?.id);
    if(!boxId||ids.has(boxId))issues.push(`${caption}编号缺失或重复。`);
    ids.add(boxId);
    if(![box?.x,box?.y,box?.width,box?.height].every(value=>typeof value==='number'&&Number.isFinite(value)))issues.push(`${caption}坐标必须是有限数值。`);
    else if(box.width<=0||box.height<=0||box.x<0||box.y<0||box.x+box.width>record.width+epsilon||box.y+box.height>record.height+epsilon)issues.push(`${caption}必须具有正面积且完全位于原图范围内。`);
    const label=text(box?.label);
    if(!label&&!draft)issues.push(`${caption}尚未选择缺陷类别。`);
    else if(label&&!labels.has(label))issues.push(`${caption}类别不属于本批次冻结规范。`);
    if(!severities.includes(box?.severity))issues.push(`${caption}请选择有效的严重程度。`);
  });
  return issues;
}

export function imageRecordIssues(record,specSnapshot) {
  return [...sourceIssues(record),...specIssues(specSnapshot),...annotationIssues(record,specSnapshot)];
}

export function createImageBatch({datasetId,name,projectId,projectName,specSnapshot,records,batchId,taskPlan,at}={}) {
  if(!text(datasetId))throw new Error('图片批次必须具有数据集编号。');
  if(!text(name))throw new Error('请填写图片数据集名称。');
  if(!text(projectId)||!text(projectName))throw new Error('请关联一个有效的图片项目。');
  const spec=normaliseSpec(specSnapshot);
  const invalidSpec=specIssues(spec);
  if(invalidSpec.length)throw new Error(invalidSpec[0]);
  if(!Array.isArray(records)||!records.length)throw new Error('请先接入至少一张可读取的图片。');
  const images=records.map((input,index)=>({
    id:text(input?.id)||`${datasetId}-IMG-${String(index+1).padStart(3,'0')}`,
    feedbackId:input?.feedbackId||null,originSnapshot:input?.originSnapshot?clone(input.originSnapshot):null,name:text(input?.name),src:input?.src,width:input?.width,height:input?.height,
    mimeType:input?.mimeType,source:input?.source,
    description:text(input?.description),
    boxes:[],noDefect:false,note:'',status:'todo',assignee:'',history:[],resubmissions:0,
  }));
  if(new Set(images.map(record=>record.id)).size!==images.length)throw new Error('图片编号重复，不能建立可追溯的批次。');
  for(const record of images){const issues=sourceIssues(record);if(issues.length)throw new Error(`${record.name||record.id}：${issues[0]}`);}
  const date=timestamp(at);
  return {
    id:text(datasetId),datasetId:text(datasetId),name:text(name),type:'image',
    projectId:text(projectId),projectName:text(projectName),batchId:text(batchId)||`B-${datasetId}`,
    taskSpecVersionId:spec.versionId,specSnapshot:spec,records:images,
    revision:0,quality:null,versions:[],createdAt:date,updatedAt:date,...(taskPlan?{taskPlan:clone(taskPlan)}:{}),
  };
}

export function imageBatchCounts(batch) {
  const records=Array.isArray(batch?.records)?batch.records:[];
  const counts={total:records.length,todo:0,review:0,rework:0,approved:0,unassigned:0,boxes:0};
  records.forEach(record=>{
    if(statuses.includes(record.status))counts[record.status]++;
    if(editableStatuses.includes(record.status)&&!text(record.assignee))counts.unassigned++;
    counts.boxes+=Array.isArray(record.boxes)?record.boxes.length:0;
  });
  return counts;
}

const fail=(batch,error)=>({ok:false,batch,error});
const ok=(batch,extra={})=>({ok:true,batch,...extra});
const stale=quality=>quality?{...quality,status:'stale'}:null;

function historyEntry(record,action,patch,at,title) {
  return {
    id:`${record.id}-history-${record.history.length+1}`,type:action.type,action:title,
    from:record.status,to:patch.status||record.status,at,
    actor:['reject','approve','reopen'].includes(action.type)?'演示管理员 · 演示审核员':`${patch.assignee||record.assignee||'未分配'} · 演示标注人`,
    note:text(action.note),boxIds:Array.isArray(action.boxIds)?[...action.boxIds]:[],
    boxes:clone(patch.boxes||record.boxes),noDefect:patch.noDefect??record.noDefect,
  };
}

function updateRecord(batch,record,patch,action,at,title) {
  const event=historyEntry(record,action,patch,at,title);
  const updated={...record,...patch,updatedAt:at,history:[...record.history,event]};
  return ok({...batch,records:batch.records.map(item=>item.id===record.id?updated:item),revision:batch.revision+1,quality:stale(batch.quality),updatedAt:at},{record:updated});
}

function candidateAnnotation(record,action) {
  return {
    ...record,
    boxes:action.boxes===undefined?record.boxes:action.boxes,
    noDefect:action.noDefect===undefined?record.noDefect:action.noDefect,
    note:action.note===undefined?record.note:text(action.note),
  };
}

function annotationPatch(candidate) {
  return {
    boxes:candidate.boxes.map(box=>({
      id:text(box.id),x:box.x,y:box.y,
      width:Math.min(box.width,candidate.width-box.x),height:Math.min(box.height,candidate.height-box.y),
      label:text(box.label),severity:box.severity,
    })),
    noDefect:candidate.noDefect,note:candidate.note,
  };
}

function inspectQuality(batch,at) {
  const approved=batch.records.filter(record=>record.status==='approved');
  const sourceFailures=approved.filter(record=>sourceIssues(record).length);
  const geometryFailures=approved.filter(record=>annotationIssues(record,batch.specSnapshot,{draft:true}).some(issue=>/列表|编号|坐标|面积|范围/.test(issue)));
  const annotationFailures=approved.filter(record=>annotationIssues(record,batch.specSnapshot).length);
  const validSpec=specIssues(batch.specSnapshot).length===0;
  const identityValid=!!text(batch.datasetId)&&!!text(batch.projectId)&&!!text(batch.batchId)&&!!text(batch.taskSpecVersionId)&&batch.taskSpecVersionId===batch.specSnapshot?.versionId;
  const uniqueIds=new Set(batch.records.map(record=>record.id)).size===batch.records.length;
  const boxCount=approved.reduce((sum,record)=>sum+(Array.isArray(record.boxes)?record.boxes.length:0),0);
  const normalCount=approved.filter(record=>record.noDefect).length;
  const rules=[
    {id:'scope',name:'审核通过范围',passed:approved.length>0,detail:approved.length?`纳入 ${approved.length} 张审核通过图片，${batch.records.length-approved.length} 张继续留在工作批次。`:'还没有审核通过的图片，不能发布空版本。'},
    {id:'image',name:'图片数据与尺寸',passed:sourceFailures.length===0&&uniqueIds,detail:`无法完整读取或尺寸无效 ${sourceFailures.length} 张${uniqueIds?'':'，图片编号存在重复'}。`},
    {id:'geometry',name:'目标框坐标',passed:geometryFailures.length===0,detail:`共 ${boxCount} 个原图像素目标框，越界、无效或重复框编号 ${geometryFailures.length} 张。`},
    {id:'labels',name:'类别与无缺陷标记',passed:validSpec&&annotationFailures.length===0,detail:`规范 ${batch.specSnapshot?.version||batch.taskSpecVersionId}；${normalCount} 张明确标记无缺陷，不合规标注 ${annotationFailures.length} 张。`},
    {id:'source',name:'项目与规范来源',passed:identityValid,detail:`项目 ${batch.projectName||'未关联'} · 批次 ${batch.batchId||'未关联'} · 规范 ${batch.taskSpecVersionId||'未绑定'}。`},
  ];
  const issues=taskPlanIssues(approved,batch.taskPlan,'image');if(batch.taskPlan)rules.push({id:'task-plan',name:`任务指标 ${batch.taskPlan.id}`,passed:!issues.length,detail:`冻结需求 R${batch.taskPlan.revision}`});
  return {status:rules.every(rule=>rule.passed)?'passed':'failed',sourceRevision:batch.revision,checkedAt:at,rules,issues,taskPlan:batch.taskPlan?clone(batch.taskPlan):null,eligibleIds:approved.map(record=>record.id),count:approved.length,boxCount,normalCount};
}

export function applyImageBatchAction(batch,action={}) {
  if(!batch||!Array.isArray(batch.records))return fail(batch,'没有找到当前图片批次。');
  if(!action||typeof action!=='object')return fail(batch,'图片批次操作参数无效。');
  const at=timestamp(action.at);
  if(action.type==='assign'){
    const ids=action.recordIds===undefined?batch.records.filter(record=>editableStatuses.includes(record.status)&&!record.assignee).map(record=>record.id):action.recordIds;
    const assignee=text(action.assignee);
    if(!assignee)return fail(batch,'请选择标注人。');
    if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)return fail(batch,'请选择本批次中可分配的图片。');
    if(ids.some(id=>!batch.records.some(record=>record.id===id&&editableStatuses.includes(record.status))))return fail(batch,'只能分配本批次待标注或需返工的图片。');
    const changed=batch.records.filter(record=>ids.includes(record.id)&&record.assignee!==assignee);
    if(!changed.length)return ok(batch,{unchanged:true});
    const changedIds=new Set(changed.map(record=>record.id));
    const records=batch.records.map(record=>{
      if(!changedIds.has(record.id))return record;
      const event=historyEntry(record,action,{assignee},at,'分配图片标注');
      return {...record,assignee,assignedAt:at,updatedAt:at,history:[...record.history,event]};
    });
    return ok({...batch,records,revision:batch.revision+1,quality:stale(batch.quality),updatedAt:at});
  }
  if(action.type==='checkQuality'){const quality=inspectQuality(batch,at);return ok({...batch,quality,qualityHistory:[...(batch.qualityHistory||[]),clone(quality)]});}
  if(action.type==='publish'){
    const note=text(action.note);
    if(!note)return fail(batch,'请填写发布说明。');
    if(batch.quality?.status!=='passed'||batch.quality.sourceRevision!==batch.revision)return fail(batch,'当前批次尚未通过质量检查，或检查后发生变化，请重新检查。');
    if(batch.versions.some(version=>version.sourceRevision===batch.revision))return fail(batch,'当前修订已经发布，请在产生新变更后再发布。');
    const check=inspectQuality(batch,at);
    if(check.status!=='passed'||JSON.stringify(check.eligibleIds)!==JSON.stringify(batch.quality.eligibleIds))return fail(batch,'当前审核范围与质量检查不一致，请重新检查。');
    const index=batch.versions.length+1;
    const version={
      ...(batch.taskPlan?{taskPlan:clone(batch.taskPlan)}:{}),...(batch.sourceProjects?{sourceProjects:clone(batch.sourceProjects)}:{}),
      id:`${batch.datasetId}-image-version-${index}`,version:`v0.${index}`,type:'image',
      datasetId:batch.datasetId,datasetName:batch.name,projectId:batch.projectId,projectName:batch.projectName,
      batchId:batch.batchId,taskSpecVersionId:batch.taskSpecVersionId,specSnapshot:clone(batch.specSnapshot),
      qualitySnapshot:clone(check),sourceRevision:batch.revision,records:clone(batch.records.filter(record=>record.status==='approved')),
      count:check.count,boxCount:check.boxCount,normalCount:check.normalCount,date:at,owner:text(action.owner)||'演示管理员',note,
    };
    return ok({...batch,versions:[version,...batch.versions],updatedAt:at},{version});
  }
  const record=batch.records.find(item=>item.id===action.recordId);
  if(!record)return fail(batch,'未找到本批次中的图片，操作未生效。');
  const note=text(action.note);
  if(action.type==='saveDraft'||action.type==='submit'){
    if(!editableStatuses.includes(record.status))return fail(batch,'只有待标注或需返工图片可以修改和提交。');
    if(!text(record.assignee))return fail(batch,'请先分配标注人。');
    const candidate=candidateAnnotation(record,action);
    const issues=[...sourceIssues(candidate),...specIssues(batch.specSnapshot),...annotationIssues(candidate,batch.specSnapshot,{draft:action.type==='saveDraft'})];
    if(issues.length)return fail(batch,issues[0]);
    const patch=annotationPatch(candidate);
    if(action.type==='saveDraft'){
      if(JSON.stringify(record.boxes)===JSON.stringify(patch.boxes)&&record.noDefect===patch.noDefect&&record.note===patch.note)return ok(batch,{record,unchanged:true});
      return updateRecord(batch,record,patch,action,at,'保存图片标注草稿');
    }
    return updateRecord(batch,record,{...patch,status:'review',submittedAt:at,resubmissions:(record.resubmissions||0)+(record.status==='rework'?1:0)},action,at,record.status==='rework'?'返工后重新提交':'提交图片审核');
  }
  if(action.type==='reject'){
    if(record.status!=='review')return fail(batch,'只有待审核图片可以退回。');
    if(!note)return fail(batch,'请填写退回原因。');
    const boxIds=action.boxIds===undefined?[]:action.boxIds;
    if(!Array.isArray(boxIds)||new Set(boxIds).size!==boxIds.length||boxIds.some(id=>!record.boxes.some(box=>box.id===id)))return fail(batch,'退回关联框必须来自当前图片。');
    const rejection={note,boxIds:[...boxIds],boxes:clone(record.boxes.filter(box=>boxIds.includes(box.id))),at};
    return updateRecord(batch,record,{status:'rework',rejection},action,at,'退回图片修改');
  }
  if(action.type==='approve'){
    if(record.status!=='review')return fail(batch,'只有待审核图片可以通过审核。');
    const issues=imageRecordIssues(record,batch.specSnapshot);
    if(issues.length)return fail(batch,issues[0]);
    return updateRecord(batch,record,{status:'approved',reviewNote:note,approvedAt:at},action,at,'通过图片审核');
  }
  if(action.type==='reopen'){
    if(record.status!=='approved')return fail(batch,'只有已通过图片可以重新标注。');
    if(!note)return fail(batch,'请填写重新标注原因；历史发布版本保持不变。');
    return updateRecord(batch,record,{status:'todo',reopenReason:note},action,at,'重新打开图片标注');
  }
  return fail(batch,'不支持的图片批次操作。');
}

function exportSource(batch,version) {
  if(!batch)throw new Error('未找到图片批次。');
  if(!version)return {source:batch,records:batch.records,spec:batch.specSnapshot};
  if((version.datasetId&&version.datasetId!==batch.datasetId)||(version.batchId&&version.batchId!==batch.batchId))throw new Error('所选发布版本不属于当前图片批次。');
  const saved=batch.versions.find(item=>item.id===version.id);
  if(!saved||saved.datasetId!==batch.datasetId||saved.batchId!==batch.batchId)throw new Error('所选发布版本不属于当前图片批次。');
  return {source:saved,records:saved.records,spec:saved.specSnapshot};
}

export function imageExportPayload(batch,version) {
  const {source,records,spec}=exportSource(batch,version);
  return clone({
    schema:'shuzhi.image-dataset',schemaVersion:'1.0',type:'image',demo:true,
    exportType:version?'published-version':'working-batch',
    coordinateSystem:{unit:'pixel',origin:'top-left',bbox:['x','y','width','height'],reference:'original-image'},
    dataset:{id:batch.datasetId,name:source.datasetName||batch.name,projectId:source.projectId,projectName:source.projectName,batchId:source.batchId,taskSpecVersionId:source.taskSpecVersionId},
    version:version?{id:source.id,version:source.version,sourceRevision:source.sourceRevision,date:source.date,owner:source.owner,note:source.note}:null,
    revision:version?source.sourceRevision:batch.revision,specSnapshot:spec,
    count:records.length,boxCount:records.reduce((sum,record)=>sum+record.boxes.length,0),records,
  });
}

export function imageCocoPayload(batch,version) {
  if(!version)throw new Error('请先选择已发布的图片版本。');
  const {source,records,spec}=exportSource(batch,version);
  if(records.some(record=>imageRecordIssues(record,spec).length))throw new Error('发布快照含无效标注，不能导出 COCO。');
  const categories=spec.labels.map((label,index)=>({id:index+1,name:typeof label==='string'?label:label.name,supercategory:'defect'}));
  const categoryIds=new Map(categories.map(category=>[category.name,category.id]));
  let annotationId=0;
  return {
    info:{description:`${source.datasetName} ${source.version} · 本地交互原型导出`,version:source.version,date_created:source.date,source_version_id:source.id,source_batch_id:source.batchId,task_spec_version_id:source.taskSpecVersionId,coordinate_unit:'original-image-pixel',image_bytes_included:false},
    licenses:[],
    images:records.map((record,index)=>({id:index+1,file_name:record.name,width:record.width,height:record.height,source_record_id:record.id,no_defect:record.noDefect})),
    categories,
    annotations:records.flatMap((record,index)=>record.boxes.map(box=>({id:++annotationId,image_id:index+1,category_id:categoryIds.get(box.label),bbox:[box.x,box.y,box.width,box.height],area:box.width*box.height,iscrowd:0,attributes:{severity:box.severity,source_box_id:box.id}}))),
  };
}
