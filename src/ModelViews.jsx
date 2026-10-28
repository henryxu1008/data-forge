import React, { useEffect, useRef, useState } from 'react';
import { IconPlus, IconCpu, IconPlayerPlay, IconCheck, IconClock, IconArrowRight, IconDatabase, IconBook, IconRobot, IconMessage, IconSend, IconDownload, IconAdjustments, IconFileText, IconChevronRight, IconRefresh, IconChartBar, IconSettings, IconBolt, IconInfoCircle, IconCircleCheck, IconLayoutList, IconArrowDown, IconTrash, IconX, IconCode, IconBox } from '@tabler/icons-react';
import { Button, Badge, PageHeader, Panel, Tabs, Field, Modal, Search, Empty, downloadText } from './ui';
import './model-views.css';
import {ModelWarehouseView,ModelEvaluationView} from './ModelLifecycleViews.jsx';
import {ModelDeploymentView,ModelTestingView} from './ModelServiceViews.jsx';
import {TrainingRecoveryPanel} from './CompletionViews.jsx';
import {dataPurpose} from './governance-state.js';
import {getLatestEvaluation} from './model-lifecycle-state.js';

function Hint({children,tone='neutral'}) { return <div className={`mv-hint mv-hint-${tone}`}><IconInfoCircle size={16} stroke={1.7}/><span>{children}</span></div> }
function Stat({label,value,unit,detail}) { return <div className="mv-stat"><span>{label}</span><strong>{value}{unit&&<small>{unit}</small>}</strong>{detail&&<p>{detail}</p>}</div> }
function Meta({items}) { return <dl className="mv-meta">{items.map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl> }
function DemoBadge(){return <Badge tone="amber">演示数据</Badge>}

function Training({governanceWorkspace,onNavigate,onToast,versions=[],trainingRequest,modelState,onModelAction,modelRequest,active=true}) {
  const availableVersions=versions.filter(version=>version.id&&Array.isArray(version.records)&&version.records.length>0);
  const jobs=modelState.trainings;
  const [trainingScenario,setTrainingScenario]=useState('success');
  const [open,setOpen]=useState(false),[name,setName]=useState('文本分类 · 新训练');
  const [base,setBase]=useState('Qwen2.5-7B-Instruct'),[datasetId,setDatasetId]=useState(availableVersions[0]?.id||'');
  const [rank,setRank]=useState('16'),[epochs,setEpochs]=useState('3'),[rate,setRate]=useState('0.0002'),[batch,setBatch]=useState('4');
  const [selected,setSelected]=useState(''),[tab,setTab]=useState('overview'),[error,setError]=useState(''),[sourceError,setSourceError]=useState('');
  const requestSeen=useRef(null),sourceRequestSeen=useRef(null),starting=useRef(false);
  const job=jobs.find(item=>item.id===selected)||jobs[0];
  const artifact=job&&modelState.models.find(item=>item.id===job.modelVersionId);
  const artifactReport=artifact&&getLatestEvaluation(modelState,artifact.id);
  const chosenVersion=availableVersions.find(version=>version.id===datasetId);
  const availableIds=availableVersions.map(version=>version.id).join('|');
  const formatVersion=version=>`${version.datasetName||'数据版本'} · ${version.version} · ${version.records.length} ${version.type==='image'?'张图片':'条记录'}`;
  const formatTime=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}):'—';
  useEffect(()=>{setDatasetId(current=>availableVersions.some(version=>version.id===current)?current:availableVersions[0]?.id||'')},[availableIds]);
  useEffect(()=>{
    if(!active||!trainingRequest||sourceRequestSeen.current===trainingRequest.key)return;
    const requested=availableVersions.find(version=>version.id===trainingRequest.versionId);
    if(!requested)return;
    sourceRequestSeen.current=trainingRequest.key;
    setDatasetId(requested.id);setBase(requested.type==='image'?'YOLO 检测流程（模拟）':'Qwen2.5-7B-Instruct');setName(`${requested.datasetName} · ${requested.version}`);setError('');starting.current=false;setOpen(true);
  },[active,trainingRequest,availableIds]);
  useEffect(()=>{
    if(!active||modelRequest?.target!=='training'||requestSeen.current===modelRequest.key)return;
    requestSeen.current=modelRequest.key;
    if(modelRequest.trainingId){setSelected(modelRequest.trainingId);setSourceError(jobs.some(item=>item.id===modelRequest.trainingId)?'':`训练任务 ${modelRequest.trainingId} 不在当前会话中，请选择现有任务。`);setTab('config');setOpen(false)}
  },[active,modelRequest]);
  function openNew(){
    setSourceError('');
    const version=chosenVersion||availableVersions[0];
    setDatasetId(version?.id||'');setBase(version?.type==='image'?'YOLO 检测流程（模拟）':'Qwen2.5-7B-Instruct');setName(version?`${version.datasetName} · ${version.version}`:'文本分类 · 新训练');setError('');starting.current=false;setOpen(true);
  }
  function start(){
    if(starting.current)return;
    starting.current=true;
    const result=onModelAction({type:'startTraining',name:name.trim(),base,dataVersionId:datasetId,scenario:trainingScenario,params:{rank:Number(rank),epochs:Number(epochs),rate:Number(rate),batch:Number(batch)}});
    if(!result.ok){starting.current=false;setError(result.error);return}
    setSelected(result.entity.id);setTab('overview');setOpen(false);onToast?.('已冻结训练配置，完成后自动登记独立模型版本');
  }
  const openSource=version=>onNavigate('datasets',{datasetId:version.datasetId,tab:'versions',versionId:version.id});
  const completed=job?.status==='completed';
  const params=job?.params||{};
  const logs=job?[
    ['接收训练任务',`任务 ${job.id}；已冻结模型和训练参数`],
    ['准备数据快照',`${job.dataVersion.datasetName} · ${job.dataVersion.version}；${job.dataVersion.records.length} 条完整演示记录`],
    ['模拟训练',`LoRA 秩 ${params.rank}，训练轮次 ${params.epochs}；不占用真实算力`],
    ['登记模型版本',artifact?`${artifact.name} · ${artifact.version}；产物 ${artifact.id}`:'等待训练完成后登记独立产物']
  ]:[];
  return <>
    <PageHeader title="模型训练" description="从已发布数据出发，生成可追溯的模型版本"><Button variant="primary" icon={IconPlus} onClick={openNew}>新建训练任务</Button></PageHeader>
    <div className="mv-summary-grid"><Stat label="训练任务" value={jobs.length} detail="本次会话的独立任务"/><Stat label="已完成" value={jobs.filter(item=>item.status==='completed').length} detail="保留配置与数据快照"/><Stat label="进行中" value={jobs.filter(item=>item.status==='running').length} detail="切换页面仍继续模拟"/><Stat label="模型产物" value={modelState.models.length} detail="每次训练有独立版本"/></div>
    {(!jobs.length||sourceError)?<Panel><Empty title={sourceError?'无法定位训练任务':'从一份数据版本开始训练'} description={sourceError||'选择已发布的文本或图片快照，训练完成后会自动登记模型版本，再继续评测和发布服务。'}>{sourceError&&jobs.length>0&&<Button onClick={()=>setSourceError('')}>查看现有训练</Button>}<Button variant="primary" onClick={openNew}>创建训练任务</Button><Button onClick={()=>onNavigate('datasets')}>查看数据版本</Button></Empty><Hint>训练、评测和部署均为本地流程模拟，不生成模型权重或真实指标。</Hint></Panel>:<div className="mv-split mv-training-split">
      <Panel title="训练任务" className="mv-list-panel"><div className="mv-item-list">{jobs.map(item=><button key={item.id} className={`mv-training-item ${job?.id===item.id?'is-selected':''}`} onClick={()=>{setSelected(item.id);setTab('overview')}}><div><strong>{item.name}</strong><Badge tone={item.status==='completed'?'mint':'blue'}>{({completed:'已完成',running:'模拟训练中',queued:'等待配额',failed:'训练失败',cancelled:'已取消'})[item.status]||item.status}</Badge></div><p>{formatVersion(item.dataVersion)}</p><small>{item.dataVersion.projectName||'当前项目'}<span>{item.id}</span></small></button>)}</div></Panel>
      <Panel className="mv-detail-panel">
        <div className="mv-detail-title"><div><div className="mv-kicker">独立训练任务 / 本地模拟</div><h2>{job.name}</h2><p>{job.base} · LoRA 微调</p></div><Badge tone={completed?'mint':'blue'}>{({completed:'已完成',running:'运行中',queued:'等待配额',failed:'训练失败',cancelled:'已取消'})[job.status]||job.status}</Badge></div>
        <Tabs items={[{id:'overview',label:'运行概况'},{id:'config',label:'训练配置'},{id:'logs',label:'运行日志'}]} value={tab} onChange={setTab}/>
        {tab==='overview'&&<div className="mv-tab-content">
          <div className="mv-training-source"><div><span>已绑定数据版本</span><strong>{formatVersion(job.dataVersion)}</strong><small>项目：{job.dataVersion.projectName} · 批次：{job.dataVersion.batchId}</small></div><Button variant="ghost" onClick={()=>openSource(job.dataVersion)}>回查数据版本<IconChevronRight size={15}/></Button></div>
          {job.dataVersion.count!==job.dataVersion.records.length&&<Hint tone="amber">预置版本的 {job.dataVersion.count} 条是历史演示统计。本次只携带快照中的 {job.dataVersion.records.length} 条样例，后续评测也按实际样例计算。</Hint>}
          <div className="mv-progress-heading"><strong>{completed?'训练完成，模型已登记':({failed:'训练失败，未登记产物',cancelled:'本次尝试已取消',queued:'等待可用资源名额',running:'正在模拟训练'})[job.status]||job.status}</strong><span>{job.progress}%</span></div><div className="mv-progress-track"><div style={{width:`${job.progress}%`}}/></div>
          <div className="mv-stat-strip"><Stat label="训练轮次" value={params.epochs}/><Stat label="完整记录" value={job.dataVersion.records.length} unit="条"/><Stat label="产物状态" value={artifact?'已登记':['failed','cancelled'].includes(job.status)?'未生成':'待完成'}/></div>
          {artifact?<div className="mv-training-source mv-training-artifact"><div><span>本次生成的模型版本</span><strong>{artifact.name} · {artifact.version}</strong><small>{artifact.id} · 绑定训练 {job.id}</small></div><Badge tone={artifactReport?.status==='failed'||artifactReport?.status==='error'?'amber':artifactReport?.status==='running'?'blue':'mint'}>{{passed:'评测达标',failed:'评测未达标',error:'评测异常',running:'评测中'}[artifactReport?.status]||'待评测'}</Badge></div>:<Hint>只有成功尝试才登记独立模型版本。失败和取消不生成产物，可在下方修正配置后重试。</Hint>}
          <div className="mv-detail-actions">{artifact&&<><Button variant="primary" icon={IconCpu} onClick={()=>onNavigate('models',{modelVersionId:artifact.id})}>查看模型版本</Button><Button icon={IconChartBar} onClick={()=>onNavigate('evaluation',{modelVersionId:artifact.id})}>评测此版本</Button></>}<Button icon={IconDownload} onClick={()=>{downloadText(`${job.id}-训练记录.json`,JSON.stringify({demo:true,training:job,model:artifact||null},null,2));onToast?.('已生成本次训练及产物来源记录')}}>导出记录</Button></div>
          <Hint>模型记录用于验证产品流程，不包含实际权重。评测通过后才可创建本地模拟服务。</Hint>
        </div>}
        {tab==='config'&&<div className="mv-tab-content"><Meta items={[["训练编号",job.id],["基础模型",job.base],["训练数据",formatVersion(job.dataVersion)],["数据版本编号",job.dataVersionId],["关联项目",job.dataVersion.projectName],["来源批次",job.dataVersion.batchId],["标签规范",job.dataVersion.specSnapshot?.versionId||'预置快照标签'],["LoRA 秩",params.rank],["学习率",params.rate],["批大小",params.batch],["训练轮次",params.epochs],["创建时间",formatTime(job.createdAt)],["完成时间",formatTime(job.completedAt)],["模型产物",artifact?`${artifact.name} · ${artifact.version} · ${artifact.id}`:'训练完成后登记']]}/><Hint>这里显示任务启动时冻结的配置。创建其他训练、发布新数据或编辑工作批次，都不会改变这些来源。</Hint><div className="mv-detail-actions"><Button onClick={()=>openSource(job.dataVersion)}>回查数据版本</Button>{artifact&&<Button onClick={()=>onNavigate('models',{modelVersionId:artifact.id})}>查看模型版本</Button>}</div></div>}
        {tab==='logs'&&<div className="mv-tab-content"><div className="mv-log-list">{logs.slice(0,completed?4:Math.max(1,Math.ceil(job.progress/25))).map(([label,detail],index)=><div key={label}><span className="mv-log-time">步骤 {index+1}</span><IconCheck size={15}/><div><strong>{label}</strong><p>{detail}</p></div></div>)}</div><Hint>任务使用本地计时演示状态变化；完成登记只执行一次。</Hint></div>}
      </Panel>
    </div>}
    {job&&<TrainingRecoveryPanel job={job} onModelAction={onModelAction}/>}
    {open&&active&&<Modal title="新建训练任务" description="绑定已发布数据，完成后自动生成模型版本。" onClose={()=>setOpen(false)} wide footer={<><Button onClick={()=>setOpen(false)}>取消</Button><Button variant="primary" icon={IconPlayerPlay} disabled={!name.trim()||!chosenVersion} onClick={start}>开始演示训练</Button></>}>
      <div className="mv-form-stack"><Field label="任务名称" required><input value={name} onChange={event=>setName(event.target.value)}/></Field><div className="mv-form-grid"><Field label="基础模型"><select value={base} onChange={event=>setBase(event.target.value)}><option>Qwen2.5-7B-Instruct</option><option>YOLO 检测流程（模拟）</option></select></Field><Field label="训练数据版本" hint="按唯一版本绑定，显示快照内的实际记录数"><select value={datasetId} onChange={event=>{setDatasetId(event.target.value);setBase(availableVersions.find(v=>v.id===event.target.value)?.type==='image'?'YOLO 检测流程（模拟）':'Qwen2.5-7B-Instruct')}}>{!availableVersions.length&&<option value="">尚无已发布数据版本</option>}{availableVersions.map(version=><option key={version.id} value={version.id}>{formatVersion(version)}</option>)}</select></Field></div>
      {chosenVersion&&<div className="mv-training-source"><div><span>数据来源</span><strong>{chosenVersion.projectName||chosenVersion.datasetName}</strong><small>批次：{chosenVersion.batchId} · 数据版本编号：{chosenVersion.id}</small></div><Button variant="ghost" onClick={()=>{setOpen(false);openSource(chosenVersion)}}>查看来源</Button></div>}
      {governanceWorkspace?.governance?.enabled&&chosenVersion&&<Hint tone="amber">数据用途：{dataPurpose(governanceWorkspace,chosenVersion.id)?.purpose||'未声明'}。开始训练前需批准立项与准入，并声明训练用途。<Button onClick={()=>{setOpen(false);onNavigate('governance',{projectId:chosenVersion.projectId,tab:'evidence',versionId:chosenVersion.id})}}>声明用途与治理依据</Button></Hint>}<Field label="训练演示场景"><select value={trainingScenario} onChange={e=>setTrainingScenario(e.target.value)}><option value="success">模拟成功</option><option value="fail">模拟训练失败</option></select></Field><div className="mv-form-divider"><h3>训练参数</h3><Badge tone="neutral" dot={false}>LoRA 微调</Badge></div><div className="mv-form-grid"><Field label="LoRA 秩"><select value={rank} onChange={event=>setRank(event.target.value)}><option>8</option><option>16</option><option>32</option></select></Field><Field label="训练轮次"><select value={epochs} onChange={event=>setEpochs(event.target.value)}><option>1</option><option>2</option><option>3</option><option>5</option></select></Field><Field label="学习率"><select value={rate} onChange={event=>setRate(event.target.value)}><option>0.0001</option><option>0.0002</option><option>0.0005</option></select></Field><Field label="批大小"><select value={batch} onChange={event=>setBatch(event.target.value)}><option>2</option><option>4</option><option>8</option></select></Field></div>{error&&<div role="alert"><Hint tone="amber">{error}</Hint></div>}<Hint tone="amber">本次为流程演示，不使用计算资源、不生成实际模型权重。</Hint></div>
    </Modal>}
  </>
}

export default function ModelViews({governanceWorkspace,view,active=true,onNavigate,onToast,versions,trainingRequest,modelState,onModelAction,modelRequest}) {
 const props={governanceWorkspace,active,onNavigate,onToast,versions,trainingRequest,modelState,onModelAction,modelRequest};
 const views={models:ModelWarehouseView,training:Training,evaluation:ModelEvaluationView,deployments:ModelDeploymentView,testing:ModelTestingView};
 const View=views[view];return <div className="mv-root">{View?<View {...props}/>:<Empty title="请选择模型生产页面"/>}</div>;
}
