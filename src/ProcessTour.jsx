import React,{useEffect,useLayoutEffect,useState} from 'react';
import {IconArrowLeft,IconArrowRight,IconCheck,IconX,IconRoute,IconRefresh} from '@tabler/icons-react';
import './tour.css';

// Keep routes in sync with App.jsx's existing navigation identifiers.
// The tour is read-only: it never submits business actions or changes workspace data.
export const tourTracks=[
 {id:'overview',name:'全流程导览',description:'从任务立项到成果交付，串起平台的完整业务链路',steps:[
  ['workbench','全局工作台','从这里查看各业务中心的待办、生产状态与异常，了解平台整体运转情况。'],
  ['projects','场景与项目','明确客户场景、项目归属和责任成员，建立生产活动的业务边界。'],
  ['definitions','任务定义','定义任务范围、类型与预期产出，形成后续数据生产的输入。'],
  ['labels','标签与规范','制定标注规则、分类标签和质量口径，让生产与审核有共同标准。'],
  ['governance','立项与验收治理','检查责任、来源许可、验收证据和治理约束；不满足条件的操作应受门禁限制。'],
  ['ingestion','数据接入','查看数据来源与接入入口，准备需要生产的原始数据。'],
  ['processing','清洗与增强','完成清洗、多源汇聚、增强及质量规则处理，追踪来源与版本。'],
  ['work-orders','生产工单','按角色分派生产和审核任务，管理期限、抽检、返工和争议仲裁。'],
  ['ai-annotation','AI 标注','选择模型和数据版本，查看预标注任务及人工复核的衔接方式。'],
  ['review','标注与审核','人工标注、逐项复核与批次验收，形成可追溯的质量记录。'],
  ['datasets','数据集与版本','沉淀通过质检的数据版本，供模型、知识生产和交付复用。'],
  ['models','模型仓库','将数据版本关联模型资产，维护模型生产所依赖的版本关系。'],
  ['training','模型训练','配置和跟踪训练任务；此原型的训练为本地模拟，不使用真实 GPU。'],
  ['evaluation','模型评测','查看评测指标、结果证据及是否满足发布要求。'],
  ['deployments','服务发布','在通过门禁后演示服务发布、状态变更和下线流程。'],
  ['testing','在线测试','演示推理测试和反馈，注意这里不代表真实线上模型效果。'],
  ['knowledge','知识生产与索引','解析文档、制作问答内容并创建知识索引，记录来源关联。'],
  ['agents','智能体与应用','编排应用能力，将知识来源与智能体的使用和验证关联。'],
  ['canvas','流程画布','查看应用流程的设计与衔接入口。'],
  ['feedback','反馈与改进','从应用反馈回溯来源，推动修订、复测与持续改进。'],
  ['marketplace','成果市场与授权','查看资产上架、共享用途和授权条件，确保消费受治理约束。'],
  ['deliveries','交付与验收','演示交付冻结、客户签收、拒收、补交和售后纠错闭环。'],
  ['operations','运营与恢复','最后查看业务记录、异常与快照恢复；恢复操作需独立确认。'],
  ['settings-general','系统设置','统一配置空间、成员、权限及资源参数，完成平台级治理。']
 ]},
 {id:'data',name:'数据生产与交付',description:'重点体验标注、质检、工单、版本发布和客户验收',steps:[
  ['projects','建立项目','先确定业务场景和责任主体。'],
  ['definitions','定义任务','明确任务、验收标准与产出。'],
  ['labels','制定规范','统一标签分类、作业规则与质量要求。'],
  ['governance','治理校验','核对来源许可和项目验收前置条件。'],
  ['ingestion','接入原始数据','导入或建立待生产的数据源。'],
  ['processing','清洗与增强','完成清洗、汇聚、规则质评和版本追溯。'],
  ['work-orders','分派生产工单','配置生产责任人、审核人、期限与抽检策略。'],
  ['ai-annotation','AI 辅助标注','查看模型预标注和人工接管的过程。'],
  ['review','人工复核与验收','完成标注、逐项审核和批次验收。'],
  ['datasets','发布数据版本','检查生产结果并形成可交付版本。'],
  ['marketplace','授权使用','核对资产共享范围与授权状态。'],
  ['deliveries','客户交付与售后','查看签收、拒收、反馈、补交和历史证据。']
 ]},
 {id:'model',name:'模型生产与服务',description:'跟随数据版本完成训练、评测、发布和服务验证',steps:[
  ['datasets','选择数据版本','训练应绑定可追溯的数据版本。'],
  ['governance','检查治理门禁','确认来源许可、隔离与验收要求。'],
  ['models','管理模型资产','查看模型仓库以及版本之间的关联。'],
  ['training','训练任务','演示训练配置和任务状态变化。'],
  ['evaluation','模型评测','通过质量与效果证据决定是否继续发布。'],
  ['deployments','发布与下线','演示服务生命周期与版本状态。'],
  ['testing','在线测试','进行模拟测试，验证服务使用路径。'],
  ['operations','监控与恢复','查看异常、事件记录和运维入口。']
 ]},
 {id:'knowledge',name:'知识与智能体闭环',description:'从文档知识加工走向智能体应用和反馈改进',steps:[
  ['knowledge','知识生产','导入内容、处理文档并形成知识来源版本。'],
  ['agents','创建智能体','绑定来源并设定应用能力和行为。'],
  ['canvas','流程编排','了解可视化应用流程如何串联能力。'],
  ['feedback','收集反馈','检查答复问题、来源关系和改进任务。'],
  ['governance','复核来源许可','对来源撤回、治理规则和使用权限进行复核。'],
  ['marketplace','成果授权','查看应用成果的可共享、可使用边界。']
 ]}
];
const persistKey='data-forge-tour-progress-v1';
function readProgress(){try{return JSON.parse(localStorage.getItem(persistKey)||'{}')}catch{return {}}}
export default function ProcessTour({view,onNavigate}){
 const [open,setOpen]=useState(false),[trackId,setTrackId]=useState('overview'),[step,setStep]=useState(0),[bounds,setBounds]=useState(null),[progress,setProgress]=useState(readProgress);
 const track=tourTracks.find(t=>t.id===trackId)||tourTracks[0],current=track.steps[step];
 useEffect(()=>{if(open&&current&&view!==current[0])onNavigate(current[0])},[open,trackId,step]); // route change is purely navigational
 useLayoutEffect(()=>{
  if(!open||!current)return;
  let frame=0;
  const update=()=>{
   cancelAnimationFrame(frame);
   frame=requestAnimationFrame(()=>{
    const target=document.querySelector('[data-tour-id="'+current[0]+'"]')||document.querySelector('[data-tour-main]');
    if(!target){setBounds(null);return}
    const rect=target.getBoundingClientRect();
    setBounds(rect.width&&rect.height?{top:Math.max(0,rect.top-5),left:Math.max(0,rect.left-5),width:rect.width+10,height:rect.height+10}:null);
   });
  };
  const timeout=setTimeout(update,90);update();
  window.addEventListener('resize',update);window.addEventListener('scroll',update,true);
  return()=>{clearTimeout(timeout);cancelAnimationFrame(frame);window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true)};
 },[open,step,trackId,view]);
 useEffect(()=>{
  if(!open)return;
  const key=e=>{if(e.key==='Escape'){setOpen(false)}else if(e.key==='ArrowRight'){e.preventDefault();setStep(s=>Math.min(s+1,track.steps.length-1))}else if(e.key==='ArrowLeft'){e.preventDefault();setStep(s=>Math.max(0,s-1))}};
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[open,track.steps.length]);
 function start(id){const t=tourTracks.find(x=>x.id===id);if(!t)return;setTrackId(id);setStep(0);setOpen(true)}
 function finish(){
  const next={...progress,[trackId]:{completed:true,at:new Date().toISOString()}};
  setProgress(next);try{localStorage.setItem(persistKey,JSON.stringify(next)}catch{}
  setOpen(false);
 }
 const first=step===0,last=step===track.steps.length-1;
 return <><button className="tour-launch" aria-label="打开全流程导览" onClick={()=>setOpen(true)}><IconRoute size={18}/> 流程导览</button>
 {open&&<div className="tour-root" role="dialog" aria-modal="true" aria-label="平台业务流程导览">
  <div className="tour-backdrop" onClick={()=>setOpen(false)}/>
  {bounds&&<div className="tour-highlight" style={{top:bounds.top,left:bounds.left,width:bounds.width,height:bounds.height}} aria-hidden="true"/>}
  <section className="tour-panel">
   <div className="tour-panel-head"><span><IconRoute size={18}/> 业务流程导览</span><button aria-label="关闭导览" onClick={()=>setOpen(false)}><IconX size={19}/></button></div>
   <label className="tour-track-label" htmlFor="tour-track">选择业务主线</label>
   <select id="tour-track" value={trackId} onChange={e=>{setTrackId(e.target.value);setStep(0)}}>{tourTracks.map(t=><option key={t.id} value={t.id}>{t.name}{progress[t.id]?.completed?' ✓':''}</option>)}</select>
   <p className="tour-track-desc">{track.description}</p>
   <div className="tour-counter">第 {step+1} / {track.steps.length} 步 <span>只读演示 · 不会执行业务操作</span></div>
   <div className="tour-meter" role="progressbar" aria-label="导览进度" aria-valuemin={0} aria-valuemax={track.steps.length} aria-valuenow={step+1}><span style={{width:((step+1)/track.steps.length*100)+'%'}}/></div>
   <h3>{current[1]}</h3><p className="tour-description">{current[2]}</p>
   <div className="tour-foot"><button disabled={first} onClick={()=>setStep(s=>s-1)}><IconArrowLeft size={16}/> 上一步</button><button className="tour-primary" onClick={()=>last?finish():setStep(s=>s+1)}>{last?<><IconCheck size={16}/> 完成导览</>:<>下一步 <IconArrowRight size={16}/></>}</button></div>
   <div className="tour-small-actions"><button onClick={()=>{setOpen(false)}}>退出，稍后再看</button><button onClick={()=>setStep(0)}><IconRefresh size={14}/> 从头开始</button></div>
  </section>
 </div>}</>;
}
