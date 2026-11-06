import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {IconArrowLeft,IconArrowRight,IconCheck,IconX,IconRoute,IconRefresh} from '@tabler/icons-react';
import {buildTourSteps,findTourTarget} from './tour-steps.js';
import {safePreviews,findSafeOpener,inspectForm} from './tour-interactions.js';
import './tour.css';

// Keep routes in sync with App.jsx's existing navigation identifiers.
// The tour is read-only: it never submits business actions or changes workspace data.
export const tourTracks=[
 {id:'overview',name:'全流程导览',steps:[
  ['workbench','全局工作台'],
  ['projects','场景与项目'],
  ['definitions','任务定义'],
  ['labels','标签与规范'],
  ['governance','立项与验收治理'],
  ['ingestion','数据接入'],
  ['processing','清洗与增强'],
  ['work-orders','生产工单'],
  ['ai-annotation','AI 标注'],
  ['review','标注与审核'],
  ['datasets','数据集与版本'],
  ['models','模型仓库'],
  ['training','模型训练'],
  ['evaluation','模型评测'],
  ['deployments','服务发布'],
  ['testing','在线测试'],
  ['knowledge','知识生产与索引'],
  ['agents','智能体与应用'],
  ['canvas','流程画布'],
  ['feedback','反馈与改进'],
  ['marketplace','成果市场与授权'],
  ['deliveries','交付与验收'],
  ['operations','运营与恢复'],
  ['settings-general','系统设置']
 ]},
 {id:'data',name:'数据生产与交付',steps:[
  ['projects','建立项目'],
  ['definitions','定义任务'],
  ['labels','制定规范'],
  ['governance','治理校验'],
  ['ingestion','接入原始数据'],
  ['processing','清洗与增强'],
  ['work-orders','分派生产工单'],
  ['ai-annotation','AI 辅助标注'],
  ['review','人工复核与验收'],
  ['datasets','发布数据版本'],
  ['marketplace','授权使用'],
  ['deliveries','客户交付与售后']
 ]},
 {id:'model',name:'模型生产与服务',steps:[
  ['datasets','选择数据版本'],
  ['governance','检查治理门禁'],
  ['models','管理模型资产'],
  ['training','训练任务'],
  ['evaluation','模型评测'],
  ['deployments','发布与下线'],
  ['testing','在线测试'],
  ['operations','监控与恢复']
 ]},
 {id:'knowledge',name:'知识与智能体闭环',steps:[
  ['knowledge','知识生产'],
  ['agents','创建智能体'],
  ['canvas','流程编排'],
  ['feedback','收集反馈'],
  ['governance','复核来源许可'],
  ['marketplace','成果授权']
 ]}
];
const persistKey='data-forge-tour-progress-v1';
function visibleInlineForm(root,selector){
 if(!root||!selector)return null;
 return Array.from(root.querySelectorAll(selector)).find(node=>
  !node.closest('[hidden],[aria-hidden="true"]')&&node.getClientRects().length>0&&
  window.getComputedStyle(node).visibility!=='hidden')||null;
}
// Use the space around the visible target. A short slot can scroll independently.
function placeTourPanel(target,panel){
 const inset=12,gap=12;
 const width=document.documentElement.clientWidth;
 const height=document.documentElement.clientHeight;
 const panelWidth=panel.offsetWidth;
 const maxHeight=height-inset*2;
 const desiredHeight=Math.min(panel.scrollHeight+panel.offsetHeight-panel.clientHeight,maxHeight);
 const clamp=(value,min,max)=>Math.min(Math.max(value,min),Math.max(min,max));
 const centered={
  left:Math.round((width-panelWidth)/2),
  top:Math.max(inset,Math.round((height-desiredHeight)/2)),
  maxHeight
 };
 if(!target)return centered;

 const right=target.left+target.width;
 const bottom=target.top+target.height;
 const alignedX=clamp(target.left,inset,width-panelWidth-inset);
 const alignedY=clamp(target.top,inset,height-desiredHeight-inset);
 const slots=[
  {side:'right',space:width-inset-right-gap,left:right+gap,top:alignedY,maxHeight:height-inset-alignedY},
  {side:'left',space:target.left-inset-gap,left:target.left-gap-panelWidth,top:alignedY,maxHeight:height-inset-alignedY},
  {side:'bottom',space:height-inset-bottom-gap,left:alignedX,top:bottom+gap,maxHeight:height-inset-bottom-gap},
  {side:'top',space:target.top-inset-gap,left:alignedX,top:inset,maxHeight:target.top-inset-gap}
 ].filter(slot=>slot.side==='left'||slot.side==='right'?slot.space>=panelWidth:slot.space>=110);
 const best=slots.find(slot=>slot.maxHeight>=desiredHeight)||
  slots.sort((a,b)=>b.maxHeight-a.maxHeight)[0];
 if(best){
  const top=best.side==='top'?target.top-gap-Math.min(best.maxHeight,desiredHeight):best.top;
  return {left:best.left,top,maxHeight:best.maxHeight};
 }

 // If the target fills the viewport, keep the controls reachable in a compact sheet.
 const compactHeight=Math.min(maxHeight,Math.max(110,Math.floor(height*.30)));
 const top=target.top+target.height/2>height/2?inset:height-compactHeight-inset;
 return {...centered,top,maxHeight:compactHeight};
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
  const update=(event)=>{
   if(event?.target instanceof Node&&dialogRef.current?.contains(event.target))return;
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
    const top=Math.max(0,rect.top-5),left=Math.max(0,rect.left-5);
    const right=Math.min(document.documentElement.clientWidth,rect.right+5);
    const bottom=Math.min(document.documentElement.clientHeight,rect.bottom+5);
    if(right<=left||bottom<=top){setBounds(null);return}
    setBounds({top,left,width:right-left,height:bottom-top,targetClass:typeof target.className==='string'?target.className:'',withinMain:!!target.closest('[data-tour-main]')});
   });
  };
  const timeout=setTimeout(update,110);
  update();
  window.addEventListener('resize',update);window.addEventListener('scroll',update,true);
  return()=>{clearTimeout(timeout);cancelAnimationFrame(frame);window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true)};
 },[open,step,trackId,view,preview,fieldIndex]);
 useLayoutEffect(()=>{
  const panel=dialogRef.current;
  if(!open||!panel)return;
  const position=()=>Object.assign(panel.style,Object.fromEntries(
   Object.entries(placeTourPanel(bounds,panel)).map(([key,value])=>[key,`${value}px`])
  ));
  position();
  const observer=new ResizeObserver(position);
  observer.observe(panel);
  window.addEventListener('resize',position);
  return()=>{observer.disconnect();window.removeEventListener('resize',position)};
 },[open,bounds,previewError,missingTarget,step,trackId,preview,fieldIndex]);
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
 return <><button className="tour-launch" aria-label="打开全流程导览" onClick={()=>setOpen(true)}><IconRoute size={18}/> 流程导览</button>
 {open&&createPortal(<div className="tour-root" data-preview-open={!!preview} data-has-target={!!bounds} role="dialog" aria-modal="true" aria-label="平台业务流程导览">
  <div className="tour-backdrop" onClick={()=>setOpen(false)}/>
  {bounds&&<div className="tour-highlight" data-target-class={bounds.targetClass} data-within-main={bounds.withinMain} style={{top:bounds.top,left:bounds.left,width:bounds.width,height:bounds.height}} aria-hidden="true"/>}
  <section ref={dialogRef} tabIndex={-1} className="tour-panel">
   <div className="tour-panel-head"><span><IconRoute size={18}/> 业务流程导览</span><button aria-label="关闭导览" onClick={()=>setOpen(false)}><IconX size={19}/></button></div>
   <label className="tour-track-label" htmlFor="tour-track">选择业务主线</label>
   <select id="tour-track" value={trackId} onChange={e=>{setTrackId(e.target.value);setStep(0)}}>{tourTracks.map(t=><option key={t.id} value={t.id}>{t.name}{progress[t.id]?.completed?' ✓':''}</option>)}</select>
   <div className="tour-counter">第 {step+1} / {steps.length} 步</div>
   <div className="tour-meter" role="progressbar" aria-label="导览进度" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={step+1}><span style={{width:((step+1)/steps.length*100)+'%'}}/></div>
   <div className="tour-stage-label">{current.stageLabel}</div><h3>{current.title}</h3>{current.description&&!preview&&<p className="tour-description">{current.description}</p>}{missingTarget&&<p className="tour-unavailable" role="status">当前页面没有可高亮的区域。</p>}
   {allowPreview&&<div className="tour-form-inspector">
    {!preview?<button type="button" className="tour-inspect-button" onClick={openPreview}>查看真实操作表单（只读）</button>:<>
      <div className="tour-preview-header"><strong>真实表单字段 {preview.fields.length?fieldIndex+1:0}/{preview.fields.length}</strong><button type="button" onClick={closePreview}>关闭表单预览</button></div>
      {preview.fields.length>0?<div className="tour-field-info" aria-live="polite"><strong>{preview.fields[fieldIndex]?.label}{preview.fields[fieldIndex]?.required?'（必填）':''}</strong>{preview.fields[fieldIndex]?.hint&&<span>{preview.fields[fieldIndex].hint}</span>}</div>:<p>没有可预览的字段。</p>}
      <div className="tour-field-controls"><button disabled={fieldIndex===0} onClick={()=>setFieldIndex(x=>Math.max(0,x-1))}>上一个字段</button><button disabled={fieldIndex>=preview.fields.length-1} onClick={()=>setFieldIndex(x=>Math.min(preview.fields.length-1,x+1))}>下一个字段</button></div>
    </>}
    {previewError&&<p className="tour-unavailable" role="status">{previewError}</p>}
   </div>}
   <div className="tour-foot"><button disabled={first} onClick={()=>setStep(s=>s-1)}><IconArrowLeft size={16}/> 上一步</button><button className="tour-primary" onClick={()=>last?finish():setStep(s=>s+1)}>{last?<><IconCheck size={16}/> 完成导览</>:<>下一步 <IconArrowRight size={16}/></>}</button></div>
   <div className="tour-small-actions">{step<sectionEnd&&sectionEnd<steps.length-1&&<button onClick={()=>setStep(sectionEnd+1)}>跳到下一模块</button>}<button onClick={()=>{setOpen(false)}}>退出，稍后再看</button><button onClick={()=>setStep(0)}><IconRefresh size={14}/> 从头开始</button></div>
  </section>
 </div>,document.body)}</>;
}
