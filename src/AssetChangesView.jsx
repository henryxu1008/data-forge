import React,{useState} from 'react';
import {Button,Field,Panel,Badge,Empty} from './ui.jsx';
import {sourceCatalog} from './governance-sources.js';
import {changeKinds} from './asset-changes.js';
function ChangeCard({event:e,call,onNavigate}){
 const [note,setNote]=useState(''),[evidence,setEvidence]=useState('');
 return <Panel title={`${e.id} · ${changeKinds[e.kind]}`}><div className="gov-body">
  <Badge tone={e.status==='passed'?'mint':'amber'}>{({pending:'待重验',failed:'重验失败',passed:'重验通过（人工复核）'})[e.status]}</Badge>
  <p>{e.sourceId} · 变更版本 {e.revision}</p><p>{e.note}</p>
  <details><summary>冻结影响清单 · {e.impactSnapshot.length} 个对象</summary>{e.impactSnapshot.map((x,i)=><p key={i}>{x.type} · {x.name} <Button onClick={()=>onNavigate(x.target,x)}>查看对象</Button></p>)}</details>
  {e.status!=='passed'&&<><Field label={`重验说明 ${e.id}`}><textarea value={note} onChange={x=>setNote(x.target.value)}/></Field><Field label={`证据引用 ${e.id}`}><textarea value={evidence} onChange={x=>setEvidence(x.target.value)} placeholder="覆盖影响清单的检查记录、重建或复测版本引用"/></Field><div className="gov-actions">{e.status==='failed'?<Button disabled={!note.trim()} onClick={()=>call('retryChange',{changeId:e.id,note})}>重试重验</Button>:<><Button disabled={!note.trim()} onClick={()=>call('reviewChange',{changeId:e.id,note,evidence,result:'failed'})}>记录重验失败</Button><Button disabled={!note.trim()||!evidence.trim()} onClick={()=>call('reviewChange',{changeId:e.id,note,evidence,result:'passed'})}>记录重验通过</Button></>}</div></>}
  <details><summary>变更与重验审计记录</summary><pre className="gov-json">{JSON.stringify(e,null,2)}</pre></details>
 </div></Panel>;
}
export default function AssetChangesView({w,projectId,call,onNavigate}){
 const sources=sourceCatalog(w).filter(s=>s.projectId===projectId),[sourceId,setSourceId]=useState(''),[kind,setKind]=useState('data'),[revision,setRevision]=useState(''),[key,setKey]=useState(''),[note,setNote]=useState('');
 const selected=sources.find(s=>s.id===sourceId)||sources[0],events=(w.governance?.changes||[]).filter(e=>e.projectId===projectId);
 return <><Panel title="登记资产变更" description="本地已有来源内容或规范变更会自动生成事件；外部变更可在此登记版本引用。相同事件键不会重复建单。"><div className="gov-body">
  <Field label="变更数据来源"><select value={selected?.id||''} onChange={e=>setSourceId(e.target.value)}>{sources.map(s=><option key={s.id} value={s.id}>{s.name} · {s.id}</option>)}</select></Field>
  <Field label="变更类型"><select value={kind} onChange={e=>setKind(e.target.value)}><option value="data">数据内容变更</option><option value="spec">标注规范变更</option></select></Field>
  <Field label="事件唯一键"><input value={key} onChange={e=>setKey(e.target.value)}/></Field><Field label="变更版本引用"><input value={revision} onChange={e=>setRevision(e.target.value)}/></Field><Field label="变更原因"><textarea value={note} onChange={e=>setNote(e.target.value)}/></Field>
  <Button variant="primary" disabled={!selected||![key,revision,note].every(x=>x.trim())} onClick={()=>call('recordChange',{sourceId:selected.id,kind,eventKey:key,revision,note})}>登记变更并生成重验待办</Button>
  <p>当前立项质量负责人按冻结影响清单人工复核。失败可重试；通过需证据引用及有效来源准入。许可撤回请在“数据准入与影响”操作。历史版本不会被改写；人工结论不代表真实模型或数据效果验证。</p>
 </div></Panel>{events.length?events.map(e=><ChangeCard key={e.id} event={e} call={call} onNavigate={onNavigate}/>):<Empty title="当前项目暂无变更重验任务"/>}</>;
}
