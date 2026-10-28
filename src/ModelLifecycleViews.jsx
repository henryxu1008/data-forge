import React, {useEffect, useRef, useState} from 'react';
import {IconPlus, IconCpu, IconChevronRight, IconChartBar, IconPlayerPlay, IconDatabase, IconInfoCircle, IconDownload, IconCheck, IconX, IconRefresh, IconArrowRight, IconHistory, IconBox} from '@tabler/icons-react';
import {Button, Badge, PageHeader, Panel, Tabs, Field, Search, Empty, downloadText} from './ui.jsx';
import {getLatestEvaluation, getPublishEligibility} from './model-lifecycle-state.js';
import './model-lifecycle-views.css';
import {effectiveCharter} from './governance-state.js';
import {EvaluationIntegrityPanel,AcceptanceSnapshot} from './GovernanceViews.jsx';

const BASE_MODELS = [
  {id:'qwen',name:'Qwen2.5-7B-Instruct',type:'基础模型',size:'7B',description:'文本微调流程的基础模型目录项',tags:['文本生成','中文理解']},
  {id:'bge',name:'BGE-M3',type:'向量模型',size:'568M',description:'知识检索分支的向量模型目录项',tags:['向量检索','多语言']},
];
const EVALUATION_STATUS = {running:['评测中','blue'],passed:['已达标','mint'],failed:['未达标','amber'],error:['运行异常','red']};
const SERVICE_STATUS = {deploying:['部署中','blue'],running:['运行中','mint'],failed:['部署失败','amber'],offline:['已下线','neutral']};
const SCENARIOS = {pass:'达标样例',fail:'未达标样例',error:'运行异常'};
const formatTime = value => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '—';
const sampleCount = version => Array.isArray(version?.records) ? version.records.length : 0;
const versionName = version => `${version?.datasetName||'数据版本'} · ${version?.version||'—'}`;
const labelName = label => typeof label === 'string' ? label : label?.name;
const normalizedLabels = labels => [...new Set((labels||[]).map(labelName).filter(Boolean))].sort();
function compatibleVersion(model,version) {
  if(!model || !version?.id || !sampleCount(version)) return false;
  const labels = normalizedLabels(model.labels);
  if((version.type==='image')!==(model.type==='image'))return false;
  if(!labels.length || (model.type!=='image'&&!version.records.every(row => labels.includes(row.label)))) return false;
  const specification = normalizedLabels(version.specSnapshot?.labels);
  return !Array.isArray(version.specSnapshot?.labels) || JSON.stringify(specification) === JSON.stringify(labels);
}
function Hint({children,tone='neutral'}) {return <div className={`mv-hint mv-hint-${tone}`}><IconInfoCircle size={17}/><span>{children}</span></div>}
function Metric({label,value,suffix='',detail}) {return <div className="mv-stat"><span>{label}</span><strong>{value}{suffix&&<small>{suffix}</small>}</strong>{detail&&<p>{detail}</p>}</div>}
function Meta({items}) {return <dl className="mv-meta mlc-meta">{items.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value??'—'}</dd></div>)}</dl>}
function EvaluationBadge({report}) {const [label,tone]=EVALUATION_STATUS[report?.status]||['待评测','neutral'];return <Badge tone={tone}>{label}</Badge>}
function DataSource({title,version,onNavigate}) {
  return <div className="mlc-source-card"><IconDatabase size={22}/><div><span>{title}</span><strong>{versionName(version)}</strong><small>{version?.projectName||version?.projectId||'当前项目'} · {sampleCount(version)} 条完整样例</small>{version?.count>sampleCount(version)&&<small>预置总量 {version.count} 条；本次仅使用快照内的 {sampleCount(version)} 条样例。</small>}</div><Button variant="ghost" disabled={!version?.id} onClick={()=>onNavigate('datasets',{datasetId:version.datasetId,tab:'versions',versionId:version.id})}>回查数据版本<IconChevronRight size={15}/></Button></div>;
}

export function ModelWarehouseView({modelState,onNavigate,onToast,modelRequest,active=true}) {
  const models=modelState?.models||[], services=modelState?.services||[];
  const [tab,setTab]=useState('trained'),[search,setSearch]=useState(''),[selectedId,setSelectedId]=useState(''),[baseId,setBaseId]=useState('qwen'),[requestError,setRequestError]=useState('');
  const requestSeen=useRef(null);
  const modelIds=models.map(model=>model.id).join('|');
  useEffect(()=>{
    if(!active||modelRequest?.target!=='models'||requestSeen.current===modelRequest.key)return;
    const match=models.find(model=>model.id===modelRequest.modelVersionId);
    requestSeen.current=modelRequest.key;
    if(match){setTab('trained');setSearch('');setSelectedId(match.id);setRequestError('')}
    else if(modelRequest.modelVersionId){setTab('trained');setSearch('');setRequestError(`模型版本 ${modelRequest.modelVersionId} 不在当前会话中，请重新选择。`)}
  },[active,modelRequest,modelIds]);
  const filtered=models.filter(model=>`${model.name} ${model.version} ${model.id} ${model.dataVersion?.datasetName}`.toLowerCase().includes(search.trim().toLowerCase()));
  const model=requestError?null:(filtered.find(item=>item.id===selectedId)||filtered[0]);
  const report=model?getLatestEvaluation(modelState,model.id):null;
  const eligibility=model?getPublishEligibility(modelState,model.id):{ok:false,reason:'先完成训练，生成模型版本。'};
  const linkedServices=model?services.filter(service=>service.modelVersionId===model.id):[];
  const base=BASE_MODELS.find(item=>item.id===baseId)||BASE_MODELS[0];
  return <div className="mlc-page">
    <PageHeader title="模型仓库" description="保留训练产物、评测结论与数据来源"><Button icon={IconPlus} variant="primary" onClick={()=>onNavigate('training')}>新建训练任务</Button></PageHeader>
    {requestError&&<div className="mlc-request-error"><Hint tone="amber">{requestError}</Hint><Button onClick={()=>setRequestError('')}>查看当前模型列表</Button></div>}
    <div className="mlc-page-tabs"><Tabs items={[{id:'trained',label:'训练产物',count:models.length},{id:'base',label:'基础模型目录',count:BASE_MODELS.length}]} value={tab} onChange={setTab}/><Badge tone="amber">本地流程演示</Badge></div>
    {tab==='base'?<div className="mv-split mv-model-split">
      <Panel className="mv-list-panel"><div className="mv-list-caption mlc-list-caption">基础能力 <span>{BASE_MODELS.length}</span></div><div className="mv-item-list">{BASE_MODELS.map(item=><button className={`mv-list-item ${item.id===base.id?'is-selected':''}`} key={item.id} onClick={()=>setBaseId(item.id)}><span className="mv-asset-icon"><IconCpu size={25}/></span><span className="mv-list-copy"><strong>{item.name}</strong><span>{item.type} · {item.size}</span><span><Badge tone="neutral">目录示例</Badge></span></span></button>)}</div><div className="mv-panel-bottom">与本次训练生成的模型版本分别展示</div></Panel>
      <Panel className="mv-detail-panel"><div className="mv-detail-title"><div><div className="mv-kicker">基础模型目录</div><h2>{base.name}</h2><p>{base.description}</p></div><Badge tone="neutral">目录示例</Badge></div><div className="mv-tag-row">{base.tags.map(tag=><span className="mv-tag" key={tag}>{tag}</span>)}</div><Meta items={[["模型类型",base.type],["目录参数规模",base.size],["模型文件","未接入真实权重"],["适用流程",base.id==='qwen'?'文本分类微调':'知识库向量检索']]}/><Hint>目录仅说明基础能力。完成一次本地演示训练后，生成的独立模型版本会进入“训练产物”，再由该版本完成评测与服务发布。</Hint><div className="mv-detail-actions"><Button variant="primary" onClick={()=>onNavigate(base.id==='qwen'?'training':'knowledge')}>{base.id==='qwen'?'创建文本训练任务':'查看知识库分支'}<IconArrowRight size={16}/></Button></div></Panel>
    </div>:models.length===0?<Panel><Empty title="还没有本次训练产物" description="选择已发布的数据版本创建训练任务。任务完成后，模型版本会自动登记到这里，并保留训练和数据来源。"><Button variant="primary" icon={IconPlus} onClick={()=>onNavigate('training')}>创建训练任务</Button></Empty></Panel>:<div className="mv-split mv-model-split">
      <Panel className="mv-list-panel"><div className="mv-list-tools"><Search value={search} onChange={setSearch} placeholder="搜索模型、版本或来源"/></div><div className="mv-list-caption">独立模型版本 <span>{filtered.length}</span></div><div className="mv-item-list">{filtered.map(item=><button key={item.id} className={`mv-list-item ${item.id===model?.id?'is-selected':''}`} onClick={()=>setSelectedId(item.id)}><span className="mv-asset-icon"><IconBox size={25}/></span><span className="mv-list-copy"><strong>{item.name}</strong><span>{item.version} · {versionName(item.dataVersion)}</span><span className="mv-item-bottom"><EvaluationBadge report={getLatestEvaluation(modelState,item.id)}/><small>{item.id}</small></span></span><IconChevronRight size={17}/></button>)}</div>{!filtered.length&&<Empty title="没有匹配的模型" description="调整模型名称或数据来源关键词。"/>}<div className="mv-panel-bottom">每次完成的训练生成独立模型版本</div></Panel>
      {model?<Panel className="mv-detail-panel"><div className="mv-detail-title"><div><div className="mv-kicker">训练产物 / {model.version}</div><h2>{model.name}</h2><p>{model.base} · LoRA 微调 · {formatTime(model.createdAt)}</p></div><EvaluationBadge report={report}/></div><div className="mv-tag-row">{(model.labels||[]).map(label=><span className="mv-tag" key={label}>{label}</span>)}<span className="mv-tag mv-tag-subtle">模拟产物</span></div>
        <DataSource title="训练数据来源" version={model.dataVersion} onNavigate={onNavigate}/>
        <Meta items={[["模型版本编号",model.id],["来源训练任务",model.trainingId],["来源批次",model.dataVersion?.batchId],["冻结规范",model.dataVersion?.specSnapshot?.versionId||'预置样例标签'],["LoRA 秩",model.params?.rank],["训练轮次",model.params?.epochs]]}/>
        <div className="mlc-evaluation-summary"><div className="mv-subheading"><h3>最近一次评测</h3><EvaluationBadge report={report}/></div>{report?<><div className="mlc-summary-line"><strong>{report.id}</strong><span>{versionName(report.dataVersion)} · {sampleCount(report.dataVersion)} 条完整样例</span></div>{report.metrics?<div className="mlc-two-metrics"><Metric label="模拟准确率" value={Number(report.metrics.accuracy).toFixed(1)} suffix="%"/><Metric label="模拟宏平均 F1" value={Number(report.metrics.macroF1).toFixed(1)} suffix="%"/></div>:<p className="mlc-help">{report.status==='running'?`评测进行中 ${report.progress||0}%`:(report.error||'本次没有生成指标，请查看报告原因。')}</p>}<Button variant="ghost" icon={IconChartBar} onClick={()=>onNavigate('evaluation',{modelVersionId:model.id,evaluationId:report.id})}>查看该评测报告</Button></>:<p className="mlc-help">当前模型还没有评测报告。先检查模型在样例数据上的结果，再进入服务发布。</p>}</div>
        {!eligibility.ok&&<Hint tone="amber">{eligibility.reason}</Hint>}
        <div className="mv-detail-actions"><Button icon={IconChartBar} variant="primary" onClick={()=>onNavigate('evaluation',{modelVersionId:model.id})}>{report?'新建评测':'评测这个版本'}</Button><Button disabled={!eligibility.ok} onClick={()=>onNavigate('deployments',{modelVersionId:model.id,evaluationId:eligibility.evaluation?.id,publish:true})}>发布为服务</Button><Button variant="ghost" onClick={()=>onNavigate('training',{trainingId:model.trainingId})}>回查训练任务</Button><Button icon={IconDownload} variant="ghost" onClick={()=>{downloadText(`${model.id}-model-card.json`,JSON.stringify({demo:true,...model},null,2));onToast?.('已生成当前模型版本的说明文件')}}>导出说明</Button></div>
        {linkedServices.length>0&&<div className="mlc-linked-services"><h3>关联服务</h3>{linkedServices.map(service=>{const [label,tone]=SERVICE_STATUS[service.status]||['待处理','neutral'];return <button key={service.id} onClick={()=>onNavigate('deployments',{serviceId:service.id})}><span><strong>{service.name}</strong><small>{service.id} · {service.evaluationId}</small></span><Badge tone={tone}>{label}</Badge><IconChevronRight size={16}/></button>})}</div>}
      </Panel>:<Panel><Empty title="请选择一个模型版本" description="清空搜索后可查看已有训练产物。"/></Panel>}
    </div>}
  </div>;
}

export function ModelEvaluationView({governanceWorkspace,modelState,onModelAction,onNavigate,onToast,versions=[],modelRequest,active=true}) {
  const models=modelState?.models||[],evaluations=modelState?.evaluations||[];
  const [evaluationMode,setEvaluationMode]=useState('independent');
  const [modelId,setModelId]=useState(models[0]?.id||''),[dataVersionId,setDataVersionId]=useState(''),[scenario,setScenario]=useState('pass');
  const [accuracy,setAccuracy]=useState('90'),[macroF1,setMacroF1]=useState('80'),[selectedReportId,setSelectedReportId]=useState(''),[reportTab,setReportTab]=useState('results'),[error,setError]=useState(''),[requestError,setRequestError]=useState('');
  const requestSeen=useRef(null),starting=useRef(false),scenarioControl=useRef(null);
  const modelIds=models.map(model=>model.id).join('|');
  const model=models.find(item=>item.id===modelId)||models[0];
  const compatible=versions.filter(version=>compatibleVersion(model,version));
  const compatibleIds=compatible.map(version=>version.id).join('|');
  const chosenVersion=compatible.find(version=>version.id===dataVersionId);
  const modelReports=evaluations.filter(report=>report.modelVersionId===model?.id);
  const report=requestError?null:(modelReports.find(item=>item.id===selectedReportId)||modelReports[0]);
  const running=modelReports.some(item=>item.status==='running');
  const eligibility=report?getPublishEligibility(modelState,report.modelVersionId,report.id):{ok:false,reason:'尚无评测报告。'};
  const thresholdValid=Number.isFinite(Number(accuracy))&&accuracy.trim()!==''&&Number(accuracy)>=1&&Number(accuracy)<=100&&Number.isFinite(Number(macroF1))&&macroF1.trim()!==''&&Number(macroF1)>=1&&Number(macroF1)<=100;
  useEffect(()=>{setModelId(current=>models.some(item=>item.id===current)?current:models[0]?.id||'')},[modelIds]);
  useEffect(()=>{setDataVersionId(current=>compatible.some(version=>version.id===current)?current:compatible.find(version=>version.id===model?.dataVersionId)?.id||compatible[0]?.id||'')},[model?.id,compatibleIds]);
  useEffect(()=>{
    if(!active||modelRequest?.target!=='evaluation'||requestSeen.current===modelRequest.key)return;
    const requestedReport=evaluations.find(item=>item.id===modelRequest.evaluationId);
    const requestedModel=models.find(item=>item.id===(requestedReport?.modelVersionId||modelRequest.modelVersionId));
    requestSeen.current=modelRequest.key;
    if(modelRequest.evaluationId&&!requestedReport){setRequestError(`评测报告 ${modelRequest.evaluationId} 不在当前会话中，请重新选择。`);return}
    if(modelRequest.modelVersionId&&!requestedModel){setRequestError(`模型版本 ${modelRequest.modelVersionId} 不在当前会话中，请重新选择。`);return}
    if(requestedModel){setModelId(requestedModel.id);setDataVersionId(requestedReport?.dataVersionId||requestedModel.dataVersionId);setSelectedReportId(requestedReport?.id||'');setReportTab('results');setError('');setRequestError('')}
  },[active,modelRequest,modelIds,evaluations]);
  useEffect(()=>{if(!running)starting.current=false},[running]);
  const frozenTaskPlan=model?.dataVersion?.taskPlan||(governanceWorkspace?.governance?.enabled?effectiveCharter(governanceWorkspace,model?.projectId)?.planSnapshot:null);
  useEffect(()=>{if(frozenTaskPlan){setAccuracy(String(frozenTaskPlan.metrics.accuracy));setMacroF1(String(frozenTaskPlan.metrics.macroF1));}},[model?.id,frozenTaskPlan?.id]);
  function changeModel(id){const next=models.find(item=>item.id===id);setModelId(id);setDataVersionId(next?.dataVersionId||'');setSelectedReportId('');setError('');setRequestError('')}
  function start(){
    if(starting.current||running||!model||!chosenVersion||!thresholdValid||requestError)return;
    starting.current=true;
    const result=onModelAction({type:'startEvaluation',modelVersionId:model.id,dataVersionId:chosenVersion.id,scenario,evaluationMode,thresholds:{accuracy:Number(accuracy),macroF1:Number(macroF1)}});
    if(!result.ok){starting.current=false;setError(result.error||'评测未启动，请检查配置。');return}
    setSelectedReportId(result.entity?.id||'');setError('');setReportTab('results');onToast?.('已冻结模型、数据版本与门槛，开始演示评测');
  }
  function copyReport(){
    if(!report)return;
    setModelId(report.modelVersionId);setDataVersionId(report.dataVersionId);setAccuracy(String(report.thresholds?.accuracy??90));setMacroF1(String(report.thresholds?.macroF1??80));setScenario(report.scenario);setEvaluationMode(report.acceptanceSnapshot?.integrity.mode||'independent');setError('');scenarioControl.current?.focus();onToast?.('已载入报告配置，调整演示场景后可运行一次新评测');
  }
  return <div className="mlc-page">
    {model?.type==='image'&&<Hint tone="amber">图像评测按冻结标注回放验证，展示标注一致率；没有执行图像推理，不能作为真实检测 mAP 或 IoU 指标。</Hint>}
    <PageHeader title="模型评测" description="冻结评测输入与门槛，保留每一次结果"><Badge tone="amber">本地流程演示</Badge></PageHeader>
    {requestError&&<div className="mlc-request-error"><Hint tone="amber">{requestError}</Hint><Button onClick={()=>setRequestError('')}>查看当前模型记录</Button></div>}
    {!models.length?<Panel><Empty title="先完成一次训练" description="训练完成后会生成独立模型版本，再使用已发布的数据快照进行评测。"><Button variant="primary" icon={IconPlus} onClick={()=>onNavigate('training')}>创建训练任务</Button></Empty></Panel>:<div className="mlc-evaluation-layout">
      <Panel title="评测配置" description="本次运行后保存为独立报告" className="mlc-config-panel">
        <div className="mv-form-stack">
          <Field label="模型版本"><select value={model?.id||''} onChange={event=>changeModel(event.target.value)}>{models.map(item=><option key={item.id} value={item.id}>{item.name} · {item.version} · {item.id}</option>)}</select></Field>
          <Field label="评测数据版本" hint="仅列出标签兼容的已发布版本"><select value={dataVersionId} onChange={event=>{setDataVersionId(event.target.value);setError('')}} disabled={running}>{!compatible.length&&<option value="">暂无兼容的已发布版本</option>}{compatible.map(version=><option key={version.id} value={version.id}>{versionName(version)} · {sampleCount(version)} 条样例</option>)}</select></Field>
          {chosenVersion&&<div className="mlc-config-source"><strong>{sampleCount(chosenVersion)} 条完整样例参与计算</strong><span>{chosenVersion.batchId}</span><span>{chosenVersion.id}</span></div>}
          {chosenVersion?.id===model?.dataVersionId&&<Hint tone="amber">评测与训练引用同一数据版本，仅用于回放和流程验证，不能作为泛化质量结论。</Hint>}
          <Field label="演示结果场景" hint="场景控制模拟预测，不是实际模型推理结果"><select ref={scenarioControl} value={scenario} onChange={event=>{setScenario(event.target.value);setError('')}} disabled={running}><option value="pass">达标样例</option><option value="fail">未达标样例</option><option value="error">运行异常</option></select></Field>
          {frozenTaskPlan&&<Hint>指标固定来自任务 {frozenTaskPlan.id} · R{frozenTaskPlan.revision}，不可放宽；评测数据须引用同一指标版本。</Hint>}<div className="mlc-threshold-heading"><h3>发布门槛</h3><span>两项均需达标</span></div>
          <div className="mlc-threshold-grid"><Field label="准确率下限（%）"><input type="number" min="1" max="100" step="1" value={accuracy} disabled={running||!!frozenTaskPlan} onChange={event=>setAccuracy(event.target.value)}/></Field><Field label="宏平均 F1 下限（%）"><input type="number" min="1" max="100" step="1" value={macroF1} disabled={running||!!frozenTaskPlan} onChange={event=>setMacroF1(event.target.value)}/></Field></div>
          {!thresholdValid&&<p className="mlc-form-error" role="alert">请填写 1–100 范围内的有效门槛。</p>}
          {error&&<p className="mlc-form-error" role="alert">{error}</p>}
          <EvaluationIntegrityPanel w={governanceWorkspace} model={model} version={chosenVersion} mode={evaluationMode} onModeChange={setEvaluationMode} onNavigate={onNavigate}/><Button variant="primary" icon={IconPlayerPlay} loading={running} disabled={!chosenVersion||!thresholdValid||!!requestError} onClick={start}>{running?'本模型正在评测':'运行演示评测'}</Button>
          <p className="mlc-help">修改配置用于下一次评测；已有报告保存原模型、数据版本、场景和门槛。每个模型的新发布以最近一次评测为准。</p>
        </div>
      </Panel>
      <div className="mlc-report-column">
        <Panel title="评测报告" description={`${modelReports.length} 次记录 · 切换可回查原配置`} actions={<IconHistory size={20}/>} className="mlc-report-panel">
          {modelReports.length>0&&<Field label="查看评测记录"><select value={report?.id||''} onChange={event=>{setSelectedReportId(event.target.value);setReportTab('results')}}>{modelReports.map((item,index)=><option key={item.id} value={item.id}>{index===0?'最新 · ':''}{item.id} · {EVALUATION_STATUS[item.status]?.[0]||item.status} · {formatTime(item.createdAt)}</option>)}</select></Field>}
          {!report?<Empty title="等待首次评测" description="确认左侧模型、数据版本与发布门槛后运行评测。每次结果都会保留为独立报告。"/>:<>
            <div className="mlc-report-heading"><div><span>{report.id} · {SCENARIOS[report.scenario]||'模拟结果'}</span><h2>{report.modelSnapshot?.name||model.name} <small>{report.modelSnapshot?.version||model.version}</small></h2><p>{versionName(report.dataVersion)} · {sampleCount(report.dataVersion)} 条完整样例</p></div><EvaluationBadge report={report}/></div>
            {report.status==='running'?<div className="mlc-running-report" role="status"><IconRefresh size={30} className="spin"/><div><strong>评测进行中 · {report.progress||0}%</strong><p>使用已冻结的模型、数据与门槛生成模拟预测并汇总指标。</p></div><div className="mv-progress-track"><div style={{width:`${report.progress||0}%`}}/></div></div>:report.status==='error'?<div className="mlc-result-alert" role="status"><IconInfoCircle size={24}/><div><strong>评测运行异常</strong><p>{report.error||'模拟评测未能完成，本次没有生成可发布的结果。'}</p><span>本次异常记录保留。调整演示场景后可重新运行，生成新的评测报告。</span></div></div>:<>
              <div className="mlc-metric-grid"><Metric label="模拟准确率" value={Number(report.metrics?.accuracy??0).toFixed(1)} suffix="%" detail={`门槛 ≥ ${report.thresholds?.accuracy}%`}/><Metric label="模拟宏平均 F1" value={Number(report.metrics?.macroF1??0).toFixed(1)} suffix="%" detail={`门槛 ≥ ${report.thresholds?.macroF1}%`}/><Metric label="精确率" value={Number(report.metrics?.precision??0).toFixed(1)} suffix="%"/><Metric label="召回率" value={Number(report.metrics?.recall??0).toFixed(1)} suffix="%"/></div>
              <div className={`mlc-gate-result ${report.status==='passed'?'is-passed':'is-failed'}`}>{report.status==='passed'?<IconCheck size={19}/>:<IconX size={19}/>}<span>{report.status==='passed'?'本报告的两项模拟指标均达到冻结门槛。':'本报告未达到冻结门槛，不能用于发布服务。'}</span></div>
            </>}
            <Tabs items={[{id:'results',label:'逐条结果',count:report.rows?.length||0},{id:'source',label:'配置与来源'}]} value={reportTab} onChange={setReportTab}/>
            {reportTab==='results'?report.rows?.length?<div className="mlc-result-table"><table><thead><tr><th>样本文本</th><th>人工标签</th><th>模拟预测</th><th>结果</th></tr></thead><tbody>{report.rows.map((row,index)=><tr key={`${row.id}-${index}`}><td><small>{row.id}</small><p>{row.text}</p></td><td><Badge dot={false} tone="neutral">{row.truth}</Badge></td><td><Badge dot={false} tone={row.correct?'mint':'amber'}>{row.predicted}</Badge></td><td><span className={row.correct?'mlc-correct':'mlc-incorrect'}>{row.correct?<IconCheck size={16}/>:<IconX size={16}/>}<span>{row.correct?'一致':'不一致'}</span></span></td></tr>)}</tbody></table></div>:<p className="mlc-no-results">{report.status==='running'?'评测完成后展示本次逐条模拟预测。':'本次没有逐条结果，请查看异常原因并重新评测。'}</p>:<div className="mlc-report-source"><Meta items={[["模型版本编号",report.modelVersionId],["模型来源训练",report.modelSnapshot?.trainingId],["训练数据版本",versionName(report.modelSnapshot?.dataVersion)],["评测数据版本编号",report.dataVersionId],["评测批次",report.dataVersion?.batchId],["实际评测样例",`${sampleCount(report.dataVersion)} 条`],["演示结果场景",SCENARIOS[report.scenario]],["冻结发布门槛",`准确率 ≥ ${report.thresholds?.accuracy}%；宏平均 F1 ≥ ${report.thresholds?.macroF1}%`],["开始时间",formatTime(report.createdAt)],["完成时间",formatTime(report.completedAt)]]}/><div className="mlc-source-actions"><Button onClick={()=>onNavigate('models',{modelVersionId:report.modelVersionId})}>回查模型版本</Button><Button onClick={()=>onNavigate('training',{trainingId:report.modelSnapshot?.trainingId})}>回查训练任务</Button><Button onClick={()=>onNavigate('datasets',{datasetId:report.dataVersion.datasetId,tab:'versions',versionId:report.dataVersionId})}>回查评测数据</Button><Button onClick={()=>onNavigate('datasets',{datasetId:report.modelSnapshot?.dataVersion?.datasetId,tab:'versions',versionId:report.modelSnapshot?.dataVersionId})}>回查训练数据</Button></div></div>}
            <AcceptanceSnapshot report={report}/>{report.sameSource&&<p className="mlc-help mlc-same-source">同源数据回放 · 当前指标仅说明演示预测与样例标签的匹配情况。</p>}
            {!eligibility.ok&&report.status!=='running'&&<Hint tone="amber">{eligibility.reason}</Hint>}
            <div className="mv-detail-actions"><Button variant="primary" disabled={!eligibility.ok} onClick={()=>onNavigate('deployments',{modelVersionId:report.modelVersionId,evaluationId:report.id,publish:true})}>发布为服务<IconArrowRight size={16}/></Button><Button disabled={running} onClick={copyReport}>复制配置重评</Button><Button icon={IconDownload} variant="ghost" disabled={report.status==='running'} onClick={()=>{downloadText(`${report.id}-evaluation.json`,JSON.stringify({demo:true,...report},null,2));onToast?.('已生成当前评测报告，包含冻结配置与逐条结果')}}>导出报告</Button></div>
          </>}
        </Panel>
        <p className="mlc-report-footnote">所有预测与指标来自本地演示场景；模型权重、推理执行与独立验证集尚未接入。报告记录时间为 UTC+08:00。</p>
      </div>
    </div>}
  </div>;
}
