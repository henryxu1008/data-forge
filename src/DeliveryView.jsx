import React,{useState,useEffect} from 'react';
import {Button,PageHeader,Panel,Field,Empty,Badge} from './ui.jsx';
import {deliveryAccess,deliveryEligibility,deliveryRecipientAccess} from './delivery-platform.js';
import './completion.css';
const names={draft:'待准备',submitted:'待客户验收',accepted:'已签收',rejected:'已退回',cancelled:'已取消'};
export default function DeliveryView({w,platform,onDeliveryAction,versions,request,onNavigate}){
 const [selected,setSelected]=useState(request?.orderId||''),[versionId,setVersion]=useState(''),[customerId,setCustomer]=useState(''),[note,setNote]=useState(''),[feedbackId,setFeedback]=useState(''),[newVersionId,setNewVersion]=useState(''),[error,setError]=useState('');
 const [worker,setWorker]=useState(''),[reviewer,setReviewer]=useState(''),[due,setDue]=useState('');
 const [evidence,setEvidence]=useState({checksum:'',qualityReportId:'',licenseRef:'',manifest:''});
 const orders=w.delivery?.orders||[],order=orders.find(o=>o.id===selected),version=versions.find(v=>v.id===versionId);
 useEffect(()=>{if(request?.orderId)setSelected(request.orderId)},[request?.key]);
 useEffect(()=>{setNote('');setFeedback('');setNewVersion('');setEvidence({checksum:'',qualityReportId:'',licenseRef:'',manifest:''});setError('')},[selected]);
 const allowed=type=>order&&deliveryAccess(w,platform.settings,platform.actorId,platform.activeSpaceId,{type,orderId:order.id}).ok;
 function act(type,extra={}){const r=onDeliveryAction({type,orderId:order?.id,note,...extra});if(!r.ok){setError(r.error);return}setError('');setNote('');setSelected(r.order.id)}
 const eligible=versions.filter(v=>deliveryEligibility(w,v.id,v.projectId).ok);
 const recipients=platform.settings.users.filter(u=>u.id!==platform.actorId&&version&&deliveryRecipientAccess(w,platform.settings,u.id,platform.activeSpaceId,version.id,version.projectId).ok);
 return <div className="cl-page"><PageHeader title="交付与验收" description="冻结发布版本 → 登记交付证据 → 客户验收 → 反馈与补交"/>
 <p className="cl-hint">本地流程演示：验收成员代表客户操作。登记外部交付包证据，不会实际传输文件或通知客户。</p>
 {error&&<div role="alert" className="cl-error">{error}</div>}
 <Panel title="新建交付单"><div className="cl-body">
 <Field label="已通过质量与许可检查的发布版本"><select value={versionId} onChange={e=>{setVersion(e.target.value);setCustomer('')}}><option value="">请选择版本</option>{eligible.map(v=><option key={v.id} value={v.id}>{v.datasetName||v.projectName} · {v.version||v.id}</option>)}</select></Field>
 {!eligible.length&&<p>暂无可交付版本，请先完成标注质检、版本发布与共享用途准入。</p>}
 <Field label="客户验收成员"><select value={customerId} onChange={e=>setCustomer(e.target.value)}><option value="">请选择另一位项目审核成员</option>{recipients.map(u=><option key={u.id} value={u.id}>{u.name||u.id}</option>)}</select></Field>
 <Button disabled={!version||!customerId||!deliveryAccess(w,platform.settings,platform.actorId,platform.activeSpaceId,{type:'create',projectId:version?.projectId,versionId}).ok} onClick={()=>act('create',{projectId:version.projectId,versionId,customerId})}>创建交付单</Button></div></Panel>
 <div className="cl-grid"><Panel title="交付记录"><div className="cl-list">{orders.map(o=><button key={o.id} className={selected===o.id?'selected':''} onClick={()=>setSelected(o.id)}><strong>{o.id} · {names[o.status]}</strong><small>{o.versionId} · 验收人 {platform.settings.users.find(u=>u.id===o.customerId)?.name||o.customerId}</small></button>)}</div>{!orders.length&&<Empty title="暂无交付单"/>}</Panel>
 <Panel title={order?`${order.id} · ${names[order.status]}`:'交付详情'}>{!order?<Empty title="请选择交付单"/>:<div className="cl-body">
 <p>冻结版本：{order.versionId}　<Badge>{names[order.status]}</Badge></p>
 {order.revisionOf&&<p>补交来源：<button onClick={()=>setSelected(order.revisionOf)}>{order.revisionOf}</button></p>}
 {order.revisions.length>0&&<p>补交记录：{order.revisions.map(id=><button key={id} onClick={()=>setSelected(id)}>{id}</button>)}</p>}
 {order.status==='draft'&&allowed('package')&&<fieldset><legend>登记外部交付包证据</legend>{[['checksum','校验和'],['qualityReportId','质量报告引用'],['licenseRef','许可说明引用'],['manifest','文件清单（每行一个文件）']].map(([key,label])=><Field key={key} label={label}><textarea value={evidence[key]} onChange={e=>setEvidence({...evidence,[key]:e.target.value})}/></Field>)}<Button onClick={()=>act('package',{...evidence,manifest:evidence.manifest.split('\n').map(s=>s.trim()).filter(Boolean)})}>保存交付证据</Button></fieldset>}
 {order.package&&<details><summary>已登记的交付证据</summary><pre className="cl-json">{JSON.stringify(order.package,null,2)}</pre></details>}
 <Field label="操作说明 / 验收结论 / 退回原因"><textarea value={note} onChange={e=>setNote(e.target.value)}/></Field>
 {order.status==='draft'&&allowed('submit')&&<Button disabled={!order.package} onClick={()=>act('submit')}>提交客户验收</Button>}
 {order.status==='submitted'&&allowed('accept')&&<><Button onClick={()=>act('accept')}>验收签收</Button><Button onClick={()=>act('reject')}>退回重做</Button></>}
 {order.status==='submitted'&&!allowed('accept')&&<p>请切换至指定验收成员完成验收。</p>}
 {order.status==='accepted'&&allowed('openFeedback')&&<Button onClick={()=>act('openFeedback')}>提交售后反馈</Button>}
 {order.status==='accepted'&&allowed('requestRevision')&&<fieldset><legend>售后纠错分派</legend><p>按完整冻结版本创建独立纠错批次，保留原交付。</p>{[['纠错标注人','edit',worker,setWorker],['纠错审核人','approve',reviewer,setReviewer]].map(([label,permission,value,set])=><Field key={label} label={label}><select value={value} onChange={e=>set(e.target.value)}><option value="">请选择成员</option>{platform.settings.users.filter(u=>canAccess(platform.settings,u.id,platform.activeSpaceId,permission,order.projectId).ok).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>)}<Field label="纠错完成期限"><input type="datetime-local" value={due} onChange={e=>setDue(e.target.value)}/></Field></fieldset>}
 {order.feedback.map(f=><div key={f.id}><p>{f.id} · {f.status==='open'?'待处理':'已关闭'}：{f.note}</p>{f.status==='open'&&!f.correction&&!f.revisionId&&allowed('requestRevision')&&<Button onClick={()=>act('createCorrection',{feedbackId:f.id,assigneeId:worker,reviewerId:reviewer,dueAt:due?new Date(due).toISOString():''})}>生成纠错工单</Button>}{f.correction&&<Button onClick={()=>onNavigate('work-orders',{taskId:f.correction.taskId})}>打开纠错工单 {f.correction.taskId}</Button>}{f.revisionId&&<button onClick={()=>setSelected(f.revisionId)}>查看补交 {f.revisionId}</button>}{f.status==='open'&&allowed('closeFeedback')&&<Button onClick={()=>act('closeFeedback',{feedbackId:f.id})}>按处理说明关闭反馈</Button>}</div>)}
 {['accepted','rejected'].includes(order.status)&&allowed('requestRevision')&&<fieldset><legend>创建补交单（保留原版本）</legend><Field label="修订后的发布版本"><select value={newVersionId} onChange={e=>setNewVersion(e.target.value)}><option value="">请选择新版本</option>{eligible.filter(v=>v.projectId===order.projectId&&v.id!==order.versionId).map(v=><option key={v.id} value={v.id}>{v.id}</option>)}</select></Field><Field label="关联反馈（已签收订单必选）"><select value={feedbackId} onChange={e=>setFeedback(e.target.value)}><option value="">请选择反馈</option>{order.feedback.filter(f=>f.status==='open').map(f=><option key={f.id} value={f.id}>{f.note}</option>)}</select></Field><Button onClick={()=>act('requestRevision',{newVersionId,feedbackId:feedbackId||undefined})}>创建补交</Button></fieldset>}
 {['draft','rejected'].includes(order.status)&&allowed('cancel')&&<Button onClick={()=>act('cancel')}>取消交付</Button>}
 <details><summary>操作历史（{order.history.length}）</summary>{order.history.map((h,i)=><p key={i}>{h.at} · {h.actorId} · {h.action} · {h.note}</p>)}</details>
 </div>}</Panel></div></div>;
}
