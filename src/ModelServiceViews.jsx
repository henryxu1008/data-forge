import React, {useEffect, useRef, useState} from 'react';
import {IconPlus, IconCpu, IconDatabase, IconChartBar, IconPlayerPlay, IconRefresh, IconX, IconHistory, IconInfoCircle, IconChevronRight, IconSend, IconDownload, IconCheck} from '@tabler/icons-react';
import {Button, Badge, PageHeader, Panel, Tabs, Field, Modal, Search, Empty, downloadText} from './ui.jsx';
import {getLatestEvaluation, getPublishEligibility} from './model-lifecycle-state.js';
import './model-service-views.css';

const EMPTY_STATE={models:[],trainings:[],evaluations:[],services:[],calls:[]};
const SERVICE_STATUS={deploying:['部署中','blue'],running:['运行中','mint'],failed:['部署失败','amber'],offline:['已下线','neutral']};
const CALL_STATUS={succeeded:['成功','mint'],rejected:['拒绝','amber'],failed:['运行错误','amber']};
const REPORT_STATUS={running:'评测中',passed:'已达标',failed:'未达标',error:'运行异常'};
const atTime=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
const versionName=version=>version?`${version.datasetName||version.name||'数据集'} · ${version.version||'已发布版本'}`:'—';
const modelName=model=>model?`${model.name} · ${model.version}`:'—';
const recordCount=version=>version?.records?.length||0;

function ServiceBadge({status}){const value=SERVICE_STATUS[status]||['待确认','neutral'];return <Badge tone={value[1]}>{value[0]}</Badge>}
function AttemptBadge({status}){return <Badge tone={status==='running'?'mint':status==='failed'?'amber':'blue'}>{status==='running'?'部署成功':status==='failed'?'部署失败':'部署中'}</Badge>}
function CallBadge({status}){const value=CALL_STATUS[status]||['待确认','neutral'];return <Badge tone={value[1]}>{value[0]}</Badge>}
function Hint({children,tone='neutral'}){return <div className={`mv-hint mv-hint-${tone}`}><IconInfoCircle size={16}/><span>{children}</span></div>}
function InlineError({children}){return children?<div className="msv-error" role="alert"><IconInfoCircle size={17}/><span>{children}</span></div>:null}
function Stat({label,value,detail}){return <div className="mv-stat"><span>{label}</span><strong>{value}</strong><p>{detail}</p></div>}
function SourceCard({icon:Icon,label,title,detail,onClick}){return <button type="button" className="msv-source-card" onClick={onClick}><span className="msv-source-icon"><Icon size={18}/></span><span><small>{label}</small><strong>{title}</strong><span>{detail}</span></span><IconChevronRight size={15}/></button>}
function Lineage({service,modelState,onNavigate}){
  const training=modelState.trainings.find(item=>item.id===service.trainingId);
  const model=service.modelSnapshot;
  const data=service.dataVersion;
  return <div className="msv-lineage">
    <SourceCard icon={IconCpu} label="模型版本" title={modelName(model)} detail={service.modelVersionId} onClick={()=>onNavigate('models',{modelVersionId:service.modelVersionId})}/>
    <SourceCard icon={IconChartBar} label="发布依据" title={`评测 ${service.evaluationId}`} detail="发布时已达标 · 报告快照固定" onClick={()=>onNavigate('evaluation',{modelVersionId:service.modelVersionId,evaluationId:service.evaluationId})}/>
    <SourceCard icon={IconHistory} label="训练任务" title={training?.name||service.trainingId} detail={service.trainingId} onClick={()=>onNavigate('training',{trainingId:service.trainingId})}/>
    <SourceCard icon={IconDatabase} label="训练数据版本" title={versionName(data)} detail={`${recordCount(data)} 条快照记录 · ${service.dataVersionId}`} onClick={()=>onNavigate('datasets',{datasetId:data?.datasetId,tab:'versions',versionId:service.dataVersionId})}/>
  </div>;
}

export function ModelDeploymentView({governanceWorkspace,modelState=EMPTY_STATE,onModelAction,onNavigate,onToast,modelRequest,active=true}){
  const {services=[],models=[],calls=[]}=modelState;
  const [selectedId,setSelectedId]=useState(''),[search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[tab,setTab]=useState('overview');
  const [publishOpen,setPublishOpen]=useState(false),[draft,setDraft]=useState({modelVersionId:'',evaluationId:'',name:'',note:'',scenario:'success'});
  const [offlineId,setOfflineId]=useState(''),[offlineNote,setOfflineNote]=useState('');
  const [retryId,setRetryId]=useState(''),[retryScenario,setRetryScenario]=useState('success');
  const [error,setError]=useState(''),[requestError,setRequestError]=useState('');
  const seenRequest=useRef(null),actionLock=useRef(false);
  const serviceIds=services.map(item=>item.id).join('|');
  const visible=services.filter(item=>(filter==='all'||item.status===filter)&&`${item.name} ${item.id} ${modelName(item.modelSnapshot)}`.toLowerCase().includes(search.toLowerCase()));
  const service=requestError?null:(visible.find(item=>item.id===selectedId)||visible[0]);
  const selectedModel=models.find(item=>item.id===draft.modelVersionId);
  const pinnedReport=modelState.evaluations.find(item=>item.id===draft.evaluationId);
  const latestReport=selectedModel?getLatestEvaluation(modelState,selectedModel.id):null;
  const gate=getPublishEligibility(modelState,draft.modelVersionId,draft.evaluationId);
  const selectedCalls=service?calls.filter(item=>item.serviceId===service.id):[];
  const retryService=services.find(item=>item.id===retryId),offlineService=services.find(item=>item.id===offlineId);
  const retryGate=retryService?getPublishEligibility(modelState,retryService.modelVersionId,retryService.evaluationId):{ok:false,reason:'未选择服务'};

  function openPublish(modelVersionId,evaluationId,previousService){
    const preferred=models.find(item=>item.id===modelVersionId)||(!modelVersionId?(models.find(item=>getPublishEligibility(modelState,item.id).ok)||models[0]):null);
    const report=evaluationId?modelState.evaluations.find(item=>item.id===evaluationId):preferred?getLatestEvaluation(modelState,preferred.id):null;
    setDraft({modelVersionId:preferred?.id||'',evaluationId:report?.id||'',name:preferred?`${preferred.name} · 服务 ${services.filter(item=>item.modelVersionId===preferred.id).length+1}`:'',note:previousService?`重新发布 ${previousService.name}，保留原服务的下线记录。`:'',scenario:'success'});
    setError(modelVersionId&&!preferred?'未找到所选模型版本，请返回模型仓库重新选择。':'');setPublishOpen(true);actionLock.current=false;
  }
  useEffect(()=>{setSelectedId(current=>services.some(item=>item.id===current)?current:services[0]?.id||'')},[serviceIds]);
  useEffect(()=>{
    if(!active||modelRequest?.target!=='deployments'||seenRequest.current===modelRequest.key)return;
    seenRequest.current=modelRequest.key;setPublishOpen(false);setOfflineId('');setRetryId('');setSearch('');setFilter('all');setRequestError('');setError('');setTab('overview');
    if(modelRequest.serviceId){
      const found=services.find(item=>item.id===modelRequest.serviceId);
      if(found)setSelectedId(found.id);else setRequestError(`服务 ${modelRequest.serviceId} 已不存在于当前会话。`);
    }else if(modelRequest.modelVersionId&&!modelRequest.publish){
      const found=services.find(item=>item.modelVersionId===modelRequest.modelVersionId);
      if(found)setSelectedId(found.id);else setRequestError('该模型尚无服务发布记录。可以选择该模型的最新达标评测创建新服务。');
    }
    if(modelRequest.publish)openPublish(modelRequest.modelVersionId,modelRequest.evaluationId);
  },[active,modelRequest,serviceIds]);

  function selectModel(modelVersionId){
    const model=models.find(item=>item.id===modelVersionId),report=getLatestEvaluation(modelState,modelVersionId);
    setDraft(previous=>({...previous,modelVersionId,evaluationId:report?.id||'',name:model?`${model.name} · 服务 ${services.filter(item=>item.modelVersionId===model.id).length+1}`:''}));setError('');
  }
  function publish(){
    if(actionLock.current||!gate.ok||!draft.name.trim()||!draft.note.trim())return;
    actionLock.current=true;
    const result=onModelAction({type:'publishService',...draft,name:draft.name.trim(),note:draft.note.trim()});
    if(!result.ok){setError(result.error);actionLock.current=false;return}
    setSelectedId(result.entity.id);setSearch('');setFilter('all');setRequestError('');setTab('overview');setPublishOpen(false);onToast?.('已创建服务发布记录，正在演示部署');
  }
  function offline(){
    if(actionLock.current||!offlineService||!offlineNote.trim())return;
    actionLock.current=true;
    const result=onModelAction({type:'offlineService',serviceId:offlineService.id,note:offlineNote.trim()});
    if(!result.ok){setError(result.error);actionLock.current=false;return}
    setOfflineId('');setError('');onToast?.('服务已下线，新的测试请求将被拒绝');
  }
  function retry(){
    if(actionLock.current||!retryService||!retryGate.ok)return;
    actionLock.current=true;
    const result=onModelAction({type:'retryDeployment',serviceId:retryService.id,scenario:retryScenario});
    if(!result.ok){setError(result.error);actionLock.current=false;return}
    setRetryId('');setError('');setTab('history');onToast?.('已创建新的部署尝试，原失败记录保留');
  }
  const chooseService=id=>{setSelectedId(id);setRequestError('');setError('');setTab('overview')};

  return <div className="msv-root">
    <PageHeader title="服务发布" description="将通过评测的模型版本发布为可追溯的服务"><Button icon={IconPlus} variant="primary" disabled={!models.length} onClick={()=>openPublish()}>发布模型服务</Button></PageHeader>
    <div className="mv-summary-grid"><Stat label="服务记录" value={services.length} detail="每次发布独立保存"/><Stat label="运行中" value={services.filter(item=>item.status==='running').length} detail="可发送本地测试请求"/><Stat label="部署中 / 失败" value={services.filter(item=>item.status==='deploying'||item.status==='failed').length} detail="查看进度或重试原因"/><Stat label="已下线" value={services.filter(item=>item.status==='offline').length} detail="历史与调用来源保留"/></div>
    <InlineError>{requestError}</InlineError>
    {!models.length&&!services.length?<Panel><Empty title="先生成并评测一个模型版本" description="完成训练后，在模型仓库选择该产物运行评测。最新报告达标后，即可创建服务发布记录。"><Button variant="primary" onClick={()=>onNavigate('training')}>创建训练任务</Button></Empty></Panel>:<div className="mv-split msv-service-split">
      <Panel className="mv-list-panel">
        <div className="mv-list-tools"><Search value={search} onChange={value=>{setSearch(value);setRequestError('')}} placeholder="搜索服务或模型"/><select aria-label="服务状态筛选" value={filter} onChange={event=>{setFilter(event.target.value);setRequestError('')}}><option value="all">全部状态</option><option value="running">运行中</option><option value="deploying">部署中</option><option value="failed">部署失败</option><option value="offline">已下线</option></select></div>
        <div className="mv-list-caption">模型服务 <span>{visible.length}</span></div>
        <div className="mv-item-list">{visible.map(item=><button key={item.id} className={`mv-training-item ${service?.id===item.id?'is-selected':''}`} onClick={()=>chooseService(item.id)}><div><strong>{item.name}</strong><ServiceBadge status={item.status}/></div><p>{modelName(item.modelSnapshot)}</p><small><span>{item.id}</span><span>{item.attempts.length} 次部署</span></small></button>)}</div>
        {!visible.length&&<Empty title={services.length?'没有匹配的服务':'尚未发布模型服务'} description={services.length?'调整搜索词或状态筛选。':'选择最新评测已达标的模型，创建第一个发布记录。'}/>}
        <div className="mv-panel-bottom">本地模拟服务 · 不生成公网端点</div>
      </Panel>
      <Panel className="mv-detail-panel">
        {!service?<Empty title="选择一个服务记录" description="查看发布依据、部署历史和调用来源。"/>:<>
          <div className="mv-detail-title"><div><div className="mv-kicker">本地模拟服务 / {service.id}</div><h2>{service.name}</h2><p>{modelName(service.modelSnapshot)}</p></div><ServiceBadge status={service.status}/></div>
          <Tabs items={[{id:'overview',label:'发布概况'},{id:'history',label:'部署历史',count:service.attempts.length},{id:'calls',label:'调用记录',count:selectedCalls.length}]} value={tab} onChange={setTab}/>
          {tab==='overview'&&<div className="mv-tab-content">
            <div className={`msv-state-card msv-state-${service.status}`} role="status"><div><strong>{service.status==='running'?'服务已就绪':service.status==='failed'?'本次部署未成功':service.status==='offline'?'服务已停止接收请求':'正在部署模型服务'}</strong><p>{service.status==='running'?'可进入在线测试，验证该服务的调用与来源。':service.status==='failed'?(service.lastError||service.attempts.at(-1)?.error||'模拟部署失败，请查看部署历史后重试。'):service.status==='offline'?`下线原因：${service.offlineReason||'—'}`:'正在演示配置校验与服务启动，完成后可进行在线测试。'}</p></div>{service.status==='running'?<IconCheck size={22}/>:service.status==='deploying'?<IconRefresh className="spin" size={21}/>:<IconInfoCircle size={22}/>}</div>
            {service.status==='deploying'&&<div className="msv-deploy-progress"><div className="mv-progress-heading"><strong>部署进度</strong><span>{service.progress}%</span></div><div className="mv-progress-track"><div style={{width:`${service.progress}%`}}/></div></div>}
            <div className="msv-main-actions">
              {service.status==='running'&&<><Button variant="primary" icon={IconPlayerPlay} onClick={()=>onNavigate('testing',{serviceId:service.id})}>在线测试</Button><Button className="msv-offline-action" icon={IconX} onClick={()=>{setOfflineId(service.id);setOfflineNote('');setError('');actionLock.current=false}}>下线服务</Button></>}
              {service.status==='failed'&&<><Button variant="primary" icon={IconRefresh} onClick={()=>{setRetryId(service.id);setRetryScenario('success');setError('');actionLock.current=false}}>重试部署</Button><Button onClick={()=>setTab('history')}>查看失败记录</Button></>}
              {service.status==='offline'&&<><Button onClick={()=>onNavigate('testing',{serviceId:service.id})}>验证下线拒绝</Button><Button variant="primary" onClick={()=>openPublish(service.modelVersionId,undefined,service)}>重新发布</Button></>}
            </div>
            <div className="mv-subheading"><h3>发布来源</h3><span className="mv-muted">按发布时版本固定</span></div><Lineage service={service} modelState={modelState} onNavigate={onNavigate}/>
            <dl className="mv-meta"><div><dt>发布说明</dt><dd>{service.releaseNote}</dd></div><div><dt>创建时间 · UTC+08:00</dt><dd>{atTime(service.createdAt)}</dd></div>{service.offlineAt&&<><div><dt>下线时间 · UTC+08:00</dt><dd>{atTime(service.offlineAt)}</dd></div><div><dt>下线原因</dt><dd>{service.offlineReason}</dd></div></>}</dl>
            <div className="msv-main-actions"><Button disabled={service.status!=='running'} onClick={()=>onNavigate('ai-annotation',{modelVersionId:service.modelVersionId,serviceId:service.id})}>返回 AI 标注使用此模型</Button></div><Hint>服务使用发布时固定的模型、评测与数据来源。后续评测不会改写这条记录；下线后历史仍可回查。本页不执行真实部署或推理。</Hint>
          </div>}
          {tab==='history'&&<div className="mv-tab-content"><div className="msv-attempt-list">{service.attempts.map((attempt,index)=><article key={attempt.id} className="msv-attempt"><div className="msv-attempt-title"><strong>第 {index+1} 次部署</strong><AttemptBadge status={attempt.status}/></div><p>{attempt.id} · {atTime(attempt.startedAt)}</p><div className="msv-attempt-meta"><span>演示场景：{attempt.scenario==='fail'?'部署失败':'正常部署'}</span><span>{attempt.endedAt?`结束：${atTime(attempt.endedAt)}`:`进度：${attempt.progress}%`}</span></div>{attempt.error&&<div className="msv-attempt-error">{attempt.error}</div>}</article>)}</div>{service.status==='failed'&&<div className="msv-main-actions"><Button variant="primary" icon={IconRefresh} onClick={()=>{setRetryId(service.id);setRetryScenario('success');setError('');actionLock.current=false}}>重试部署</Button></div>}<Hint>每次重试新增一条尝试记录；原失败原因与开始、结束时间保持不变。</Hint></div>}
          {tab==='calls'&&<div className="mv-tab-content">{selectedCalls.length?<div className="mv-table-wrap"><table className="mv-table"><thead><tr><th>调用编号 / 时间</th><th>请求内容</th><th>调用时服务状态</th><th>结果</th></tr></thead><tbody>{selectedCalls.map(call=><tr key={call.id}><td><strong>{call.id}</strong><small className="msv-table-time">{atTime(call.at)}</small></td><td className="msv-request-cell">{call.input}</td><td>{SERVICE_STATUS[call.serviceStatus]?.[0]||call.serviceStatus}</td><td><CallBadge status={call.status}/></td></tr>)}</tbody></table></div>:<Empty title="这条服务尚无调用" description="在在线测试发送请求后，将记录调用结果与当时的服务状态。"/>}<div className="msv-main-actions"><Button onClick={()=>onNavigate('testing',{serviceId:service.id})}>打开在线测试</Button></div></div>}
        </>}
      </Panel>
    </div>}
    {active&&publishOpen&&<Modal title="发布模型服务" description="确认模型与评测来源，创建独立的服务发布记录。" wide onClose={()=>setPublishOpen(false)} footer={<><Button onClick={()=>setPublishOpen(false)}>取消</Button><Button variant="primary" icon={IconPlayerPlay} disabled={!gate.ok||!draft.name.trim()||!draft.note.trim()} onClick={publish}>确认发布</Button></>}>
      <div className="mv-form-stack"><InlineError>{error}</InlineError>{governanceWorkspace?.governance?.enabled&&selectedModel&&<Hint tone="amber">发布前需由当前立项的质量负责人记录该报告的模拟验收。<Button onClick={()=>{setPublishOpen(false);onNavigate('governance',{projectId:selectedModel.projectId,tab:'evidence',evaluationId:draft.evaluationId})}}>前往质量验收</Button></Hint>}<Field label="模型版本" required><select value={draft.modelVersionId} onChange={event=>selectModel(event.target.value)}>{!selectedModel&&<option value="">请选择模型版本</option>}{models.map(model=><option key={model.id} value={model.id}>{modelName(model)} · {model.id}</option>)}</select></Field>
        <div className={`msv-publish-gate ${gate.ok?'is-ready':''}`}><div><strong>{gate.ok?'发布条件已满足':'当前不能发布'}</strong><p>{gate.ok?`已确认最新评测 ${draft.evaluationId} 达标。`:gate.reason||'请先选择一个模型版本并完成评测。'}</p></div>{gate.ok?<IconCheck size={22}/>:<IconInfoCircle size={22}/>}</div>
        {selectedModel&&<div className="msv-release-source"><span>训练来源：{selectedModel.trainingId}</span><span>数据版本：{versionName(selectedModel.dataVersion)} · {selectedModel.dataVersionId}</span><span>选定评测：{pinnedReport?`${pinnedReport.id} · ${REPORT_STATUS[pinnedReport.status]||pinnedReport.status}`:'尚无报告'}</span>{pinnedReport?.sameSource&&<span className="msv-amber-text">本报告为训练数据同源回放，仅验证演示流程，不代表泛化质量。</span>}</div>}
        {!gate.ok&&selectedModel&&<div className="msv-inline-actions">{latestReport&&latestReport.id!==draft.evaluationId&&<Button onClick={()=>{setDraft(previous=>({...previous,evaluationId:latestReport.id}));setError('')}}>改用最新评测</Button>}<Button variant="ghost" onClick={()=>{setPublishOpen(false);onNavigate('evaluation',{modelVersionId:selectedModel.id,...(pinnedReport?{evaluationId:pinnedReport.id}:{})})}}>前往模型评测</Button></div>}
        <Field label="服务名称" required><input value={draft.name} maxLength={100} onChange={event=>setDraft(previous=>({...previous,name:event.target.value}))} placeholder="为本次发布命名"/></Field><Field label="发布说明" required><textarea value={draft.note} maxLength={600} onChange={event=>setDraft(previous=>({...previous,note:event.target.value}))} placeholder="说明本次发布的用途及评测依据"/></Field><Field label="部署演示场景"><select value={draft.scenario} onChange={event=>setDraft(previous=>({...previous,scenario:event.target.value}))}><option value="success">正常部署</option><option value="fail">部署失败，验证重试流程</option></select></Field><Hint>只建立当前会话中的模拟服务，不创建真实端点或凭据。部署失败后可以重试，原发布来源保持固定。</Hint>
      </div>
    </Modal>}
    {active&&offlineService&&<Modal title="下线模型服务" description={offlineService.name} onClose={()=>setOfflineId('')} footer={<><Button onClick={()=>setOfflineId('')}>取消</Button><Button className="msv-offline-action" variant="primary" disabled={!offlineNote.trim()} onClick={offline}>确认下线</Button></>}><div className="mv-form-stack"><InlineError>{error}</InlineError><Hint tone="amber">下线后，新测试请求会被拒绝。发布来源、部署历史和已有调用记录仍然保留。</Hint><Field label="下线原因" required><textarea value={offlineNote} maxLength={600} onChange={event=>setOfflineNote(event.target.value)} placeholder="填写下线原因，便于后续回查"/></Field><div className="msv-release-source"><span>服务编号：{offlineService.id}</span><span>模型版本：{modelName(offlineService.modelSnapshot)}</span></div></div></Modal>}
    {active&&retryService&&<Modal title="重试模型部署" description={retryService.name} onClose={()=>setRetryId('')} footer={<><Button onClick={()=>setRetryId('')}>取消</Button><Button variant="primary" icon={IconRefresh} disabled={!retryGate.ok} onClick={retry}>开始重试</Button></>}><div className="mv-form-stack"><InlineError>{error}</InlineError><Hint tone="amber">原失败：{retryService.lastError||retryService.attempts.at(-1)?.error||'模拟部署未成功'}。这次重试将新增部署记录。</Hint>{!retryGate.ok&&<InlineError>{retryGate.reason}</InlineError>}<div className="msv-release-source"><span>模型版本：{modelName(retryService.modelSnapshot)}</span><span>评测依据：{retryService.evaluationId}</span></div><Field label="重试演示场景"><select value={retryScenario} onChange={event=>setRetryScenario(event.target.value)}><option value="success">正常部署</option><option value="fail">再次模拟部署失败</option></select></Field>{!retryGate.ok&&<Button onClick={()=>{setRetryId('');openPublish(retryService.modelVersionId)}}>按最新评测重新发布</Button>}</div></Modal>}
  </div>;
}

export function ModelTestingView({modelState=EMPTY_STATE,onModelAction,onNavigate,onToast,modelRequest,active=true}){
  const {services=[],calls=[]}=modelState;
  const [selectedId,setSelectedId]=useState(''),[selectedCallId,setSelectedCallId]=useState('');
  const [drafts,setDrafts]=useState({}),[error,setError]=useState(''),[requestError,setRequestError]=useState('');
  const seenRequest=useRef(null);
  const serviceIds=services.map(item=>item.id).join('|');
  const service=requestError?null:(services.find(item=>item.id===selectedId)||services.find(item=>item.status==='running')||services[0]);
  const serviceCalls=service?calls.filter(call=>call.serviceId===service.id):[];
  const selectedCall=serviceCalls.find(call=>call.id===selectedCallId)||serviceCalls[0];
  const draft=drafts[service?.id]||{input:'订单已经发货三天，想了解配送进度。',scenario:'success'};
  const updateDraft=patch=>{if(service)setDrafts(previous=>({...previous,[service.id]:{...draft,...patch}}));setError('')};
  useEffect(()=>{setSelectedId(current=>services.some(item=>item.id===current)?current:(services.find(item=>item.status==='running')||services[0])?.id||'')},[serviceIds]);
  useEffect(()=>{
    if(!active||modelRequest?.target!=='testing'||seenRequest.current===modelRequest.key)return;
    seenRequest.current=modelRequest.key;setError('');setRequestError('');setSelectedCallId('');
    if(modelRequest.serviceId){const found=services.find(item=>item.id===modelRequest.serviceId);if(found)setSelectedId(found.id);else setRequestError(`服务 ${modelRequest.serviceId} 已不存在于当前会话。`)}
    else if(modelRequest.modelVersionId){const found=services.find(item=>item.modelVersionId===modelRequest.modelVersionId&&item.status==='running')||services.find(item=>item.modelVersionId===modelRequest.modelVersionId);if(found)setSelectedId(found.id);else setRequestError('该模型尚无发布服务，请先完成评测和服务发布。')}
  },[active,modelRequest,serviceIds]);
  function send(){
    if(!service||!draft.input.trim())return;
    const result=onModelAction({type:'invokeService',serviceId:service.id,input:draft.input.trim(),scenario:draft.scenario});
    if(result.entity){setSelectedCallId(result.entity.id);setError('');onToast?.(result.ok?'本地测试完成，来源已记录':result.error||'测试请求被拒绝',result.ok?'success':'warning')}
    else setError(result.error||'无法创建测试请求，请重新选择服务。');
  }
  return <div className="msv-root">
    <PageHeader title="在线测试" description="验证指定服务的调用结果与发布来源"><Badge tone="amber">本地模拟</Badge></PageHeader>
    <InlineError>{requestError}</InlineError>
    {!services.length?<Panel><Empty title="还没有可测试的服务" description="从模型评测发布服务后，可以验证成功调用、运行错误和下线拒绝。"><Button variant="primary" onClick={()=>onNavigate('deployments')}>前往服务发布</Button></Empty></Panel>:<div className="mv-split msv-testing-split">
      <Panel title="测试配置" description="每次请求固定记录当前服务来源" className="mv-config-panel"><div className="mv-form-stack">
        <Field label="模型服务"><select value={service?.id||''} onChange={event=>{setSelectedId(event.target.value);setSelectedCallId('');setError('');setRequestError('')}}>{!service&&<option value="">请选择服务</option>}{services.map(item=><option key={item.id} value={item.id}>{item.name} · {SERVICE_STATUS[item.status]?.[0]||item.status}</option>)}</select></Field>
        {service&&<><div className="msv-testing-service"><ServiceBadge status={service.status}/><strong>{modelName(service.modelSnapshot)}</strong><span>{service.id}</span><button className="text-button" onClick={()=>onNavigate('deployments',{serviceId:service.id})}>查看服务详情 <IconChevronRight size={14}/></button></div>
          {service.status!=='running'&&<Hint tone="amber">当前服务{SERVICE_STATUS[service.status]?.[0]||'不可用'}。发送测试请求将记录为拒绝，不会产生模拟推理结果。</Hint>}
          <Field label="调用演示场景"><select value={draft.scenario} onChange={event=>updateDraft({scenario:event.target.value})} disabled={service.status!=='running'}><option value="success">正常调用</option><option value="error">模拟运行错误</option></select></Field>
          {service.modelSnapshot.type==='image'&&<><Field label="检测图片样例（冻结原图）"><select value={service.dataVersion.records.some(r=>r.id===draft.input)?draft.input:''} onChange={event=>updateDraft({input:event.target.value})}><option value="">选择指定图片</option>{service.dataVersion.records.map(r=><option key={r.id} value={r.id}>{r.name} · {r.id}</option>)}</select></Field>{service.dataVersion.records.find(r=>r.id===draft.input)&&<img alt="本次检测样例原图" style={{width:'100%',maxHeight:260,objectFit:'contain'}} src={service.dataVersion.records.find(r=>r.id===draft.input).src}/>}<Hint>返回指定图片冻结标注的检测格式回放；非真实图像预测，指标也不代表检测 mAP。</Hint></>}
          <Field label="请求内容" required><textarea className="msv-test-input" value={draft.input} maxLength={3000} onChange={event=>updateDraft({input:event.target.value})} placeholder="输入本次测试问题"/></Field>
          <InlineError>{error}</InlineError><Button className="mv-full-button" variant="primary" icon={IconSend} disabled={!draft.input.trim()} onClick={send}>发送测试请求</Button>
          <Hint>回复由本地规则生成，不调用真实模型。请求会保存调用当时的服务状态、模型版本、评测报告和训练数据来源。</Hint>
        </>}
      </div></Panel>
      <Panel className="mv-detail-panel">
        {!service?<Empty title="选择要测试的服务" description="选择后可以发送请求并查看该服务的独立调用历史。"/>:<>
          <div className="mv-detail-title"><div><div className="mv-kicker">测试结果与调用记录</div><h2>{service.name}</h2><p>本服务共 {serviceCalls.length} 次请求 · 成功 {serviceCalls.filter(call=>call.status==='succeeded').length} 次</p></div><ServiceBadge status={service.status}/></div>
          {selectedCall?<article className={`msv-call-result msv-call-${selectedCall.status}`}>
            <div className="msv-call-heading"><div><strong>{selectedCall.id}</strong><small>{atTime(selectedCall.at)} · UTC+08:00</small></div><CallBadge status={selectedCall.status}/></div>
            <div className="msv-call-input"><span>请求内容</span><p>{selectedCall.input}</p></div>
            <div className="msv-call-output" role="status"><span>{selectedCall.status==='succeeded'?'模拟回复':selectedCall.status==='rejected'?'请求被拒绝':'模拟运行错误'}</span><p>{selectedCall.status==='succeeded'?(typeof selectedCall.output==='string'?selectedCall.output:JSON.stringify(selectedCall.output,null,2)):(selectedCall.reason||selectedCall.output||'本次请求未成功。')}</p></div>
            <div className="msv-call-provenance"><span>调用时服务状态：<b>{SERVICE_STATUS[selectedCall.serviceStatus]?.[0]||selectedCall.serviceStatus}</b></span><span>模型：{selectedCall.modelVersionId}</span><span>评测：{selectedCall.evaluationId}</span><span>训练数据：{selectedCall.dataVersionId}</span></div>
            <div className="msv-inline-actions">{selectedCall.status==='succeeded'&&<Button onClick={()=>onNavigate('feedback',{callId:selectedCall.id})}>提交结果反馈</Button>}<Button variant="ghost" icon={IconDownload} onClick={()=>{downloadText(`${selectedCall.id}-demo-call.json`,JSON.stringify({demo:true,...selectedCall},null,2));onToast?.('已生成当前调用记录的下载')}}>导出调用记录</Button></div>
          </article>:<div className="msv-test-empty"><IconSend size={34}/><h3>发送第一条测试请求</h3><p>结果会显示请求内容、模拟回复或拒绝原因，以及当时使用的完整版本来源。</p></div>}
          <div className="mv-subheading"><h3>本服务调用历史</h3><span className="mv-muted">切换记录查看当时结果</span></div>
          {serviceCalls.length?<div className="msv-call-list">{serviceCalls.map(call=><button key={call.id} className={`msv-call-row ${selectedCall?.id===call.id?'is-selected':''}`} onClick={()=>setSelectedCallId(call.id)} aria-label={`查看调用 ${call.id}`}><span><strong>{call.id}</strong><small>{atTime(call.at)}</small></span><span className="msv-call-row-input">{call.input}</span><CallBadge status={call.status}/></button>)}</div>:<p className="mv-footnote">尚无记录。只有发送请求后才会创建调用历史。</p>}
          <div className="mv-subheading"><h3>固定发布来源</h3><span className="mv-muted">与历史调用一致</span></div><Lineage service={service} modelState={modelState} onNavigate={onNavigate}/>
        </>}
      </Panel>
    </div>}
  </div>;
}
