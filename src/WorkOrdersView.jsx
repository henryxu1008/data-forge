import React,{useState,useEffect} from 'react';
import {PageHeader,Panel,Field,Button,Empty} from './ui.jsx';
import {canAccess} from './platform-policy.js';
import {workStatuses} from './production-workflow.js';
import './completion.css';
export default function WorkOrdersView({w,platform,onWorkOrder,onNavigate,request}){
 const [selected,setSelected]=useState(request?.taskId||''),[datasetId,setDataset]=useState(''),[assigneeId,setAssignee]=useState(''),[reviewerId,setReviewer]=useState(''),[dueAt,setDue]=useState(''),[note,setNote]=useState(''),[error,setError]=useState('');
 const tasks=w.workOrders?.orders||[],task=tasks.find(t=>t.id===selected),batches=[...Object.values(w.textBatches),...Object.values(w.imageBatches)],batch=batches.find(b=>b.datasetId===(task?.datasetId||datasetId));
 useEffect(()=>{if(request?.taskId)setSelected(request.taskId)},[request?.key]);
 const people=permission=>platform.settings.users.filter(u=>batch&&canAccess(platform.settings,u.id,platform.activeSpaceId,permission,batch.projectId).ok);
 function act(type,extra={}){const r=onWorkOrder({type,taskId:task?.id,note,...extra});if(!r.ok){setError(r.error);return}setError('');setSelected(r.task.id);setNote('')}
 const due=()=>dueAt?new Date(dueAt).toISOString():'';
 const manager=batch&&(canAccess(platform.settings,platform.actorId,platform.activeSpaceId,'members',batch.projectId).ok||canAccess(platform.settings,platform.actorId,platform.activeSpaceId,'edit',batch.projectId).role?.id==='project-manager');
 return <div className="cl-page"><PageHeader title="生产工单" description="分派与领取 → 样本生产 → 批次验收 → 退回与仲裁"/><p className="cl-hint">本地原型：按整个批次验收；到期后由负责人手工转派，不会自动通知或调度。</p>{error&&<p className="cl-error" role="alert">{error}</p>}
 <Panel title={task?'工单分派信息':'创建生产工单'}><div className="cl-body">
 {!task&&<Field label="生产批次"><select value={datasetId} onChange={e=>{setDataset(e.target.value);setAssignee('');setReviewer('')}}><option value="">请选择未发布批次</option>{batches.filter(b=>!tasks.some(t=>t.datasetId===b.datasetId)&&b.records.length&&!b.versions.length).map(b=><option key={b.datasetId} value={b.datasetId}>{b.name}</option>)}</select></Field>}
 <Field label={task?'超时后转派给':'标注成员'}><select value={assigneeId} onChange={e=>setAssignee(e.target.value)}><option value="">请选择标注成员</option>{people('edit').map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
 {!task&&<Field label="审核成员"><select value={reviewerId} onChange={e=>setReviewer(e.target.value)}><option value="">请选择独立审核成员</option>{people('approve').filter(u=>u.id!==assigneeId).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>}
 <Field label="完成期限"><input type="datetime-local" value={dueAt} onChange={e=>setDue(e.target.value)}/></Field>
 {!task?<Button disabled={!manager} onClick={()=>act('create',{datasetId,assigneeId,reviewerId,dueAt:due()})}>创建并分派</Button>:<Button disabled={!manager||!['assigned','claimed','rework'].includes(task.status)||Date.now()<=Date.parse(task.dueAt)} onClick={()=>act('reassign',{assigneeId,dueAt:due()})}>超时转派</Button>}
 {task&&<Button onClick={()=>setSelected('')}>新建另一工单</Button>}</div></Panel>
 <div className="cl-grid"><Panel title="工单列表"><div className="cl-list">{tasks.map(t=><button key={t.id} onClick={()=>setSelected(t.id)}><strong>{t.id} · {workStatuses[t.status]}</strong><small>{t.name}</small></button>)}</div>{!tasks.length&&<Empty title="暂无生产工单"/>}</Panel><Panel title={task?`${task.id} · ${workStatuses[task.status]}`:'工单详情'}>{task?<div className="cl-body">
 <p>标注：{platform.settings.users.find(u=>u.id===task.assigneeId)?.name}　审核：{platform.settings.users.find(u=>u.id===task.reviewerId)?.name}</p><p>截止：{new Date(task.dueAt).toLocaleString('zh-CN')}</p>
 <Button onClick={()=>onNavigate('review',{datasetId:task.datasetId})}>打开标注与审核</Button><Button onClick={()=>onNavigate('quality',{datasetId:task.datasetId})}>打开质量检查与发布</Button>
 <Field label="工单处理原因"><textarea value={note} onChange={e=>setNote(e.target.value)}/></Field>
 {platform.actorId===task.assigneeId&&<>{['assigned','rework'].includes(task.status)&&<Button onClick={()=>act('claim')}>领取工单</Button>}{task.status==='claimed'&&<Button onClick={()=>act('submit')}>提交批次验收</Button>}{task.status==='rework'&&<Button onClick={()=>act('dispute')}>提起争议</Button>}</>}
 {platform.actorId===task.reviewerId&&task.status==='review'&&<><Button onClick={()=>act('accept')}>通过批次验收</Button><Button onClick={()=>act('return')}>退回批次返工</Button></>}
 {task.status==='disputed'&&![task.assigneeId,task.reviewerId].includes(platform.actorId)&&canAccess(platform.settings,platform.actorId,platform.activeSpaceId,'approve',task.projectId).ok&&<><Button onClick={()=>act('arbitrate',{decision:'rework'})}>仲裁：维持返工</Button><Button onClick={()=>act('arbitrate',{decision:'review'})}>仲裁：重新审核</Button></>}
 <details><summary>工单历史（{task.history.length}）</summary>{task.history.map((h,i)=><p key={i}>{h.at} · {h.actorId} · {h.action} · {h.note}</p>)}</details>
 </div>:<Empty title="请选择工单"/>}</Panel></div></div>;
}
