import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {IconArrowLeft,IconArrowRight,IconCheck,IconX,IconRoute,IconRefresh} from '@tabler/icons-react';
import {buildTourSteps,findTourTarget} from './tour-steps.js';
import {safePreviews,findSafeOpener,inspectForm} from './tour-interactions.js';
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
function visibleInlineForm(root,selector){
 if(!root||!selector)return null;
 return Array.from(root.querySelectorAll(selector)).find(node=>
  !node.closest('[hidden],[aria-hidden="true"]')&&node.getClientRects().length>0&&
  window.getComputedStyle(node).visibility!=='hidden')||null;
}
function readProgress(){try{return JSON.parse(localStorage.getItem(persistKey)||'{}')}catch{return {}}}
export default function ProcessTour({view,onNavigate}){
 const dialogRef=useRef(null);
 const [open,setOpen]=useState(false),[trackId,setTrackId]=useState('overview'),[step,setStep]=useState(0),[bounds,setBounds]=useState(null),[progress,setProgress]=useState(readProgress);
 const track=tourTracks.find(t=>t.id===trackId)||tourTracks[0],steps=buildTourSteps(track),current=steps[Math.min(step,steps.length-1)];
 const [missingTarget,setMissingTarget]=useState(false);
 const [preview,setPreview]=useState(null);
 const [fieldIndex,setFieldIndex]=useState(0);
 const [previewError,setPreviewError]=useState('');
 const previewRef=useRef(null);
 useEffect(()=>{if(open&&current&&view!==current.view&&!(previewRef.current?.view===current.view&&previewRef.current.config.inlineRoute===view))onNavigate(current.view)},[open,trackId,step]);
 // Inspect only explicitly allowlisted form dialogs. Never submit or mutate domain state.
 function closePreview(restoreRoute=true){
  if(!previewRef.current)return;
  const previous=previewRef.current;
  previewRef.current=null;
  const dialog=document.querySelector('.modal-backdrop .modal');
  if(restoreRoute&&previous.config.inlineRoute){onNavigate(previous.view)}
  if(!previous.config.inline&&dialog&&dialog.querySelector('h2')?.textContent?.trim()===previous.config.dialog){
   const cancel=Array.from(dialog.querySelectorAll('button')).find(el=>el.textContent.trim()==='取消');
   if(cancel)cancel.click();
   else dialog.querySelector('header button[aria-label="关闭弹窗"]')?.click();
  }
  setPreview(null);setFieldIndex(0);setPreviewError('');
 }
 function openPreview(){
  closePreview();
  const config=safePreviews[current.view];
  const root=document.querySelector('[data-tour-main]');
  const opener=findSafeOpener(root,current.view);
  const inline=config?.inline?visibleInlineForm(root,config.inline):null;
  if(!config||(!inline&&!opener)){setPreviewError('当前页面未显示安全的表单入口，请检查当前角色权限或切换演示数据。');return}
  previewRef.current={view:current.view,config};
  if(opener)opener.click(); // only allowlisted local form opener, never a submission
  // React may batch the opener's setState; inspect the rendered dialog next frame.
  requestAnimationFrame(()=>{
   if(previewRef.current?.view!==current.view)return;
   const dialog=config.inline?visibleInlineForm(document.querySelector('[data-tour-main]'),config.inline):Array.from(document.querySelectorAll('.modal-backdrop .modal')).find(el=>el.querySelector('h2')?.textContent?.trim()===config.dialog);
   if(!dialog){previewRef.current=null;setPreviewError('没有找到预期的表单，演示已停止。');return}
   const fields=inspectForm(dialog);
   setPreview({view:current.view,fields:fields.map(({label,required,hint})=>({label,required,hint}))});
   setFieldIndex(0);setPreviewError('');
  });
 }
 useEffect(()=>{
  if(!preview)return;
  const cls=safePreviews[preview.view]?.inline?'tour-inline-preview-open':'tour-form-preview-open';
  document.body.classList.add(cls);
  return()=>document.body.classList.remove(cls);
 },[preview?.view]);
 // Always dismiss an inspected form when navigating elsewhere or exiting the tour.
 useEffect(()=>{
  const previous=previewRef.current;
  if(previous&&(!open||current.stage!==1||current.view!==previous.view||(view!==previous.view&&view!==previous.config.inlineRoute))){
   // A new module owns its destination; cleanup must not overwrite it.
   closePreview((!open||current.view===previous.view)&&(view===previous.view||view===previous.config.inlineRoute));
  }
 },[open,step,trackId,view]);
 useEffect(()=>()=>{if(previewRef.current)closePreview(false)},[]);
 // route change is purely navigational
 useLayoutEffect(()=>{
  if(!open||!current||(view!==current.view&&view!==safePreviews[current.view]?.inlineRoute)){setBounds(null);return}
  let frame=0;
  let lastTarget=null;
  const update=()=>{
   cancelAnimationFrame(frame);
   frame=requestAnimationFrame(()=>{
    const root=document.querySelector('[data-tour-main]');
    const config=safePreviews[current.view];
    const modal=preview&&preview.view===current.view||preview&&config?.inlineRoute===view?(config?.inline?visibleInlineForm(root,config.inline):Array.from(document.querySelectorAll('.modal-backdrop .modal')).find(el=>el.querySelector('h2')?.textContent?.trim()===config?.dialog)):null;
    const fieldNodes=modal?inspectForm(modal):[];
    const target=modal?(fieldNodes[fieldIndex]?.node||modal):findTourTarget(root,current.stage);
    setMissingTarget(!target);
    if(!target){setBounds(null);return}
    if(lastTarget!==target){lastTarget=target;target.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})}
    const rect=target.getBoundingClientRect();
    setBounds({top:Math.max(0,rect.top-5),left:Math.max(0,rect.left-5),width:rect.width+10,height:rect.height+10,targetClass:typeof target.className==='string'?target.className:'',withinMain:!!target.closest('[data-tour-main]')});
   });
  };
  const timeout=setTimeout(update,110);
  update();
  window.addEventListener('resize',update);window.addEventListener('scroll',update,true);
  return()=>{clearTimeout(timeout);cancelAnimationFrame(frame);window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true)};
 },[open,step,trackId,view,preview,fieldIndex]);
 // Removing/replacing a focused preview control does not dispatch focusin.
 // Repair focus after React commits, without resetting valid keyboard navigation.
 useLayoutEffect(()=>{
  const panel=dialogRef.current;
  if(!open||!panel)return;
  const active=document.activeElement;
  if(panel.contains(active)&&!active.disabled)return;
  const target=panel.querySelector('.tour-inspect-button,.tour-preview-header button')||
   panel.querySelector('button:not([disabled])');
  (target||panel).focus({preventScroll:true});
 });
 useEffect(()=>{
  if(!open)return;
  const previouslyFocused=document.querySelector('.tour-launch');
  const focusables=()=>Array.from(dialogRef.current?.querySelectorAll('button:not([disabled]),select:not([disabled]),input:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')||[]).filter(el=>el.getClientRects().length>0);
  const focusFirst=()=>focusables()[0]?.focus({preventScroll:true});
  // Focus immediately after opening, and return to the launch control after closing.
  focusFirst();
  const key=e=>{
   if(e.key==='Escape'){e.preventDefault();if(previewRef.current)closePreview();else setOpen(false);return}
   if(e.key==='Tab'){
    const controls=focusables(),first=controls[0],last=controls[controls.length-1];
    if(!first){e.preventDefault();dialogRef.current?.focus({preventScroll:true});return}
    if(!dialogRef.current?.contains(document.activeElement)){e.preventDefault();(e.shiftKey?last:first).focus();return}
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
    return;
   }
   if(e.key==='ArrowRight'&&e.target.tagName!=='SELECT'){e.preventDefault();setStep(s=>Math.min(s+1,steps.length-1))}
   else if(e.key==='ArrowLeft'&&e.target.tagName!=='SELECT'){e.preventDefault();setStep(s=>Math.max(0,s-1))}
  };
  // Capture keyboard events before controls underneath the dialog can act on them.
  document.addEventListener('keydown',key,true);
  const focusin=e=>{if(dialogRef.current&&!dialogRef.current.contains(e.target))focusFirst()};
  document.addEventListener('focusin',focusin);
  return()=>{
   document.removeEventListener('keydown',key,true);
   document.removeEventListener('focusin',focusin);
   if(previouslyFocused?.isConnected)previouslyFocused.focus({preventScroll:true});
  };
 },[open,steps.length]);
 function start(id){const t=tourTracks.find(x=>x.id===id);if(!t)return;setTrackId(id);setStep(0);setOpen(true)}
 function finish(){
  const next={...progress,[trackId]:{completed:true,at:new Date().toISOString()}};
  setProgress(next);try{localStorage.setItem(persistKey,JSON.stringify(next))}catch{}
  setOpen(false);
 }
 const first=step===0,last=step===steps.length-1;
 const sectionEnd=steps.findLastIndex(x=>x.sectionIndex===current.sectionIndex);
 const allowPreview=current.stage===1&&!!safePreviews[current.view];
 const moduleTotal=track.steps.length;
 return <><button className="tour-launch" aria-label="打开全流程导览" onClick={()=>setOpen(true)}><IconRoute size={18}/> 流程导览</button>
 {open&&<div className="tour-root" data-preview-open={!!preview} role="dialog" aria-modal="true" aria-label="平台业务流程导览">
  <div className="tour-backdrop" onClick={()=>setOpen(false)}/>
  {bounds&&<div className="tour-highlight" data-target-class={bounds.targetClass} data-within-main={bounds.withinMain} style={{top:bounds.top,left:bounds.left,width:bounds.width,height:bounds.height}} aria-hidden="true"/>}
  <section ref={dialogRef} tabIndex={-1} className="tour-panel">
   <div className="tour-panel-head"><span><IconRoute size={18}/> 业务流程导览</span><button aria-label="关闭导览" onClick={()=>setOpen(false)}><IconX size={19}/></button></div>
   <label className="tour-track-label" htmlFor="tour-track">选择业务主线</label>
   <select id="tour-track" value={trackId} onChange={e=>{setTrackId(e.target.value);setStep(0)}}>{tourTracks.map(t=><option key={t.id} value={t.id}>{t.name}{progress[t.id]?.completed?' ✓':''}</option>)}</select>
   <p className="tour-track-desc">{track.description}</p>
   <div className="tour-counter">第 {step+1} / {steps.length} 步 · 模块 {current.sectionIndex+1}/{moduleTotal} <span>只读演示 · 不会执行业务操作</span></div>
   <div className="tour-meter" role="progressbar" aria-label="导览进度" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={step+1}><span style={{width:((step+1)/steps.length*100)+'%'}}/></div>
   <div className="tour-stage-label">{current.stageLabel}</div><h3>{current.title}</h3><p className="tour-description">{current.description}</p>{missingTarget&&<p className="tour-unavailable" role="status">当前角色或数据未显示这个区域。可切换有权限的演示成员，或继续下一步。</p>}
   {allowPreview&&<div className="tour-form-inspector">
    {!preview?<button type="button" className="tour-inspect-button" onClick={openPreview}>查看真实操作表单（只读）</button>:<>
      <div className="tour-preview-header"><strong>真实表单字段 {preview.fields.length?fieldIndex+1:0}/{preview.fields.length}</strong><button type="button" onClick={closePreview}>关闭表单预览</button></div>
      <p>{safePreviews[current.view]?.help}</p>
      {preview.fields.length>0?<div className="tour-field-info" aria-live="polite"><strong>{preview.fields[fieldIndex]?.label}{preview.fields[fieldIndex]?.required?'（必填）':''}</strong><span>{preview.fields[fieldIndex]?.hint||'核对输入类型、选择项和业务约束，再进行下一步。'}</span></div>:<p>该表单没有可识别的字段标签，请检查弹窗内的输入区。</p>}
      <div className="tour-field-controls"><button disabled={fieldIndex===0} onClick={()=>setFieldIndex(x=>Math.max(0,x-1))}>上一个字段</button><button disabled={fieldIndex>=preview.fields.length-1} onClick={()=>setFieldIndex(x=>Math.min(preview.fields.length-1,x+1))}>下一个字段</button></div>
    </>}
    {previewError&&<p className="tour-unavailable" role="status">{previewError}</p>}
   </div>}
   <div className="tour-foot"><button disabled={first} onClick={()=>setStep(s=>s-1)}><IconArrowLeft size={16}/> 上一步</button><button className="tour-primary" onClick={()=>last?finish():setStep(s=>s+1)}>{last?<><IconCheck size={16}/> 完成导览</>:<>下一步 <IconArrowRight size={16}/></>}</button></div>
   <div className="tour-small-actions">{step<sectionEnd&&sectionEnd<steps.length-1&&<button onClick={()=>setStep(sectionEnd+1)}>跳到下一模块</button>}<button onClick={()=>{setOpen(false)}}>退出，稍后再看</button><button onClick={()=>setStep(0)}><IconRefresh size={14}/> 从头开始</button></div>
  </section>
 </div>}</>;
}
