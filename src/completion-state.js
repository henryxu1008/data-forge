// All operations here are deterministic local prototype flows, never remote AI.
const clone=value=>JSON.parse(JSON.stringify(value));
const text=value=>typeof value==='string'?value.trim():'';
const fail=(state,error)=>({ok:false,state,error,events:[]});
const stamp=at=>Number.isFinite(Date.parse(at));
function id(s,p){return `${p}-${++s.sequence}`}
export function createCompletionState(){return {sequence:0,documents:[],qas:[],sourceVersions:[],libraries:[],indexes:[],retrievals:[],agents:[],runs:[],feedback:[],listings:[],grants:[],accesses:[],alerts:[],clockOffset:0};}
export function paragraphBlocks(content,documentId){return content.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean).map((value,i)=>({id:`${documentId}:P${i+1}`,documentId,paragraph:i+1,text:value}));}
export function validCitation(qa,documents){const doc=documents.find(d=>d.id===qa.documentId&&d.status==='parsed');const block=doc?.blocks.find(b=>b.id===qa.blockId);return !!block&&!!text(qa.quote)&&block.text.includes(qa.quote)&&doc.revision===qa.documentRevision;}
export function getIndexEligibility(s,libraryId,indexId){
 const lib=s.libraries.find(x=>x.id===libraryId);if(!lib)return {ok:false,error:'知识库不存在。'};
 const latest=s.indexes.find(x=>x.libraryId===lib.id);
 const index=indexId?s.indexes.find(x=>x.id===indexId&&x.libraryId===lib.id):latest;
 if(!index||index.status!=='ready'||index.configRevision!==lib.revision||index.sourceVersionId!==lib.sourceVersionId||latest?.id!==index.id)return {ok:false,error:'知识库最新索引未成功或配置已变更，请先构建索引。'};
 return {ok:true,index};
}
function tokens(q){
 const str=q.toLowerCase();
 const latin=[...str.matchAll(/[a-z0-9]+/g)].map(x=>x[0]);
 const chinese=[...str.matchAll(/[\u3400-\u9fff]{2,}/g)].flatMap(x=>Array.from({length:x[0].length-1},(_,i)=>x[0].slice(i,i+2)));
 return [...new Set(latin.concat(chinese))];
}
export function searchIndex(index,query,topk=3){const terms=tokens(query);return index.chunks.map(chunk=>({...clone(chunk),score:terms.filter(t=>(chunk.text+' '+(chunk.question||'')).toLowerCase().includes(t)).length})).filter(row=>row.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,topk)}
export function assetCatalog(versions=[],modelState={services:[]},s){return [
 ...versions.filter(v=>v.id&&v.records?.length).map(v=>({id:`data:${v.id}`,kind:'data',name:`${v.datasetName||v.datasetId} · ${v.version}`,versionId:v.id,projectId:v.projectId,snapshot:clone(v),available:true})),
 ...modelState.services.map(v=>({id:`service:${v.id}`,kind:'service',name:v.name,versionId:v.id,projectId:v.modelSnapshot.projectId,snapshot:clone(v),available:v.status==='running'})),
 ...s.libraries.flatMap(lib=>{const access=getIndexEligibility(s,lib.id);return access.ok?[{id:`index:${access.index.id}`,kind:'index',name:`${lib.name} · ${access.index.id}`,versionId:access.index.id,projectId:access.index.sourceSnapshot.projectId,snapshot:clone(access.index),available:true}]:[]})];}
function renderService(service,input){if(service.modelSnapshot.type==='image')return JSON.stringify({demo:true,modelVersionId:service.modelVersionId,detections:service.dataVersion.records[0]?.boxes||[],notice:'冻结图片标注回放，非真实检测预测'});const labels=service.modelSnapshot.labels;const label=service.dataVersion.records.find(r=>input===r.text)?.label||labels.find(l=>input.includes(l))||labels[0];return `模拟分类：${label}（本地样例回放）`;}
function liveFailure(alert,ctx,s){const target=alert.target;if(target.type==='index'){const old=s.indexes.find(x=>x.id===target.id);return !getIndexEligibility(s,old?.libraryId).ok;}if(target.type==='training')return ctx.modelState.trainings.find(x=>x.id===target.id)?.status!=='completed';if(target.type==='deployment')return ctx.modelState.services.find(x=>x.id===target.id)?.status!=='running';if(target.type==='document')return s.documents.find(x=>x.id===target.id)?.status!=='parsed';if(target.type==='evaluation'){const old=ctx.modelState.evaluations.find(x=>x.id===target.id);return ctx.modelState.evaluations.find(x=>x.modelVersionId===old?.modelVersionId)?.status!=='passed'}return true;}
export function applyCompletionAction(state,a,ctx={}){
 if(!a||!stamp(a.at))return fail(state,'操作时间无效。');
 const at=a.at;
 const s=clone(state);let entity,extra={};
 const get=(key,identifier)=>s[key].find(x=>x.id===identifier);
 const no=error=>fail(state,error);
 switch(a.type){
 case 'ingestDocument':{
  if(!text(a.name)||!text(a.content)||a.content.length>500000)return no('请填写文档名称及 1–500000 字符正文。');
  const documentId=id(s,'DOC'),failed=!!a.simulateFailure;
  entity={id:documentId,taskId:id(s,'PARSE'),projectId:a.projectId||'PRJ-002',name:text(a.name),content:a.content,status:failed?'failed':'parsed',revision:1,blocks:failed?[]:paragraphBlocks(a.content,documentId),attempts:[{at,status:failed?'failed':'parsed',reason:failed?'模拟解析异常，需修复原任务':'正文按空行分段'}]};s.documents.unshift(entity);break;
 }
 case 'repairDocument':{
  entity=get('documents',a.documentId);if(!entity||entity.status!=='failed')return no('只有解析异常文档可以修复。');
  if(!text(a.content)||!text(a.note)||a.content.length>500000)return no('请提供修复正文与处理说明。');
  entity.content=a.content;entity.revision++;entity.status=a.simulateFailure?'failed':'parsed';entity.blocks=entity.status==='parsed'?paragraphBlocks(a.content,entity.id):[];entity.attempts.push({at,status:entity.status,note:text(a.note),reason:a.simulateFailure?'模拟修复后解析仍异常':''});break;
 }
 case 'saveQA':{
  const doc=get('documents',a.documentId),block=doc?.blocks.find(b=>b.id===a.blockId);
  if(!doc||doc.status!=='parsed'||!block||!text(a.question)||!text(a.answer)||!text(a.quote)||!block.text.includes(a.quote))return no('问题、答案与有效原文引用为必填项；引用须出现在所选段落。');
  entity=a.qaId?get('qas',a.qaId):null;
  if(a.qaId&&(!entity||!['draft','rework'].includes(entity.status)))return no('当前问答不可编辑，请先重新打开。');
  const patch={question:text(a.question),answer:text(a.answer),quote:a.quote,documentId:doc.id,documentRevision:doc.revision,projectId:doc.projectId,blockId:block.id,status:entity?.status||'draft'};
  if(entity){Object.assign(entity,patch);entity.revision++;entity.history.push({at,action:'修改问答草稿'})}else{entity={id:id(s,'QA'),...patch,revision:1,history:[{at,action:'创建问答草稿'}]};s.qas.unshift(entity)}break;
 }
 case 'submitQA':case 'approveQA':case 'rejectQA':case 'reopenQA':{
  entity=get('qas',a.qaId);if(!entity)return no('问答不存在。');
  const expected={submitQA:['draft','rework'],approveQA:['review'],rejectQA:['review'],reopenQA:['approved']}[a.type];if(!expected.includes(entity.status))return no('问答状态已变化，不能执行此操作。');
  if(['rejectQA','reopenQA'].includes(a.type)&&!text(a.note))return no('请填写处理原因。');
  if(['submitQA','approveQA'].includes(a.type)&&!validCitation(entity,s.documents))return no('原文引用已失效，请修复问答来源。');
  entity.status={submitQA:'review',approveQA:'approved',rejectQA:'rework',reopenQA:'draft'}[a.type];entity.revision++;entity.history.push({at,action:a.type,note:text(a.note)});break;
 }
 case 'publishKnowledge':{
  const approved=s.qas.filter(q=>q.projectId===a.projectId&&q.status==='approved');
  const rows=approved.filter(q=>!approved.some(other=>other.supersedes===q.id));
  if(!rows.length||rows.some(q=>!validCitation(q,s.documents))||!text(a.note))return no('请先完成有效问答审核，并填写发布说明。');
  const signature=JSON.stringify(rows.map(q=>[q.id,q.revision]).sort());
  if(s.sourceVersions.some(v=>v.projectId===a.projectId&&v.signature===signature))return no('该问答修订范围已经发布。');
  entity={id:id(s,'KNOWLEDGE'),projectId:a.projectId,version:`v${s.sourceVersions.filter(v=>v.projectId===a.projectId).length+1}`,name:text(a.name)||'知识问答来源',signature,records:clone(rows),documents:clone(s.documents.filter(d=>rows.some(q=>q.documentId===d.id))),at,note:text(a.note)};s.sourceVersions.unshift(entity);break;
 }
 case 'createLibrary':{
  if(!text(a.name)||s.libraries.some(l=>l.name===text(a.name)))return no('请填写不重复的知识库名称。');
  entity={id:id(s,'KB'),name:text(a.name),projectId:a.projectId||'PRJ-002',sourceVersionId:'',revision:1,config:{chunk:500,overlap:50,topk:3}};s.libraries.unshift(entity);break;
 }
 case 'configureLibrary':{
  entity=get('libraries',a.libraryId);const source=get('sourceVersions',a.sourceVersionId);const c=a.config||{};
  if(!entity||!source)return no('请选择已审核发布的知识来源版本。');
  if(!Number.isInteger(+c.chunk)||+c.chunk<30||+c.chunk>2000||!Number.isInteger(+c.overlap)||+c.overlap<0||+c.overlap>=+c.chunk||!Number.isInteger(+c.topk)||+c.topk<1||+c.topk>20)return no('切分长度 30–2000，重叠应小于切分长度，Top K 为 1–20。');
  if(entity.projectId&&entity.projectId!==source.projectId)return no('知识来源必须与知识库处于同一授权项目。');
  entity.sourceVersionId=source.id;entity.config={chunk:+c.chunk,overlap:+c.overlap,topk:+c.topk};entity.revision++;break;
 }
 case 'startIndex':{
  const lib=get('libraries',a.libraryId),source=get('sourceVersions',lib?.sourceVersionId);
  if(!lib||!source)return no('请先选择并保存知识来源配置。');
  if(s.indexes.some(x=>x.libraryId===lib.id&&['queued','running'].includes(x.status)))return no('该知识库已有索引任务运行或等待。');
  entity={id:id(s,'INDEX'),libraryId:lib.id,sourceVersionId:source.id,sourceSnapshot:clone(source),configRevision:lib.revision,config:clone(lib.config),scenario:a.scenario==='fail'?'fail':'success',status:'queued',progress:0,chunks:[],at,retryOf:a.retryOf||null};s.indexes.unshift(entity);break;
 }
 case 'tick':{
  let slots=Math.max(0,(ctx.concurrency??100)-s.indexes.filter(x=>x.status==='running').length-(ctx.externalRunning||0));
  for(const index of [...s.indexes].reverse()){
   if(index.status==='queued'&&slots>0){index.status='running';slots--}
   if(index.status!=='running')continue;
   index.progress=Math.min(100,index.progress+25);if(index.progress<100)continue;
   index.finishedAt=at;
   if(index.scenario==='fail'){index.status='failed';index.error='模拟索引构建异常，来源快照已保留，可重新构建。';continue}
   index.status='ready';
   for(const qa of index.sourceSnapshot.records){const value=qa.answer;for(let pos=0;pos<value.length;pos+=index.config.chunk-index.config.overlap){index.chunks.push({id:`${index.id}:${qa.id}:${pos}`,text:value.slice(pos,pos+index.config.chunk),question:qa.question,qaId:qa.id,documentId:qa.documentId,blockId:qa.blockId,quote:qa.quote,sourceVersionId:index.sourceVersionId});if(pos+index.config.chunk>=value.length)break}}
  }
  break;
 }
 case 'retrieve':{
  const lib=get('libraries',a.libraryId),access=getIndexEligibility(s,a.libraryId,a.indexId);
  if(!access.ok)return no(access.error);if(!text(a.query))return no('请输入检索问题。');
  entity={id:id(s,'SEARCH'),libraryId:lib.id,indexId:access.index.id,sourceVersionId:access.index.sourceVersionId,query:text(a.query),results:searchIndex(access.index,a.query,lib.config.topk),at};s.retrievals.unshift(entity);break;
 }
 case 'createAgent':{
  if(!text(a.name))return no('请填写智能体名称。');
  const agentId=id(s,'AGENT');entity={id:agentId,name:text(a.name),projectId:a.projectId||'PRJ-002',flowId:id(s,'FLOW'),revision:1,nodes:[{id:`${agentId}:in`,type:'input',name:'用户输入',config:{}},{id:`${agentId}:search`,type:'retrieval',name:'知识检索',config:{libraryId:'',indexId:''}},{id:`${agentId}:model`,type:'model',name:'模型处理',config:{serviceId:'',prompt:'依据引用回答，无法确认时说明未知。'}},{id:`${agentId}:out`,type:'output',name:'结果输出',config:{}}]};s.agents.unshift(entity);break;
 }
 case 'saveAgent':{
  entity=get('agents',a.agentId);if(!entity||!text(a.name)||!Array.isArray(a.nodes)||a.nodes.length<3||a.nodes.length>12||new Set(a.nodes.map(n=>n.id)).size!==a.nodes.length)return no('流程须有 3–12 个唯一节点。');
  if(a.nodes[0].type!=='input'||a.nodes.at(-1).type!=='output'||a.nodes.slice(1,-1).some(n=>!['retrieval','model'].includes(n.type)))return no('流程以输入开始、输出结束，中间为检索或模型节点。');
  entity.name=text(a.name);entity.nodes=clone(a.nodes);entity.revision++;break;
 }
 case 'runAgent':{
  const agent=get('agents',a.agentId);if(!agent||!text(a.input))return no('请选择智能体并填写输入。');
  const deps=[],steps=[];let value=text(a.input),citations=[],rejection='';
  for(const node of agent.nodes){
   if(node.type==='retrieval'){
    const access=getIndexEligibility(s,node.config.libraryId,node.config.indexId);
    if(!access.ok){rejection=access.error;break}
    const results=searchIndex(access.index,a.input,access.index.config.topk);citations.push(...results);value=results.length?results.map(x=>x.text).join('\n'):'知识来源中没有匹配内容。';deps.push({nodeId:node.id,index:clone(access.index)});
   }else if(node.type==='model'){
    const service=ctx.modelState?.services.find(x=>x.id===node.config.serviceId);
    if(!service||service.status!=='running'){rejection='流程所用模型服务未运行或已下线。';break}
    if(!text(node.config.prompt)){rejection='模型节点缺少提示词。';break}
    deps.push({nodeId:node.id,service:clone(service)});value=citations.length?`${citations.map(x=>x.text).join('\n')}\n[引用 ${citations.map(x=>x.blockId).join('、')}]`:renderService(service,a.input);
   }
   steps.push({nodeId:node.id,type:node.type,input:node.type==='input'?a.input:steps.at(-1)?.output||a.input,output:value});
  }
  entity={id:id(s,'RUN'),agentId:agent.id,flowId:agent.flowId,agentRevision:agent.revision,configSnapshot:clone(agent),input:text(a.input),output:rejection?'':value,citations:clone(citations),dependencies:deps,steps,status:rejection?'rejected':'succeeded',reason:rejection,at};s.runs.unshift(entity);extra.error=rejection||undefined;break;
 }
 case 'createFeedback':{
  const run=s.runs.find(x=>x.id===a.runId&&x.status==='succeeded'),call=ctx.modelState?.calls.find(x=>x.id===a.callId&&x.status==='succeeded');
  if(!run&&!call)return no('反馈须关联一次成功的真实原型运行或调用记录。');
  if(!text(a.expected)||!text(a.note))return no('请填写问题说明和正确结果。');
  if(s.feedback.some(f=>f.originId===(run?.id||call.id)&&f.status!=='closed'))return no('该运行已有待处理反馈，请继续原反馈。');
  entity={id:id(s,'FEEDBACK'),originId:run?.id||call.id,originType:run?'agent':'service',sourceType:call?ctx.modelState.services.find(x=>x.id===call.serviceId)?.modelSnapshot.type||'text':'knowledge',originSnapshot:clone(run||call),input:run?.input||call.input,previousOutput:run?.output||call.output,expected:text(a.expected),note:text(a.note),status:'open',at,history:[{at,action:'提交反馈'}]};s.feedback.unshift(entity);break;
 }
 case 'linkFeedbackBatch':{
  entity=get('feedback',a.feedbackId);const batch=ctx.textBatches?.[a.datasetId]||ctx.imageBatches?.[a.datasetId];if(!entity||entity.status!=='open'||!batch||!(batch.rawRecords||batch.records).some(r=>r.feedbackId===entity.id))return no('改进批次与反馈来源不一致。');
  entity.datasetId=a.datasetId;entity.status='improving';entity.history.push({at,action:batch.type==='image'?'进入图片改进批次':'进入文本改进批次',datasetId:a.datasetId});break;
 }
 case 'linkFeedbackQA':{
  entity=get('feedback',a.feedbackId);const qa=get('qas',a.qaId);if(!entity||entity.status!=='open'||!qa||qa.feedbackId!==entity.id)return no('改进问答与反馈不匹配。');entity.qaId=qa.id;entity.status='improving';entity.history.push({at,action:'进入知识改进问答',qaId:qa.id});break;
 }
 case 'createFeedbackQA':{
  const f=get('feedback',a.feedbackId);const citation=f?.originSnapshot.citations?.[0];const original=citation&&get('qas',citation.qaId);const doc=original&&get('documents',original.documentId);
  if(!f||f.status!=='open'||!original||!doc||!validCitation(original,s.documents))return no('该反馈没有可用知识引用，请先修复来源或使用文本改进批次。');
  entity={...clone(original),id:id(s,'QA'),question:f.input,answer:f.expected,status:'draft',revision:1,feedbackId:f.id,supersedes:original.id,history:[{at,action:'从运行反馈建立改进问答',feedbackId:f.id}]};s.qas.unshift(entity);f.qaId=entity.id;f.status='improving';f.history.push({at,action:'进入知识改进问答',qaId:entity.id});break;
 }
 case 'verifyFeedback':{
  entity=get('feedback',a.feedbackId);if(!entity||entity.status!=='improving')return no('请先完成反馈改进。');
  let evidence;
  if(entity.qaId){const run=s.runs.find(r=>r.id===a.runId&&r.status==='succeeded'&&r.input===entity.input);const qa=get('qas',entity.qaId);evidence=run&&qa?.status==='approved'&&run.dependencies.some(d=>d.index?.sourceSnapshot.records.some(r=>r.id===qa.id&&r.revision===qa.revision))&&run.output.includes(entity.expected)?run:null}
  else{const call=ctx.modelState?.calls.find(c=>c.id===a.callId&&c.status==='succeeded'&&c.input===entity.input);const service=ctx.modelState?.services.find(x=>x.id===call?.serviceId);evidence=call&&service?.dataVersion.datasetId===entity.datasetId&&service.dataVersion.records.some(r=>r.feedbackId===entity.id&&(service.dataVersion.type==='image'?(entity.expected==='无缺陷'?r.noDefect:r.boxes.some(b=>b.label===entity.expected)):r.label===entity.expected))&&(service.dataVersion.type==='image'?(entity.expected==='无缺陷'?JSON.parse(call.output).noDefect:JSON.parse(call.output).detections.some(b=>b.label===entity.expected)):call.output.includes(entity.expected))?call:null;}
  if(!evidence)return no('复测必须使用包含该反馈修订的新知识索引或新模型，且相同输入的结果应包含正确结果。');
  entity.status='closed';entity.validationSnapshot=clone(evidence);entity.history.push({at,action:'新版本原错误用例复测通过',evidenceId:evidence.id});break;
 }
 case 'listAsset':{
  const asset=assetCatalog(ctx.versions,ctx.modelState,s).find(x=>x.id===a.assetId&&x.available);
  if(!asset||!text(a.note))return no('请选择可用的明确版本并填写上架说明。');
  if(s.listings.some(x=>x.assetId===asset.id&&x.status==='listed'))return no('该版本已经上架。');
  entity={id:id(s,'LISTING'),assetId:asset.id,assetSnapshot:asset,status:'listed',note:text(a.note),at};s.listings.unshift(entity);break;
 }
 case 'delistAsset':{
  entity=get('listings',a.listingId);if(!entity||entity.status!=='listed'||!text(a.note))return no('请填写有效上架项和下架原因。');entity.status='delisted';entity.delistedAt=at;entity.delistReason=text(a.note);break;
 }
 case 'grantAsset':{
  const listing=get('listings',a.listingId),asset=assetCatalog(ctx.versions,ctx.modelState,s).find(x=>x.id===listing?.assetId&&x.available);
  if(!listing||listing.status!=='listed'||!asset||!ctx.apps?.some(x=>x.id===a.appId&&x.spaceId===ctx.spaceId))return no('请选择当前空间应用和已上架可用资产。');
  if(!stamp(a.expiresAt)||Date.parse(a.expiresAt)<=Date.parse(at)||!Number.isInteger(+a.rate)||+a.rate<1||+a.rate>1000)return no('有效期必须晚于当前时间，每分钟调用数为 1–1000。');
  entity={id:id(s,'GRANT'),listingId:listing.id,assetId:asset.id,appId:a.appId,expiresAt:a.expiresAt,rate:+a.rate,status:'active',at};s.grants.unshift(entity);break;
 }
 case 'revokeGrant':{
  entity=get('grants',a.grantId);if(!entity||entity.status!=='active'||!text(a.note))return no('请选择有效授权并填写撤权原因。');entity.status='revoked';entity.reason=text(a.note);entity.revokedAt=at;break;
 }
 case 'accessAsset':{
  const grant=get('grants',a.grantId),listing=get('listings',grant?.listingId),asset=assetCatalog(ctx.versions,ctx.modelState,s).find(x=>x.id===grant?.assetId);
  const app=ctx.apps?.find(x=>x.id===grant?.appId&&x.spaceId===ctx.spaceId);
  const recent=s.accesses.filter(x=>x.grantId===grant?.id&&x.status==='succeeded'&&Date.parse(x.at)>Date.parse(at)-60000&&Date.parse(x.at)<=Date.parse(at)).length;
  let reason=!grant?'授权不存在':!app||app.status==='disabled'?'应用不可用':grant.status!=='active'?'授权已撤销':Date.parse(grant.expiresAt)<=Date.parse(at)?'授权已到期':listing?.status!=='listed'?'资产已下架，现有授权停止新访问':!asset?.available?'来源版本不可用或模型服务已下线':recent>=grant.rate?'超过每分钟调用频率上限':'';
  if(!reason&&asset.kind==='service'&&!text(a.input))reason='服务调用需要输入内容。';
  entity={id:id(s,'ACCESS'),grantId:a.grantId,assetId:grant?.assetId,appId:grant?.appId,status:reason?'rejected':'succeeded',reason,at,sourceSnapshot:asset?clone(asset.snapshot):null,input:text(a.input),output:reason?'':asset.kind==='service'?renderService(asset.snapshot,a.input):asset.kind==='index'?searchIndex(asset.snapshot,a.input||'知识',3):`已授权下载 ${asset.snapshot.records.length} 条冻结记录`};s.accesses.unshift(entity);break;
 }
 case 'recordAlert':{
  if(!a.target?.id||!text(a.reason))return no('告警必须有业务来源和原因。');
  const existing=s.alerts.find(x=>x.target.type===a.target.type&&x.target.id===a.target.id&&x.status!=='closed');if(existing){existing.lastAt=at;existing.occurrences++;entity=existing;break}
  entity={id:id(s,'ALERT'),target:clone(a.target),reason:text(a.reason),status:'open',occurrences:1,at,history:[{at,action:'业务异常触发'}]};s.alerts.unshift(entity);break;
 }
 case 'ackAlert':case 'closeAlert':{
  entity=get('alerts',a.alertId);if(!entity||entity.status==='closed'||!text(a.note))return no('请填写告警处理说明。');
  if(a.type==='closeAlert'&&(entity.status!=='handling'||liveFailure(entity,ctx,s)))return no('请先确认处理，且原业务已恢复成功后才能关闭告警。');
  entity.status=a.type==='ackAlert'?'handling':'closed';if(entity.status==='closed'){const t=entity.target;entity.recoverySnapshot=clone(t.type==='index'?s.indexes.find(x=>x.libraryId===s.indexes.find(y=>y.id===t.id)?.libraryId):t.type==='document'?s.documents.find(x=>x.id===t.id):t.type==='training'?ctx.modelState.trainings.find(x=>x.id===t.id):t.type==='deployment'?ctx.modelState.services.find(x=>x.id===t.id):ctx.modelState.evaluations.find(x=>x.modelVersionId===ctx.modelState.evaluations.find(y=>y.id===t.id)?.modelVersionId));}entity.history.push({at,action:entity.status,note:text(a.note)});break;
 }
 case 'setClock':if(!Number.isInteger(a.offset)||a.offset<0||a.offset>7*86400000)return no('模拟时间范围为当前时间至七天后。');s.clockOffset=a.offset;break;
 default:return no('不支持的业务操作。');
 }
 if(a.type==='tick'&&JSON.stringify(s)===JSON.stringify(state))return {ok:true,state,events:[]};
 const ok=!extra.error;
 return {ok,state:s,entity,...extra,events:a.type==='tick'?[]:[{action:a.type,object:entity?.name||entity?.id||a.type,result:ok?'成功':'拒绝',at,before:{},after:{编号:entity?.id,状态:entity?.status},details:extra.error||'浏览器本地业务流转'}]};
}
