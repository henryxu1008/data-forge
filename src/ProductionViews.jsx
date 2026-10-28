import {uniqueId} from './unique-id.js';
import React, { useEffect, useRef, useState } from 'react';
import { IconArrowRight, IconPlus, IconChevronRight, IconCircleCheck, IconClock, IconAlertTriangle, IconFileText, IconPhoto, IconDatabase, IconUpload, IconFolder, IconEdit, IconX, IconCheck, IconPlayerPlay, IconRefresh, IconTag, IconListDetails, IconAdjustments, IconShieldCheck, IconArrowUpRight, IconBook2, IconCopy, IconDownload } from '@tabler/icons-react';
import { Button, Badge, PageHeader, Panel, Tabs, Field, Modal, Search, Empty, StepBar, downloadText } from './ui';
import { createDemoTextRecords, cleanTextBatch, textBatchCounts } from './text-production-state.js';
import { imageBatchCounts, defaultImageSpec } from './image-production-state.js';
import { ImageIngestionView } from './ImageProductionPanels.jsx';
import './production-views.css';
import {parseTextFile,mapTextRows} from './text-import.js';

const initialProjects = [
  { id:'PRJ-001', name:'客户反馈意图分类', detail:'客服与售后 · 文本分类', scene:'智能客服', type:'text', count:'1,160 条文本', phase:'标注审核', tone:'mint', progress:83, issue:'60 条待审核', action:'进入审核', target:'review', owner:'陈雨', date:'2026-10-27' },
  { id:'PRJ-002', name:'企业知识问答语料', detail:'内部知识库 · 问答生成', scene:'企业知识', type:'text', count:'326 份文档', phase:'数据清洗', tone:'blue', progress:42, issue:'12 份解析异常', action:'查看异常', target:'processing', owner:'林悦', date:'2026-10-27' },
  { id:'PRJ-003', name:'工业缺陷图片集', detail:'生产质检 · 图像检测', scene:'工业质检', type:'image', count:'3 张示意图片', phase:'图片标注', tone:'blue', progress:0, issue:'3 张待标注', action:'进入标注', target:'review', datasetId:'defects', owner:'王川', date:'2026-10-26' },
];
const starterTemplates = [
  {id:'intent',name:'文本意图分类',type:'text',icon:IconFileText,description:'将客户反馈归入统一的四类意图，采用单选标签与人工审核。',input:'客户反馈文本、来源渠道、提交时间',output:'意图标签、审核结果',guide:'阅读完整反馈，根据主要诉求选择物流、售后、商品或咨询中的一个标签。商品参数、功能和使用方法归入商品；退换货、维修、退款及质量问题归入售后；无法判断时填写原因后退回修改。',review:'每条数据由 1 位标注员处理，100% 进入人工审核。',labels:'客户反馈意图'},
  {id:'detection',name:'图像目标检测',type:'image',icon:IconPhoto,description:'圈定图像中的目标位置，记录类别与缺陷属性。',input:defaultImageSpec.input,output:defaultImageSpec.output,guide:defaultImageSpec.guide,review:defaultImageSpec.review,labels:'工业缺陷类型'},
  {id:'qa',name:'知识问答构建',type:'text',icon:IconBook2,description:'从可信文档整理可追溯的问答对，用于知识应用。',input:'知识文档、章节标题、来源地址',output:'问题、标准答案、来源引用',guide:'答案必须由原始文档支持，保留完整的来源定位。每个问题只表达一个明确意图，避免主观推断。',review:'每组问答由 1 位编辑整理，1 位领域人员审核。',labels:'知识问答分类'},
];
const startTaxonomies = [
  {id:'feedback',name:'客户反馈意图',description:'面向客服反馈的四类单选意图标签，供文本分类任务使用。',used:3,tags:[{name:'物流',description:'配送进度、签收状态与快递异常',color:'#77a9ed'},{name:'售后',description:'退换货、维修、退款及质量问题',color:'#42d8c1'},{name:'商品',description:'商品参数、功能和使用方法',color:'#c4a0ee'},{name:'咨询',description:'库存、购买条件及其他服务咨询',color:'#f2b84c'}]},
  {id:'defects',name:'工业缺陷类型',description:'用于工业图像中的缺陷定位与分级。',used:1,tags:[{name:'划痕',description:'表面线状损伤',color:'#f2b84c'},{name:'凹陷',description:'表面局部变形',color:'#77a9ed'},{name:'裂纹',description:'连续或断续裂缝',color:'#f18b94'}]},
  {id:'knowledge',name:'知识问答分类',description:'按知识用途组织企业文档与问答对。',used:2,tags:[{name:'产品知识',description:'功能、规格与使用方法',color:'#42d8c1'},{name:'业务流程',description:'业务步骤与操作要求',color:'#77a9ed'},{name:'制度规范',description:'内部制度与规范说明',color:'#c4a0ee'}]},
];
const demoRows = [
  {id:'FB-001',text:'商品收到后发现有划痕，可以申请换货吗？',channel:'售后工单',label:'售后'},
  {id:'FB-002',text:'订单已经发货三天了，想了解一下配送进度。',channel:'在线客服',label:'物流'},
  {id:'FB-003',text:'请问这款设备是否支持蓝牙连接？',channel:'产品咨询',label:'商品'},
];
const palette = ['#42d8c1','#77a9ed','#c4a0ee','#f2b84c','#f18b94','#8fbd83'];
const rulesList = [
  {key:'trim',name:'文本标准化',detail:'清理首尾空格、连续空行与全角空格',count:'86 条格式调整',icon:IconAdjustments},
  {key:'dedupe',name:'重复数据去重',detail:'对标准化后的文本进行精确匹配',count:'28 条重复记录',icon:IconCopy},
  {key:'empty',name:'空内容过滤',detail:'移除无文本或仅包含空白字符的记录',count:'12 条空记录',icon:IconFileText},
  {key:'pii',name:'敏感信息脱敏',detail:'识别并遮盖手机号与电子邮箱',count:'18 条敏感信息',icon:IconShieldCheck},
];
const initialCleaning = () => ({rules:{trim:true,dedupe:true,empty:true,pii:true},status:'idle',progress:0,reported:false});

const clone = value => JSON.parse(JSON.stringify(value));
function snapshotSpec(template, taxonomy) {
  const version=template.revision||1, taxonomyVersion=taxonomy.revision||1;
  return {type:template.type,versionId:`${template.id}:v${version}:${taxonomy.id}:v${taxonomyVersion}`,name:template.name,version:`v${version}`,guide:template.guide,review:template.review,input:template.input,output:template.output,taxonomyId:taxonomy.id,taxonomyVersionId:`${taxonomy.id}:v${taxonomyVersion}`,labels:taxonomy.tags.map(tag=>({...tag}))};
}
export const startingProjects = () => initialProjects.map(project=>{
  const template=starterTemplates.find(item=>item.id===(project.id==='PRJ-003'?'detection':project.id==='PRJ-002'?'qa':'intent'));
  const taxonomy=startTaxonomies.find(item=>item.name===template.labels);
  return {...project,specSnapshot:snapshotSpec(template,taxonomy)};
});

export function productionSeed(empty=false){return {projects:empty?[]:startingProjects(),templates:JSON.parse(JSON.stringify(starterTemplates)),taxonomies:JSON.parse(JSON.stringify(startTaxonomies))};}

export default function ProductionViews({productionState,onProductionChange,onPlanTask,onCanEdit,view,active=true,onNavigate,onToast,onCreateDataset,onCreateImageDataset,onDatasetProcessed,processingDatasetId,textBatches={},imageBatches={},knowledgeState,ingestionRequest,counts={todo:120,review:60,rework:20,approved:960},datasetCount=3}) {
  const [projects,setProjects] = useState(()=>productionState?.projects||startingProjects());
  useEffect(()=>{if(productionState?.projects)setProjects(old=>JSON.stringify(old)===JSON.stringify(productionState.projects)?old:productionState.projects)},[productionState?.projects]);
  const [projectQuery,setProjectQuery] = useState('');
  const [projectFilter,setProjectFilter] = useState('all');
  const [modal,setModal] = useState(null);
  const [projectForm,setProjectForm] = useState({name:'',scene:'智能客服',type:'text',templateId:'intent',labels:'客户反馈意图',goal:''});
  const [templates,setTemplates] = useState(()=>(productionState?.templates||starterTemplates).map(t=>({...t,icon:starterTemplates.find(x=>x.id===t.id)?.icon||IconFileText})));
  const [templateId,setTemplateId] = useState('intent');
  const [spec,setSpec] = useState({...starterTemplates[0]});
  const [specSaved,setSpecSaved] = useState(false);
  const [taxonomies,setTaxonomies] = useState(()=>productionState?.taxonomies||startTaxonomies);
  useEffect(()=>{onProductionChange?.({projects,templates:templates.map(({icon,...t})=>t),taxonomies})},[projects,templates,taxonomies]);
  const [taxonomyId,setTaxonomyId] = useState('feedback');
  const [tagForm,setTagForm] = useState({name:'',description:'',color:palette[0]});
  const [taxonomyName,setTaxonomyName] = useState('');
  const [formError,setFormError] = useState('');
  const [ingestStep,setIngestStep] = useState(0);
  const [ingestKind,setIngestKind] = useState('text');
  const [source,setSource] = useState(null);
  const [parsedFile,setParsedFile]=useState(null),[fieldMap,setFieldMap]=useState({}),[skipErrors,setSkipErrors]=useState(false),[readingFile,setReadingFile]=useState(false);
  const mappedFile=parsedFile?mapTextRows(parsedFile,fieldMap,'LOCAL'):null;
  useEffect(()=>{if(!parsedFile)return;const mapped=mapTextRows(parsedFile,fieldMap,'LOCAL');setSource(current=>current?.kind==='local'?{...current,records:mapped.records}:current)},[parsedFile,fieldMap]);
  const [datasetName,setDatasetName] = useState('客户反馈 · 新增样本');
  const [ingestProject,setIngestProject] = useState('客户反馈意图分类');
  const [ingestProjectId,setIngestProjectId] = useState('PRJ-001');
  const [ingestError,setIngestError] = useState('');
  const [ingestComplete,setIngestComplete] = useState(false);
  const [createdName,setCreatedName] = useState('');
  const [importedDatasetId,setImportedDatasetId] = useState(null);
  const importedDatasets=Object.values(textBatches).map(batch=>({...batch,id:batch.datasetId||batch.id}));
  const importedImages=Object.values(imageBatches);
  const imageProcessingBatch=imageBatches[processingDatasetId];
  const fileInput = useRef(null);
  const [cleaningStates,setCleaningStates] = useState({customer:initialCleaning()});
  const [inspectTab,setInspectTab] = useState('sample');
  const [sampleIndex,setSampleIndex] = useState(0);
  const [focusDataset,setFocusDataset] = useState('customer');
  const activeImported=importedDatasets.find(d=>d.id===focusDataset);
  const activeCleaningKey=focusDataset==='knowledge'?'customer':focusDataset;
  const activeCleaning=cleaningStates[activeCleaningKey]||(activeImported?.stage==='cleaned'?{...initialCleaning(),rules:activeImported.cleaningReport.rules,status:'done',progress:100,reported:true}:initialCleaning());
  const rules=activeCleaning.rules,jobStatus=activeCleaning.status,jobProgress=activeCleaning.progress;
  const cleaningLocked=!!activeImported&&(activeImported.workflowStarted||activeImported.versions?.length>0);
  const cleaningPreview=activeImported?cleanTextBatch(activeImported,{rules,at:'规则预览'}):null;
  const previewReport=cleaningPreview?.cleaningReport;
  const inputCount=activeImported?activeImported.rawRecords.length:1200;
  const ruleHits=activeImported?(previewReport?.hits||{trim:0,dedupe:0,empty:0,pii:0}):{trim:86,dedupe:28,empty:12,pii:18};
  const outputCount=activeImported?(previewReport?.output??inputCount):inputCount-(rules.dedupe?ruleHits.dedupe:0)-(rules.empty?ruleHits.empty:0);
  const cleaningName=activeImported?.name||'客户反馈原始集';
  const hasRunningJob=Object.values(cleaningStates).some(j=>j.status==='running');
  const setRules=next=>setCleaningStates(s=>({...s,[activeCleaningKey]:{...(s[activeCleaningKey]||initialCleaning()),rules:next}}));
  const setJobStatus=status=>setCleaningStates(s=>({...s,[activeCleaningKey]:{...(s[activeCleaningKey]||initialCleaning()),status,...(status==='running'?{reported:false,error:''}:{})}}));
  const setJobProgress=progress=>setCleaningStates(s=>({...s,[activeCleaningKey]:{...(s[activeCleaningKey]||initialCleaning()),progress}}));
  const openCleaning=id=>{setFocusDataset(id);setSampleIndex(0);onNavigate('processing',{datasetId:id});};
  useEffect(()=>{
    if(!ingestionRequest)return;
    const requested=projects.find(item=>item.id===ingestionRequest.projectId);
    const kind=requested?.type||(['text','image'].includes(ingestionRequest.dataType)?ingestionRequest.dataType:ingestKind);
    const project=requested||projects.find(item=>item.id===ingestProjectId&&item.type===kind)||projects.find(item=>item.type===kind);
    setIngestKind(kind);
    if(project){setIngestProjectId(project.id);setIngestProject(project.name);}
  },[ingestionRequest]);

  useEffect(()=>{
    if(!hasRunningJob) return;
    const timer=setInterval(()=>setCleaningStates(all=>Object.fromEntries(Object.entries(all).map(([id,job])=>{
      if(job.status!=='running')return [id,job];
      const progress=Math.min(100,job.progress+10);
      return [id,{...job,progress,status:progress===100?'done':'running'}];
    }))),260);
    return ()=>clearInterval(timer);
  },[hasRunningJob]);
  useEffect(()=>{
    const finished=Object.entries(cleaningStates).filter(([,job])=>job.status==='done'&&!job.reported);
    if(!finished.length)return;
    const errors={};
    finished.forEach(([id,job])=>{
      const imported=importedDatasets.find(d=>d.id===id);
      if(!imported)return;
      const result=onDatasetProcessed?.({id,rules:job.rules});
      if(!result?.ok){errors[id]=result?.error||'本次清洗结果未能保存，请重试。';onToast?.(errors[id]);}
    });
    setCleaningStates(all=>Object.fromEntries(Object.entries(all).map(([id,job])=>[id,finished.some(([doneId])=>doneId===id)?{...job,reported:true,...(errors[id]?{status:'blocked',error:errors[id]}:{error:''})}:job])));
  },[cleaningStates,textBatches,onDatasetProcessed]);
  useEffect(()=>{
    if(view!=='processing'||!processingDatasetId)return;
    if(['customer','knowledge'].includes(processingDatasetId)||importedDatasets.some(d=>d.id===processingDatasetId))setFocusDataset(processingDatasetId);
  },[view,processingDatasetId,textBatches]);

  const taxonomy = taxonomies.find(t=>t.id===taxonomyId) || taxonomies[0];
  const linkedProjects=projects.map(project=>{
    if(project.specSnapshot?.name==='知识问答构建'&&knowledgeState){const docs=knowledgeState.documents.filter(d=>d.projectId===project.id),bad=docs.filter(d=>d.status==='failed').length,qa=knowledgeState.qas.filter(q=>q.projectId===project.id&&q.status!=='approved').length,published=knowledgeState.sourceVersions.filter(v=>v.projectId===project.id).length;return {...project,count:`${docs.length} 份实际文档`,phase:bad?'解析异常':qa?'问答生产':published?'知识已发布':'待接入',tone:bad?'amber':'mint',progress:published?100:docs.length?50:0,issue:bad?`${bad} 份需修复`:qa?`${qa} 组待整理审核`:published?`${published} 个来源版本`:'接入知识正文',action:'进入知识生产',target:'knowledge'}}
    if(project.type==='image'){
      const batches=importedImages.filter(batch=>batch.projectId===project.id);
      if(!batches.length)return {...project,phase:'待接入',tone:'neutral',progress:0,issue:'等待接入图片',action:'接入图片',target:'ingestion'};
      const batch=batches.at(-1),count=imageBatchCounts(batch),currentPublished=batch.versions.some(version=>version.sourceRevision===batch.revision);
      const next=count.rework?{phase:'图片返工',tone:'amber',progress:60,issue:`${count.rework} 张待修改`,action:'处理返工',target:'review'}:count.review?{phase:'图片审核',tone:'amber',progress:65,issue:`${count.review} 张待复核`,action:'进入审核',target:'review'}:count.todo?{phase:'图片标注',tone:'blue',progress:25,issue:`${count.todo} 张待标注`,action:'进入标注',target:'review'}:currentPublished?{phase:'已交付版本',tone:'mint',progress:100,issue:'当前审核范围已发布',action:'查看版本',target:'datasets',tab:'versions'}:{phase:'待质检发布',tone:'mint',progress:85,issue:`${count.approved} 张审核通过`,action:'质量检查',target:'quality'};
      return {...project,...next,datasetId:batch.datasetId,batchCount:batches.length,count:`${batches.length} 个批次 · 最近 ${count.total} 张图片`};
    }
    const batches=importedDatasets.filter(batch=>batch.projectId===project.id);
    if(!batches.length)return project;
    const batch=batches.at(-1), count=textBatchCounts(batch), published=batch.versions?.length>0;
    const currentPublished=batch.versions?.some(version=>version.sourceRevision===batch.revision);
    const next=batch.stage!=='cleaned'?{phase:'待清洗',tone:'blue',progress:20,issue:'等待运行清洗',action:'清洗数据',target:'processing'}:count.rework?{phase:'返工处理中',tone:'amber',progress:65,issue:`${count.rework} 条待修改`,action:'处理返工',target:'review'}:count.review?{phase:'等待审核',tone:'amber',progress:60,issue:`${count.review} 条待审核`,action:'进入审核',target:'review'}:count.todo?{phase:'标注作业',tone:'blue',progress:40,issue:`${count.todo} 条待标注`,action:'进入标注',target:'review'}:currentPublished?{phase:'已交付版本',tone:'mint',progress:100,issue:'当前审核范围已发布',action:'查看版本',target:'datasets',tab:'versions'}:{phase:'待质检发布',tone:'mint',progress:85,issue:`${count.approved} 条审核通过`,action:'质量检查',target:'quality'};
    return {...project,...next,issue:next.issue+(published?` · 历史发布 ${batch.versions.length} 次`:''),datasetId:batch.id,batchCount:batches.length,count:`${batches.length} 个批次 · 最近 ${batch.stage==='cleaned'?batch.records.length:batch.rawRecords.length} 条文本`};
  });
  const filteredProjects = linkedProjects.filter(p=>(p.name+p.detail).includes(projectQuery) && (projectFilter==='all'||(projectFilter==='attention'&&p.progress<100)||(projectFilter==='mine'&&p.owner==='陈雨')));
  const openProject = () => {if(onPlanTask){onPlanTask({});return;} setProjectForm({name:'',scene:'智能客服',type:'text',templateId:'intent',labels:'客户反馈意图',goal:''});setFormError('');setModal({type:'project'}); };
  const openProjectIngestion=p=>{if(p.specSnapshot?.name==='知识问答构建'){onNavigate('knowledge',{projectId:p.id});return;}setIngestProject(p.name);setIngestProjectId(p.id);setIngestKind(p.type==='image'?'image':'text');setDatasetName(`${p.name} · 原始集`);setIngestStep(0);setSource(null);setIngestComplete(false);onNavigate('ingestion',{dataType:p.type==='image'?'image':'text',projectId:p.id});};
  const createProject = (next) => {
    if(onCanEdit&&!onCanEdit())return;
    if(!projectForm.name.trim()){setFormError('请输入任务名称。');return;}
    const template=templates.find(item=>item.id===projectForm.templateId)||templates.find(item=>item.type===projectForm.type);
    const selectedTaxonomy=taxonomies.find(item=>item.name===projectForm.labels);
    if(!selectedTaxonomy?.tags.length){setFormError('请选择至少包含一个标签的体系，再创建任务。');return;}
    const p = {id:`PRJ-${uniqueId()}`,name:projectForm.name.trim(),detail:`${projectForm.scene} · ${projectForm.type==='image'?'图像检测':'文本分类'}`,scene:projectForm.scene,type:projectForm.type,count:'暂无数据',phase:'待接入',tone:'neutral',progress:0,issue:projectForm.type==='image'?'等待接入图片':'等待接入数据',action:'接入数据',target:'ingestion',owner:'陈雨',date:'2026-10-27',goal:projectForm.goal,labels:projectForm.labels,specSnapshot:snapshotSpec(template,selectedTaxonomy),isLocal:true};
    setProjects(ps=>[p,...ps]);setModal(null);onToast?.(`已创建任务「${p.name}」`);if(next)openProjectIngestion(p);
  };
  const chooseTemplate = t=>{setTemplateId(t.id);setSpec({...t});setSpecSaved(false);};
  const saveSpec = ()=>{if(onCanEdit&&!onCanEdit())return;const saved={...spec,revision:(templates.find(t=>t.id===templateId)?.revision||1)+1};setTemplates(ts=>ts.map(t=>t.id===templateId?{...t,...saved}:t));setSpec(saved);setSpecSaved(true);onToast?.(`已保存规范 v${saved.revision}；已创建任务仍保留原规范。`);};
  const saveTag = ()=>{
    if(onCanEdit&&!onCanEdit())return;
    const name=tagForm.name.trim();
    if(!name){setFormError('请输入标签名称。');return;}
    if(taxonomy.tags.some((t,i)=>t.name===name && i!==modal.index)){setFormError('该标签已存在，请使用其他名称。');return;}
    setTaxonomies(ts=>ts.map(t=>t.id===taxonomyId?{...t,revision:(t.revision||1)+1,tags:modal.index===undefined?[...t.tags,{...tagForm,name}]:t.tags.map((tag,i)=>i===modal.index?{...tagForm,name}:tag)}:t));setModal(null);
  };
  const chooseFile = async e=>{
    const file=e.target.files?.[0];if(!file)return;
    setReadingFile(true);setParsedFile(null);setSource(null);setSkipErrors(false);
    try{
      if(!/\.(json|csv)$/i.test(file.name)||file.size>20*1024*1024)throw new Error('支持 20 MB 内的 JSON 或 CSV。');
      const parsed=parseTextFile(await file.text(),file.name);setParsedFile(parsed);setFieldMap(parsed.mapping);
      setSource({kind:'local',name:file.name,size:`${Math.max(1,Math.round(file.size/1024))} KB`,records:mapTextRows(parsed,parsed.mapping,'LOCAL').records});setIngestError('');
    }catch(error){setIngestError(error.message)}finally{setReadingFile(false);e.target.value=''}
  };
  const completeIngest = ()=>{
    if(readingFile||(source?.kind==='local'&&mappedFile?.errors.length&&!skipErrors)){setIngestError('请修正字段映射，或明确确认排除错误行。');return;}
    const name=datasetName.trim()||'客户反馈 · 新增样本';
    const project=projects.find(item=>item.id===ingestProjectId);
    if(project?.type!=='text'||!project?.specSnapshot?.labels.length){setIngestError('关联任务缺少有效的规范与标签，请先配置任务。');return;}
    if(project.specSnapshot.name==='知识问答构建'){onNavigate('knowledge',{projectId:project.id});return;}
    const rawRecords=source?.records||createDemoTextRecords(`DEMO-${Date.now()}`);
    const id=onCreateDataset?.({name,projectId:project.id,projectName:project.name,type:'text',sourceKind:source?.kind||'demo',total:rawRecords.length,status:'cleaning',source:source?.name||'示例数据',importReport:source?.kind==='local'?{name:source.name,mapping:fieldMap,excludedRows:mappedFile.errors}:null,description:`${rawRecords.length} 条实际演示样本，清洗后继续本批次标注与审核`,version:'未发布',date:'2026-10-27',specSnapshot:clone(project.specSnapshot),rawRecords});
    if(!id){setIngestError('未能创建批次，请检查任务规范后重试。');return;}
    setImportedDatasetId(id);setCleaningStates(s=>({...s,[id]:initialCleaning()}));
    setCreatedName(name);setIngestComplete(true);
  };
  const projectTable = ()=><div className="pv-table-wrap"><table className="pv-table"><thead><tr><th>任务名称</th><th>当前阶段</th><th>完成进度</th><th>待处理</th><th>负责人</th><th></th></tr></thead><tbody>{filteredProjects.map(p=><tr key={p.id}><td><div className="pv-project-name"><span className={`pv-file-icon ${p.type==='image'?'pv-purple':''}`}>{p.type==='image'?<IconPhoto size={20}/>:<IconFileText size={20}/>}</span><div><strong>{p.name}</strong><small>{p.count} <span>·</span> {p.id}</small></div></div></td><td><Badge tone={p.tone}>{p.phase}</Badge></td><td><div className="pv-progress-cell"><div className="pv-progress"><i style={{width:`${p.progress}%`}}/></div><span>{p.progress}%</span></div></td><td><span className={p.tone==='amber'?'pv-warning':'pv-secondary'}>{p.id==='PRJ-001'&&!p.batchCount?`${counts.review} 条待审核`:p.issue}</span></td><td><span className="pv-owner"><i>{p.owner.slice(-1)}</i>{p.owner}</span></td><td className="pv-align-right"><div className="pv-project-actions">{onPlanTask&&<Button variant="ghost" onClick={()=>onPlanTask({projectId:p.id})}>需求与指标</Button>}{<Button variant="ghost" icon={IconUpload} onClick={()=>openProjectIngestion(p)}>接入新批次</Button>}<Button variant="ghost" onClick={()=>{if(p.target==='ingestion'){openProjectIngestion(p);return;}if(p.target==='processing'){openCleaning(p.datasetId||(p.id==='PRJ-002'?'knowledge':'customer'));return;}if(p.target==='definitions'&&p.type==='image'){chooseTemplate(templates.find(t=>t.id==='detection'));}onNavigate(p.target,p.datasetId?{datasetId:p.datasetId,tab:p.tab}:p.id==='PRJ-001'?{datasetId:'customer'}:undefined);}}>{p.action}<IconChevronRight size={15}/></Button></div></td></tr>)}</tbody></table>{!filteredProjects.length&&<Empty/>}</div>;

  let content;
  if(view==='projects') content=<>
    <PageHeader title="任务管理" description="以业务目标组织数据、标注规范与交付进度。" eyebrow="任务建模中心"><Button variant="primary" icon={IconPlus} onClick={openProject}>新建任务</Button></PageHeader>
    <div className="pv-compact-stats"><span>全部任务 <b>{projects.length}</b></span><span>正在生产 <b>{linkedProjects.filter(project=>!['待接入','待质检发布','已交付版本'].includes(project.phase)).length}</b></span><span>等待发布 <b>{linkedProjects.filter(project=>project.phase==='待质检发布').length}</b></span><span>我的任务 <b>{projects.filter(p=>p.owner==='陈雨').length}</b></span></div>
    <Panel><div className="pv-list-toolbar"><Tabs items={[{id:'all',label:'全部任务'},{id:'mine',label:'我负责的'},{id:'attention',label:'待处理'}]} value={projectFilter} onChange={setProjectFilter}/><Search value={projectQuery} onChange={setProjectQuery} placeholder="搜索任务名称"/></div>{projectTable()}</Panel>
    <div className="pv-bottom-note"><IconListDetails size={18}/><span>每个任务关联独立的标注规范与标签体系，数据版本在数据生产中心统一管理。</span><button onClick={()=>onNavigate('definitions')}>查看任务定义<IconArrowRight size={15}/></button></div>
  </>;
  else if(view==='definitions') content=<>
    <PageHeader title="任务定义" description="统一输入、输出和作业规范，让每一次标注都有据可依。" eyebrow="任务建模中心"><Button variant="secondary" icon={IconPlus} onClick={()=>{if(onPlanTask){onPlanTask({templateId});return;}setProjectForm({name:`${spec.name}任务`,scene:spec.type==='image'?'工业质检':'智能客服',type:spec.type,templateId:templateId,labels:spec.labels,goal:''});setFormError('');setModal({type:'project'});}}>使用此定义创建任务</Button><Button variant="primary" icon={IconCheck} disabled={![spec.name,spec.input,spec.output,spec.guide,spec.review].every(s=>s.trim())} onClick={saveSpec}>保存定义</Button></PageHeader>
    <div className="pv-template-grid">{templates.map(t=><button key={t.id} className={`pv-template-card ${templateId===t.id?'pv-selected':''}`} onClick={()=>chooseTemplate(t)}><div className="pv-template-top"><t.icon size={24}/>{templateId===t.id&&<IconCircleCheck size={20}/>}</div><strong>{t.name}</strong><p>{t.description}</p><span>{t.type==='image'?'图像任务':'文本任务'}<IconChevronRight size={15}/></span></button>)}</div>
    <div className="pv-definition-grid"><Panel title="定义详情" description="保存后形成新的规范版本；已创建任务继续使用其固定快照。" actions={specSaved?<Badge tone="mint">规范 v{spec.revision||1} 已保存</Badge>:<Badge tone="neutral">可编辑</Badge>}><div className="pv-form-body"><div className="pv-form-grid"><Field label="定义名称" required><input value={spec.name} onChange={e=>{setSpec({...spec,name:e.target.value});setSpecSaved(false);}}/></Field><Field label="关联标签体系"><select value={spec.labels} onChange={e=>{setSpec({...spec,labels:e.target.value});setSpecSaved(false);}}>{taxonomies.map(t=><option key={t.id}>{t.name}</option>)}</select></Field></div><Field label="数据输入"><textarea rows={2} value={spec.input} onChange={e=>{setSpec({...spec,input:e.target.value});setSpecSaved(false);}}/></Field><Field label="标注输出"><textarea rows={2} value={spec.output} onChange={e=>{setSpec({...spec,output:e.target.value});setSpecSaved(false);}}/></Field><Field label="标注指南"><textarea rows={4} value={spec.guide} onChange={e=>{setSpec({...spec,guide:e.target.value});setSpecSaved(false);}}/></Field><Field label="审核要求"><textarea rows={2} value={spec.review} onChange={e=>{setSpec({...spec,review:e.target.value});setSpecSaved(false);}}/></Field></div></Panel><div className="pv-aside-column"><Panel title="作业预览"><div className="pv-preview-task"><div className="pv-preview-label">输入样本</div><blockquote>{spec.type==='image'?'工业零件表面图片 · sample_001.jpg':demoRows[0].text}</blockquote><div className="pv-preview-label">可用标签</div><div className="pv-label-chip-list">{(taxonomies.find(t=>t.name===spec.labels)?.tags||taxonomy.tags).map(tag=><span className="pv-label-chip" key={tag.name} style={{'--tag-color':tag.color}}><i/>{tag.name}</span>)}</div><div className="pv-preview-label">审核规则</div><p>{spec.review}</p><div className="pv-callout"><IconShieldCheck size={18}/><span>标注指南将在作业区同步展示，帮助团队保持判断一致。</span></div></div></Panel><Panel title="定义检查"><div className="pv-checklist">{[['输入字段已配置',!!spec.input.trim()],['输出要求已配置',!!spec.output.trim()],['标注指南已配置',!!spec.guide.trim()],['审核规则已配置',!!spec.review.trim()]].map(([label,ok])=><div key={label} className={ok?'':'pv-warning'}>{ok?<IconCircleCheck size={18}/>:<IconAlertTriangle size={18}/>}<span>{label}</span></div>)}</div></Panel></div></div>
  </>;
  else if(view==='labels') content=<>
    <PageHeader title="标签体系" description="用清晰、一致的业务语言管理分类标签。" eyebrow="任务建模中心"><Button variant="primary" icon={IconPlus} onClick={()=>{setTaxonomyName('');setFormError('');setModal({type:'taxonomy'});}}>新建标签体系</Button></PageHeader>
    <div className="pv-taxonomy-layout"><Panel title="全部体系" actions={<span className="pv-muted">{taxonomies.length}</span>}><div className="pv-taxonomy-nav">{taxonomies.map(t=><button className={taxonomyId===t.id?'pv-active':''} key={t.id} onClick={()=>setTaxonomyId(t.id)}><IconTag size={19}/><span><b>{t.name}</b><small>{t.tags.length} 个标签 · {t.used} 个任务引用</small></span><IconChevronRight size={16}/></button>)}</div></Panel><Panel title={taxonomy.name} description={taxonomy.description} actions={<Button icon={IconPlus} onClick={()=>{setTagForm({name:'',description:'',color:palette[taxonomy.tags.length%palette.length]});setFormError('');setModal({type:'tag'});}}>添加标签</Button>}><div className="pv-taxonomy-meta"><span><IconListDetails size={16}/>单选分类</span><span><IconFolder size={16}/>{taxonomy.used} 个关联任务</span><span>更新于 2026-10-27</span></div><div className="pv-table-wrap"><table className="pv-table pv-tags-table"><thead><tr><th>标签名称</th><th>使用说明</th><th>标识</th><th></th></tr></thead><tbody>{taxonomy.tags.map((tag,i)=><tr key={tag.name}><td><span className="pv-label-chip" style={{'--tag-color':tag.color}}><i/>{tag.name}</span></td><td>{tag.description||'暂无说明'}</td><td><code>{`label_${String(i+1).padStart(2,'0')}`}</code></td><td className="pv-align-right"><Button variant="ghost" icon={IconEdit} onClick={()=>{setTagForm({...tag});setFormError('');setModal({type:'tag',index:i});}}>编辑</Button></td></tr>)}</tbody></table>{!taxonomy.tags.length&&<Empty title="还没有标签" description="添加第一个标签，明确数据的分类标准。"><Button icon={IconPlus} onClick={()=>{setTagForm({name:'',description:'',color:palette[0]});setModal({type:'tag'});}}>添加标签</Button></Empty>}</div><div className="pv-label-footer"><IconShieldCheck size={18}/><p>标签说明会出现在标注作业区。调整分类标准后，建议同步更新任务指南。</p><Button variant="ghost" onClick={()=>onNavigate('definitions')}>任务定义<IconArrowRight size={15}/></Button></div></Panel></div>
  </>;
  else if(view==='ingestion') content=<>
    <PageHeader title="数据接入" description="将业务数据整理为统一、可追溯的数据集。" eyebrow="数据生产中心"><Button variant="ghost" icon={IconDatabase} onClick={()=>onNavigate('datasets')}>查看数据集</Button></PageHeader>
    <Panel className="pv-ingestion-panel">
      <div className="pv-stepbar-wrap"><StepBar steps={['选择数据源','校验与预览','确认接入']} current={ingestComplete?3:ingestStep}/></div>
      {ingestComplete?<div className="pv-ingest-success">
        <span><IconCircleCheck size={38}/></span><h2>数据已接入</h2><p>「{createdName}」已创建，包含 {textBatches[importedDatasetId]?.rawRecords.length||source?.records?.length||0} 条实际记录。</p>
        <div className="pv-success-details"><div><small>关联任务</small><b>{ingestProject}</b></div><div><small>交付版本</small><b>尚未发布</b></div><div><small>下一步</small><b>清洗本批数据</b></div></div>
        <div className="pv-inline-actions"><Button onClick={()=>onNavigate('datasets',{datasetId:importedDatasetId})}>查看数据集</Button><Button variant="primary" icon={IconArrowRight} onClick={()=>openCleaning(importedDatasetId)}>清洗本次导入</Button></div>
        <button className="pv-text-button" onClick={()=>{setIngestStep(0);setSource(null);setIngestComplete(false);setIngestError('');}}>继续接入其他数据</button>
      </div>:<div className="pv-ingest-content">
        {ingestStep===0?<>
          <div className="pv-section-heading"><h2>选择数据来源</h2><p>使用小批样例，逐条完成接入、标注、审核与交付。</p></div>
          <div className="pv-source-grid">
            <button className={`pv-source-card ${source?.kind==='demo'?'pv-selected':''}`} onClick={()=>{setSource({kind:'demo',name:'客户反馈示例.csv',size:'6 条样本',records:createDemoTextRecords(`DEMO-${Date.now()}`)});setIngestError('');}}><span className="pv-source-icon"><IconDatabase size={25}/></span><div><h3>使用示例数据</h3><p>6 条实际记录，包含 4 类客户反馈和 2 条重复记录。</p><span className="pv-source-hint">默认清洗后保留 4 条，可完整逐条操作</span></div>{source?.kind==='demo'?<IconCircleCheck className="pv-accent" size={22}/>:<span className="pv-radio"/>}</button>
            <button className={`pv-source-card ${source?.kind==='local'?'pv-selected':''}`} onClick={()=>fileInput.current?.click()}><span className="pv-source-icon"><IconUpload size={25}/></span><div><h3>选择本地文件</h3><p>支持 JSON、CSV；单个文件不超过 20 MB。</p><span className="pv-source-hint">实际读取文本；支持字段映射与错误行处理</span></div>{source?.kind==='local'?<IconCircleCheck className="pv-accent" size={22}/>:<span className="pv-radio"/>}</button>
          </div>
          <input type="file" className="pv-file-input" accept=".json,.csv,application/json,text/csv" ref={fileInput} onChange={chooseFile} aria-label="选择 JSON 或 CSV 数据文件"/>
          {source&&<div className="pv-selected-file"><IconFileText size={22}/><div><strong>{source.name}</strong><small>{source.size} · {source.kind==='demo'?`${source.records.length} 条记录可预览`:'本地正文已读取，等待字段校验和确认接入'}</small></div><Badge tone="mint">已选择</Badge><button className="pv-icon-button" aria-label="移除所选文件" onClick={()=>setSource(null)}><IconX size={18}/></button></div>}
          <div className="pv-callout pv-ingestion-note"><IconShieldCheck size={19}/><span>当前为前端演示，不上传本地文件。校验通过的实际记录会进入新批次，并沿用到标注、审核和版本交付。</span></div>
          {source?.kind==='local'&&parsedFile&&<div className="cl-import-map"><h3>字段映射与校验</h3><div className="cl-grid">{[['text','文本内容（必选）'],['id','样本编号（留空自动生成）'],['channel','来源渠道'],['label','参考标签']].map(([key,label])=><Field key={key} label={label}><select value={fieldMap[key]||''} onChange={e=>{setFieldMap(current=>({...current,[key]:e.target.value}));setSkipErrors(false)}}><option value="">不映射</option>{parsedFile.columns.map(c=><option key={c} value={c}>{c}</option>)}</select></Field>)}</div><p>共 {parsedFile.rows.length} 行，有效 {mappedFile.records.length} 行，错误 {mappedFile.errors.length} 行。</p>{!!mappedFile.errors.length&&<><div className="cl-import-errors">{mappedFile.errors.map((r,i)=><div key={i}>行 {r.row}：{r.error} {r.id}</div>)}</div><label className="cl-check"><input type="checkbox" checked={skipErrors} onChange={e=>setSkipErrors(e.target.checked)}/>明确排除以上错误行，仅接入有效记录</label></>}</div>}
        </>:ingestStep===1?<>
          <div className="pv-section-heading"><h2>数据校验与预览</h2><p>{source?.name} · 以下为本批次实际使用的记录</p></div>
          <div className="pv-validation-strip"><span><IconCircleCheck size={19}/>样本格式符合要求</span><span><IconCircleCheck size={19}/>来源编号独立</span><span><IconCircleCheck size={19}/>{source?.records?.length||0} 条记录可接入</span></div>
          <div className="pv-mapping"><div><span>来源字段</span><code>text</code><IconArrowRight size={17}/><b>文本内容</b></div><div><span>来源字段</span><code>channel</code><IconArrowRight size={17}/><b>来源渠道</b></div><div><span>来源字段</span><code>referenceLabel</code><IconArrowRight size={17}/><b>参考意图</b></div></div>
          <div className="pv-table-wrap pv-preview-table"><table className="pv-table"><thead><tr><th>记录编号</th><th>文本内容</th><th>来源渠道</th><th>参考意图</th></tr></thead><tbody>{source?.records?.map(record=><tr key={record.id}><td><code>{record.id}</code></td><td>{record.text}</td><td>{record.channel}</td><td><Badge tone="neutral" dot={false}>{record.referenceLabel}</Badge></td></tr>)}</tbody></table></div>
          <div className="pv-table-caption">展示全部 {source?.records?.length||0} 条记录 · 参考意图不会直接成为标注结果，清洗后仍需人工确认。</div>
        </>:<>
          <div className="pv-section-heading"><h2>确认数据集信息</h2><p>为这批数据命名，绑定任务已保存的规范快照。</p></div>
          <div className="pv-confirm-grid"><div className="pv-form-body">
            <Field label="数据集名称" required><input value={datasetName} onChange={e=>setDatasetName(e.target.value)} maxLength={60}/></Field>
            <Field label="关联任务"><select value={ingestProjectId} onChange={e=>{setIngestProjectId(e.target.value);setIngestProject(projects.find(p=>p.id===e.target.value).name);}}>{projects.filter(p=>p.type==='text').map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></Field>
            <Field label="数据类型"><input value="文本 · 单选分类" readOnly/></Field>
            <Field label="交付版本"><input value="工作批次 · 完成审核和质检后发布" readOnly/></Field>
          </div><div className="pv-import-summary"><h3>本次接入摘要</h3><dl>
            <div><dt>数据来源</dt><dd>{source?.name}</dd></div><div><dt>关联任务</dt><dd>{ingestProject}</dd></div><div><dt>实际样本</dt><dd>{source?.records?.length||0} 条</dd></div>
            <div><dt>固定规范</dt><dd>{projects.find(p=>p.id===ingestProjectId)?.specSnapshot?.name} · {projects.find(p=>p.id===ingestProjectId)?.specSnapshot?.version}</dd></div>
            <div><dt>可用标签</dt><dd>{projects.find(p=>p.id===ingestProjectId)?.specSnapshot?.labels.map(label=>label.name).join('、')}</dd></div><div><dt>接入策略</dt><dd>创建独立新批次</dd></div>
          </dl><div className="pv-callout"><IconDatabase size={18}/><span>后续清洗、标注、审核与发布均使用本批数据。任务规范与标签在创建时固定，后续模板修改不会回写本批次。</span></div></div></div>
        </>}
        {ingestError&&<p className="pv-form-error" role="alert">{ingestError}</p>}
        <div className="pv-wizard-footer"><div>{ingestStep>0?<Button onClick={()=>setIngestStep(s=>s-1)}>上一步</Button>:<span>步骤 1 / 3</span>}</div>{ingestStep<2?<Button variant="primary" disabled={!source||readingFile||!source.records?.length||(source.kind==='local'&&!!mappedFile?.errors.length&&!skipErrors)} onClick={()=>setIngestStep(s=>s+1)}>下一步<IconArrowRight size={17}/></Button>:<Button variant="primary" icon={IconCheck} disabled={!datasetName.trim()||!source?.records?.length} onClick={completeIngest}>确认接入 {source?.records?.length||0} 条样本</Button>}</div>
      </div>}
    </Panel>
  </>;
  else if(view==='processing'&&imageProcessingBatch) content=<>
    <PageHeader title="图片接入检查" description={`${imageProcessingBatch.name} · 原图与尺寸已保留`} eyebrow="数据生产中心"><Button onClick={()=>onNavigate('datasets',{datasetId:imageProcessingBatch.datasetId})}>查看本数据集</Button><Button variant="primary" icon={IconArrowRight} onClick={()=>onNavigate('review',{datasetId:imageProcessingBatch.datasetId})}>进入图片标注</Button></PageHeader>
    <Panel title="本批次原图" description="图片接入时已检查可读取性与尺寸；接下来完成标注和人工复核，再进行发布前质量检查。"><div className="pv-callout"><IconPhoto size={22}/><span>{imageProcessingBatch.records.length} 张完整图片 · {imageProcessingBatch.projectName} · {imageProcessingBatch.batchId}</span></div><div className="pv-table-wrap"><table className="pv-table"><thead><tr><th>图片</th><th>原始尺寸</th><th>来源</th><th>下一步</th></tr></thead><tbody>{imageProcessingBatch.records.map(record=><tr key={record.id}><td>{record.name}</td><td>{record.width} × {record.height} px</td><td>{record.source==='upload'?'本地图片':'内置示意图'}</td><td>逐图标注与复核</td></tr>)}</tbody></table></div><p className="pv-bottom-note">本原型保留原图，不执行图像增强或自动缺陷识别。标注框使用原图像素坐标。</p></Panel>
  </>;
  else if(view==='processing') content=<>
    <PageHeader title="数据清洗" description="选择清洗规则，预览变化，让原始数据进入可生产状态。" eyebrow="数据生产中心"><Button icon={IconDatabase} onClick={()=>onNavigate('datasets',{datasetId:focusDataset})}>查看数据集</Button><Button variant="primary" icon={focusDataset==='knowledge'?IconUpload:jobStatus==='done'?IconRefresh:IconPlayerPlay} loading={focusDataset!=='knowledge'&&jobStatus==='running'} disabled={cleaningLocked} onClick={()=>{if(focusDataset==='knowledge'){onNavigate('ingestion');return;}if(cleaningLocked)return;setJobProgress(0);setJobStatus('running');}}>{focusDataset==='knowledge'?'重新接入文件':cleaningLocked?'清洗结果已锁定':jobStatus==='running'?'正在清洗':jobStatus==='done'?'重新运行':'运行清洗'}</Button></PageHeader>
    <div className="pv-dataset-switch">{importedDatasets.map(d=><button key={d.id} className={focusDataset===d.id?'pv-active':''} onClick={()=>openCleaning(d.id)}><IconFileText size={19}/><span>{d.name}<small>{d.rawRecords.length} 条原始样本 · {d.projectName}</small></span><Badge tone={(cleaningStates[d.id]?.status==='done'||d.stage==='cleaned')?'mint':cleaningStates[d.id]?.status==='running'?'blue':'amber'}>{(cleaningStates[d.id]?.status==='done'||d.stage==='cleaned')?'清洗完成':cleaningStates[d.id]?.status==='running'?'清洗中':'待清洗'}</Badge></button>)}<button className={focusDataset==='customer'?'pv-active':''} onClick={()=>openCleaning('customer')}><IconFileText size={19}/><span>客户反馈原始集<small>1,200 条文本 · 主演示批次 B-1027</small></span><Badge tone={cleaningStates.customer.status==='done'?'mint':cleaningStates.customer.status==='running'?'blue':'amber'}>{cleaningStates.customer.status==='done'?'清洗完成':cleaningStates.customer.status==='running'?'清洗中':'待清洗'}</Badge></button><button className={focusDataset==='knowledge'?'pv-active':''} onClick={()=>onNavigate('knowledge')}><IconBook2 size={19}/><span>企业知识文档<small>{knowledgeState?.documents.length||0} 份实际文档</small></span><Badge tone="amber">{knowledgeState?.documents.filter(d=>d.status==='failed').length||0} 份异常</Badge></button></div>{activeImported&&<div className="pv-callout pv-import-cleaning-note"><IconDatabase size={19}/><span>当前处理「{activeImported.name}」的 {inputCount} 条样本 · {activeImported.projectName} · {activeImported.batchId}。{cleaningLocked?'本批次已进入标注或交付，清洗结果已锁定；如需调整规则，请接入新批次。':'清洗后将直接进入本批次的标注队列，并沿用固定任务规范。'}</span></div>}{activeCleaning.error&&<p className="pv-form-error pv-cleaning-error" role="alert">{activeCleaning.error}</p>}
    {focusDataset==='knowledge'?<Panel title="文档解析异常" description="12 份文档需要重新提供可读取的文件，或人工补充文本。"><div className="pv-callout pv-knowledge-callout"><IconAlertTriangle size={20}/><span>本批次有 8 份扫描件缺少文本层、4 份文件内容不完整。其余 314 份已进入知识整理流程。</span></div><div className="pv-table-wrap"><table className="pv-table"><thead><tr><th>文件名称</th><th>问题</th><th>建议处理</th><th></th></tr></thead><tbody>{[['产品使用手册_03.pdf','扫描件无文本层','使用 OCR 重新解析'],['售后服务规范_2026.pdf','扫描件无文本层','使用 OCR 重新解析'],['设备安装指南_02.pdf','文件内容不完整','重新上传完整文件']].map((row,i)=><tr key={row[0]}><td><span className="pv-file-name"><IconFileText size={18}/>{row[0]}</span></td><td><Badge tone="amber">{row[1]}</Badge></td><td>{row[2]}</td><td><Button variant="ghost" onClick={()=>setModal({type:'exception',file:row[0],reason:row[1],recommendation:row[2]})}>查看详情<IconChevronRight size={16}/></Button></td></tr>)}</tbody></table></div><div className="pv-table-caption">展示 3 / 12 份异常文档 · 文档异常为演示样例</div><div className="pv-panel-footer"><Button onClick={()=>openCleaning('customer')}>返回文本清洗</Button><Button variant="primary" icon={IconUpload} onClick={()=>onNavigate('ingestion')}>重新接入文件</Button></div></Panel>:<><div className="pv-cleaning-layout"><Panel title="清洗规则" description="规则依次执行，可在运行前调整。" actions={<Badge tone="neutral">{Object.values(rules).filter(Boolean).length} 项启用</Badge>}><div className="pv-rule-list">{rulesList.map((r,i)=><label className="pv-rule" key={r.key}><span className="pv-rule-number">{i+1}</span><div><div><r.icon size={17}/><strong>{r.name}</strong></div><p>{r.detail}</p><small>{ruleHits[r.key]} {({trim:'条格式调整',dedupe:'条重复记录',empty:'条空记录',pii:'条敏感信息'})[r.key]}</small></div><input aria-label={`启用${r.name}`} type="checkbox" checked={rules[r.key]} disabled={jobStatus==='running'||cleaningLocked} onChange={e=>{setRules({...rules,[r.key]:e.target.checked});setJobStatus('idle');setJobProgress(0);}}/><span className="pv-switch"/></label>)}</div><div className="pv-rule-note"><IconShieldCheck size={18}/><p>原始条数与规则命中会保留在本次清洗报告中。</p></div></Panel><div className="pv-primary-column"><Panel title={jobStatus==='done'?'清洗结果':'运行预览'} actions={<Badge tone={jobStatus==='done'?'mint':jobStatus==='running'?'blue':'neutral'}>{jobStatus==='done'?'已完成':jobStatus==='running'?'运行中':'演示数据'}</Badge>}><div className="pv-cleaning-counts"><div><span>输入记录</span><strong>{inputCount.toLocaleString()}</strong><small>原始文本</small></div><IconArrowRight size={23}/><div><span>{jobStatus==='done'?'输出记录':'预计输出'}</span><strong className="pv-accent">{outputCount.toLocaleString()}</strong><small>{activeImported?'清洗后保留':'可进入标注'}</small></div><div><span>过滤记录</span><strong>{inputCount-outputCount}</strong><small>{rules.dedupe?ruleHits.dedupe:0} 条重复 · {rules.empty?ruleHits.empty:0} 条空内容</small></div></div>{jobStatus==='running'?<div className="pv-job-state" aria-live="polite"><div><span>{jobProgress<30?'正在标准化文本':jobProgress<60?'正在检测重复与空记录':jobProgress<90?'正在检查敏感信息':'正在生成清洗结果'}</span><b>{jobProgress}%</b></div><div className="pv-progress"><i style={{width:`${jobProgress}%`}}/></div></div>:jobStatus==='done'?<div className="pv-job-complete" role="status"><IconCircleCheck size={20}/><span>清洗完成，{outputCount.toLocaleString()} 条记录{activeImported?'已更新至本次数据集。':outputCount===1160?'已准备好进入下一步。':'已生成本次规则预览。'}</span><Button variant="ghost" onClick={()=>setInspectTab('report')}>查看报告<IconChevronRight size={15}/></Button></div>:<div className="pv-job-idle"><IconClock size={17}/><span>{activeImported?'预览由本批真实样例计算。运行清洗后将保存结果并生成待标注队列。':'预览基于预置规则统计。点击右上方「运行清洗」体验执行过程。'}</span></div>}</Panel><Panel title="效果检查" actions={<Button variant="ghost" icon={IconDownload} onClick={()=>downloadText(`${cleaningName}-清洗规则报告.json`,JSON.stringify({dataset:cleaningName,datasetId:activeImported?.id,projectId:activeImported?.projectId,batchId:activeImported?.batchId,taskSpecVersionId:activeImported?.taskSpecVersionId,mode:'demo',input:inputCount,output:outputCount,executed:jobStatus==='done',...(previewReport||{}),rules},null,2))}>导出规则报告</Button>}><Tabs items={[{id:'sample',label:'样本对比'},{id:'report',label:'规则报告'}]} value={inspectTab} onChange={setInspectTab}/>{inspectTab==='sample'?(activeImported?<><div className="pv-sample-toolbar"><span>样本 {Math.min(sampleIndex+1,inputCount)} / {inputCount}</span><select aria-label="选择对比样本" value={sampleIndex} onChange={e=>setSampleIndex(Number(e.target.value))}>{activeImported.rawRecords.map((record,index)=><option key={record.id} value={index}>{index+1}. {record.channel} · {record.referenceLabel}</option>)}</select></div><div className="pv-diff-grid"><div><div className="pv-diff-heading"><span>清洗前</span><Badge tone="neutral" dot={false}>原始记录</Badge></div><pre>{activeImported.rawRecords[sampleIndex]?.text}</pre><small>{activeImported.rawRecords[sampleIndex]?.id}</small></div><div><div className="pv-diff-heading"><span>{jobStatus==='done'?'清洗后':'规则预览'}</span><Badge tone="mint" dot={false}>{previewReport?.removed.some(record=>record.id===activeImported.rawRecords[sampleIndex]?.id)?'已过滤':'保留'}</Badge></div><pre>{cleaningPreview?.records.find(record=>record.id===activeImported.rawRecords[sampleIndex]?.id)?.text||'该记录已按规则过滤，不进入标注队列。'}</pre><small>{previewReport?.removed.find(record=>record.id===activeImported.rawRecords[sampleIndex]?.id)?.reason||'保留原始编号及来源，可在后续流程追溯。'}</small></div></div></>:<><div className="pv-sample-toolbar"><span>样本 {sampleIndex+1} / 3</span><select aria-label="选择对比样本" value={sampleIndex} onChange={e=>setSampleIndex(Number(e.target.value))}><option value={0}>手机号脱敏与空白清理</option><option value={1}>重复内容识别</option><option value={2}>邮箱脱敏</option></select></div><div className="pv-diff-grid"><div><div className="pv-diff-heading"><span>清洗前</span><Badge tone="neutral" dot={false}>原始数据</Badge></div><pre>{sampleIndex===0?'  想查询订单配送进度，手机号 13800138000。  \n\n':sampleIndex===1?'商品收到后发现有划痕，可以申请换货吗？':'请将使用手册发送到 chen.yu@example.com，谢谢。'}</pre><small>{sampleIndex===0?'包含手机号、首尾空格与空行':sampleIndex===1?'与 FB-001 内容完全一致':'包含电子邮箱地址'}</small></div><div><div className="pv-diff-heading"><span>清洗后</span><Badge tone="mint" dot={false}>{sampleIndex===1&&rules.dedupe?'已过滤':'保留'}</Badge></div><pre>{sampleIndex===0?`${rules.trim?'':'  '}想查询订单配送进度，手机号 ${rules.pii?'138****8000':'13800138000'}。${rules.trim?'':'  \n\n'}`:sampleIndex===1?rules.dedupe?'重复记录已移除，保留首次出现的 FB-001。':'商品收到后发现有划痕，可以申请换货吗？':`请将使用手册发送到 ${rules.pii?'c***@example.com':'chen.yu@example.com'}，谢谢。`}</pre><small>{sampleIndex===0?`${rules.trim?'格式已标准化':'格式保留'} · ${rules.pii?'手机号已脱敏':'未启用脱敏'}`:sampleIndex===1?rules.dedupe?'保留首条记录及原始来源':'未启用去重，保留该记录':rules.pii?'邮箱用户名已遮盖':'未启用脱敏'}</small></div></div></>):<div className="pv-table-wrap"><table className="pv-table"><thead><tr><th>规则</th><th>状态</th><th>命中记录</th><th>处理方式</th></tr></thead><tbody>{rulesList.map((r,i)=><tr key={r.key}><td>{r.name}</td><td><Badge tone={rules[r.key]?'mint':'neutral'}>{rules[r.key]?jobStatus==='done'?'已执行':'待执行':'已停用'}</Badge></td><td>{rules[r.key]?ruleHits[r.key]:0}</td><td>{['规范文本格式','保留首次出现','从输出中移除','遮盖敏感字段'][i]}</td></tr>)}</tbody></table><div className="pv-table-caption">命中记录可重叠，格式调整与脱敏不减少输出条数。</div></div>}</Panel></div></div><div className="pv-next-step"><div><IconCircleCheck size={21}/><span><b>下一站：标注与审核</b><small>{activeImported?(activeImported.stage==='cleaned'?`${activeImported.records.length} 条结果已保存到本批次。先分配演示标注人，再逐条提交和审核。`:'请先运行清洗，本次输出将进入自己的标注队列。'):(jobStatus==='done'?(outputCount===1160?`本次示例已完成清洗，共 ${outputCount.toLocaleString()} 条。`:`当前规则输出 ${outputCount.toLocaleString()} 条；审核体验使用已准备好的 1,160 条客服批次。`):'也可以直接体验已准备好的客户反馈标注任务。')}</small></span></div><div className="pv-inline-actions">{activeImported&&<Button onClick={()=>onNavigate('datasets',{datasetId:activeImported.id})}>查看本次数据集</Button>}<Button variant="primary" disabled={!!activeImported&&(activeImported.stage!=='cleaned'||jobStatus==='running'||jobStatus==='idle')} onClick={()=>onNavigate('review',{datasetId:activeImported?.id||'customer'})}>{activeImported?'进入本批次标注':outputCount!==1160?'体验客服样本审核':'进入标注审核'}<IconArrowRight size={17}/></Button></div></div></>}
  </>;
  else content=<Empty title="选择一个工作模块" description="从任务定义或数据接入开始。"/>;

  return <div className="pv-root">{view==='ingestion'&&<div className="pv-ingestion-types"><Tabs items={[{id:'text',label:'文本数据'},{id:'image',label:'图片数据'}]} value={ingestKind} onChange={kind=>{setIngestKind(kind);const match=projects.find(project=>project.id===ingestProjectId&&project.type===kind)||projects.find(project=>project.type===kind);if(match){setIngestProjectId(match.id);setIngestProject(match.name);}}}/></div>}{view==='ingestion'&&ingestKind==='image'?<ImageIngestionView active={active} projects={projects} requestedProjectId={ingestProjectId} onCreateImageDataset={onCreateImageDataset} onNavigate={onNavigate} onToast={onToast}/>:content}{active&&modal?.type==='project'&&<Modal title="新建任务" description="先明确业务目标，再关联数据与标注规则。" onClose={()=>setModal(null)} footer={<><Button onClick={()=>setModal(null)}>取消</Button><Button onClick={()=>createProject(false)}>保存任务</Button><Button variant="primary" onClick={()=>createProject(true)}>创建并接入数据<IconArrowRight size={16}/></Button></>}><div className="pv-form-body pv-modal-form"><Field label="任务名称" required><input autoFocus placeholder="例如：客户反馈意图分类" value={projectForm.name} onChange={e=>setProjectForm({...projectForm,name:e.target.value})} maxLength={50}/></Field><div className="pv-form-grid"><Field label="业务场景"><select value={projectForm.scene} onChange={e=>setProjectForm({...projectForm,scene:e.target.value})}><option>智能客服</option><option>企业知识</option><option>工业质检</option><option>其他业务</option></select></Field><Field label="数据类型"><select value={projectForm.type} onChange={e=>{const template=templates.find(item=>item.id===(e.target.value==='image'?'detection':'intent'));setProjectForm({...projectForm,type:e.target.value,templateId:template.id,labels:template.labels});}}><option value="text">文本</option><option value="image">图像</option></select></Field></div><Field label="任务规范（已保存版本）"><select value={projectForm.templateId} onChange={e=>{const template=templates.find(item=>item.id===e.target.value);setProjectForm({...projectForm,templateId:template.id,labels:template.labels});}}>{templates.filter(template=>template.type===projectForm.type).map(template=><option key={template.id} value={template.id}>{template.name} · v{template.revision||1}</option>)}</select></Field><Field label="标签体系"><select value={projectForm.labels} onChange={e=>setProjectForm({...projectForm,labels:e.target.value})}>{taxonomies.map(t=><option key={t.id}>{t.name}</option>)}</select></Field><div className="pv-callout"><IconShieldCheck size={18}/><span>创建时固定所选规范与标签。后续修改模板或标签，不会改变该任务已绑定的作业标准。</span></div><Field label="业务目标" hint="描述希望模型或应用解决的问题，便于团队理解标注目标。"><textarea placeholder="例如：识别客户反馈意图，提升售后分流效率。" rows={3} value={projectForm.goal} onChange={e=>setProjectForm({...projectForm,goal:e.target.value})}/></Field>{formError&&<p className="pv-form-error" role="alert">{formError}</p>}</div></Modal>}{active&&modal?.type==='tag'&&<Modal title={modal.index===undefined?'添加标签':'编辑标签'} description={`标签体系：${taxonomy.name}`} onClose={()=>setModal(null)} footer={<><Button onClick={()=>setModal(null)}>取消</Button><Button variant="primary" icon={IconCheck} onClick={saveTag}>保存标签</Button></>}><div className="pv-form-body pv-modal-form"><Field label="标签名称" required><input autoFocus value={tagForm.name} maxLength={20} onChange={e=>setTagForm({...tagForm,name:e.target.value})}/></Field><Field label="使用说明"><textarea rows={3} value={tagForm.description} placeholder="明确这个标签应在什么情况下使用" onChange={e=>setTagForm({...tagForm,description:e.target.value})}/></Field><div className="pv-color-field"><span>标签颜色</span><div>{palette.map((c,i)=><button type="button" aria-label={`选择颜色 ${i+1}`} aria-pressed={tagForm.color===c} key={c} style={{background:c}} onClick={()=>setTagForm({...tagForm,color:c})}>{tagForm.color===c&&<IconCheck size={17}/>}</button>)}</div></div>{formError&&<p className="pv-form-error" role="alert">{formError}</p>}</div></Modal>}{active&&modal?.type==='taxonomy'&&<Modal title="新建标签体系" description="创建一组可供多个任务复用的分类标签。" onClose={()=>setModal(null)} footer={<><Button onClick={()=>setModal(null)}>取消</Button><Button variant="primary" onClick={()=>{if(!taxonomyName.trim()){setFormError('请输入体系名称。');return;}if(taxonomies.some(t=>t.name===taxonomyName.trim())){setFormError('该名称已存在。');return;}const id=`taxonomy-${Date.now()}`;setTaxonomies(ts=>[...ts,{id,name:taxonomyName.trim(),description:'自定义业务分类标签，可在任务定义中关联使用。',used:0,tags:[]}]);setTaxonomyId(id);setModal(null);}}>创建体系</Button></>}><Field label="体系名称" required><input autoFocus value={taxonomyName} maxLength={30} placeholder="例如：用户情感分类" onChange={e=>setTaxonomyName(e.target.value)}/></Field>{formError&&<p className="pv-form-error" role="alert">{formError}</p>}</Modal>}{active&&modal?.type==='exception'&&<Modal title="文档解析详情" description={modal.file} onClose={()=>setModal(null)} footer={<><Button onClick={()=>setModal(null)}>关闭</Button><Button variant="primary" icon={IconUpload} onClick={()=>{setModal(null);onNavigate('ingestion');}}>重新接入文件</Button></>}><div className="pv-exception-detail"><Badge tone="amber">{modal.reason}</Badge><h3>建议处理</h3><p>{modal.recommendation}。替换文件后，系统可重新生成段落与来源定位。</p><div className="pv-callout"><IconFileText size={20}/><span>这是异常处理界面示例。当前演示不会执行真实 OCR 或修改原文件。</span></div></div></Modal>}</div>;
}
