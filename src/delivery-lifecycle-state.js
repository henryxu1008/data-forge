// Pure prototype domain state machine. Does not authorize access, transfer files or notify customers.
// Caller must validate workspace/project permission and governance before invoking.
const copy = x => structuredClone(x);
const err = message => ({ok:false,error:message});
const required = (s,n) => typeof s === 'string' && s.trim() ? null : n+'不能为空';
export const createDeliveryState = () => ({sequence:0,orders:[],events:[]});
const events = (state,action,order,at,actorId) => state.events.unshift({orderId:order.id,action,at,actorId,status:order.status});
const appendHistory = (o,action,actorId,at,note='') => o.history.push({action,actorId,at,note});
const unique = xs => [...new Set(xs)];
// Follow the latest non-cancelled replacement without rewriting intermediate orders.
export function acceptedReplacement(state,orderId,seen=new Set()){
 if(seen.has(orderId))return null;const order=state.orders.find(o=>o.id===orderId);if(!order)return null;
 if(order.status==='accepted')return order;
 if(order.status!=='rejected')return null;
 const path=new Set(seen);path.add(orderId);const next=[...order.revisions].reverse().map(id=>state.orders.find(o=>o.id===id)).find(o=>o&&o.status!=='cancelled');
 return next?acceptedReplacement(state,next.id,path):null;
}
function descendant(state,childId,parentId){const seen=new Set();let o=state.orders.find(o=>o.id===childId);while(o&&!seen.has(o.id)){if(o.id===parentId)return true;seen.add(o.id);o=state.orders.find(x=>x.id===o.revisionOf);}return false;}
export function applyDeliveryAction(state,action,context={}) {
  const {actorId,at=new Date().toISOString(),canAccess=()=>false,versionEligible=()=>false}=context;
  if(required(actorId,'操作人')||!Number.isFinite(Date.parse(at)))return err('操作身份或时间无效');
  if(!action||typeof action.type!=='string')return err('操作类型无效');
  const s=copy(state), a=action;
  if(a.type==='create') {
    if(required(a.projectId,'项目')||required(a.customerId,'客户')||required(a.versionId,'数据版本'))return err('缺少必要的交付信息');
    if(!canAccess(actorId,a.projectId,'create'))return err('无权创建交付单');
    if(!versionEligible(a.versionId,a.projectId))return err('数据版本未通过交付前检查');
    const id='DLV-'+(++s.sequence);
    const order={id,projectId:a.projectId,customerId:a.customerId,versionId:a.versionId,status:'draft',revisionOf:null,revisions:[],package:null,feedback:[],history:[]};
    appendHistory(order,'create',actorId,at);s.orders.unshift(order);events(s,'create',order,at,actorId);return {ok:true,state:s,order};
  }
  const o=s.orders.find(x=>x.id===a.orderId);
  if(!o)return err('交付单不存在');
  const project=o.projectId;
  const perms={package:'edit',submit:'submit',accept:'accept',reject:'accept',openFeedback:'feedback',closeFeedback:'edit',requestRevision:'edit',cancel:'cancel'};
  if(!perms[a.type])return err('不支持的操作');
  if(!canAccess(actorId,project,perms[a.type],o.customerId))return err('无权操作该交付单');
  const inStatus=(...allowed)=>allowed.includes(o.status);
  switch(a.type){
    case 'package':
      if(!inStatus('draft'))return err('只有草稿可生成交付包');
      if(!versionEligible(o.versionId,project))return err('当前数据版本不可交付');
      if(!Array.isArray(a.manifest)||!a.manifest.length||a.manifest.some(x=>required(x,'文件')))return err('交付文件清单不能为空且必须为文件名数组');
      if(required(a.checksum,'校验和')||required(a.qualityReportId,'质量报告')||required(a.licenseRef,'许可引用'))return err('交付证据不完整');
      o.package={versionId:o.versionId,checksum:a.checksum,qualityReportId:a.qualityReportId,licenseRef:a.licenseRef,manifest:unique(a.manifest||[])};
      break;
    case 'submit':
      if(!inStatus('draft')||!o.package)return err('交付包未准备完成或交付单状态不正确');
      if(!versionEligible(o.versionId,project))return err('数据版本已不符合交付条件');
      o.status='submitted';break;
    case 'accept':
      if(!inStatus('submitted'))return err('仅已提交的交付单可验收');
      if(!versionEligible(o.versionId,project))return err('数据版本已不符合验收条件');
      if(required(a.note,'验收结论'))return err('验收结论不能为空');
      o.status='accepted';o.acceptedBy=actorId;o.acceptedAt=at;break;
    case 'reject':
      if(!inStatus('submitted'))return err('仅已提交的交付单可拒收');
      if(required(a.note,'退回原因'))return err('退回原因不能为空');
      o.status='rejected';break;
    case 'openFeedback':
      if(!inStatus('accepted'))return err('仅已验收交付单可提交售后反馈');
      if(required(a.note,'反馈内容'))return err('反馈内容不能为空');
      o.feedback.push({id:o.id+'-FB-'+(o.feedback.length+1),status:'open',note:a.note,actorId,at});break;
    case 'closeFeedback':{
      const f=o.feedback.find(x=>x.id===a.feedbackId);
      if(!f||f.status!=='open')return err('反馈不存在或已经关闭');
      const resolved=f.revisionId?acceptedReplacement(s,f.revisionId):null;
      if(f.revisionId&&!resolved)return err('关联补交尚未验收，不能关闭反馈');
      if(required(a.note,'处理说明'))return err('处理说明不能为空');
      f.status='closed';if(resolved)f.resolvedRevisionId=resolved.id;f.resolution=a.note;f.resolvedBy=actorId;f.resolvedAt=at;break;
    }
    case 'requestRevision':{
      if(!inStatus('rejected','accepted'))return err('仅拒收或已验收的交付可以申请补交');
      if(required(a.newVersionId,'新版本'))return err('缺少补交版本');
      if(a.newVersionId===o.versionId)return err('补交必须使用新版本');
      if(!versionEligible(a.newVersionId,project))return err('补交版本不满足交付条件');
      if(required(a.note,'补交原因'))return err('补交原因不能为空');
      const feedback=a.feedbackId?o.feedback.find(f=>f.id===a.feedbackId&&f.status==='open'):null;
      if(inStatus('accepted')&&!feedback)return err('已验收交付补交必须关联未关闭反馈');
      if(a.feedbackId&&!feedback)return err('反馈不存在或已经关闭');
      if(o.revisions.some(id=>{const r=s.orders.find(x=>x.id===id);return r&&['draft','submitted'].includes(r.status)}))return err('已有进行中的补交单');
      const id='DLV-'+(++s.sequence);
      if(feedback)feedback.revisionId=id;
      const next={id,projectId:project,customerId:o.customerId,versionId:a.newVersionId,status:'draft',revisionOf:o.id,revisions:[],package:null,feedback:[],history:[]};
      appendHistory(o,'requestRevision',actorId,at,a.note);
      appendHistory(next,'createRevision',actorId,at,a.note||'');o.revisions.push(id);s.orders.unshift(next);events(s,'requestRevision',o,at,actorId);events(s,'createRevision',next,at,actorId);return {ok:true,state:s,order:next};
    }
    case 'cancel':
      if(!inStatus('draft','rejected'))return err('当前状态不能取消交付');
      if(required(a.note,'取消原因'))return err('取消原因不能为空');
      o.status='cancelled';break;
  }
  appendHistory(o,a.type,actorId,at,a.note||'');
  events(s,a.type,o,at,actorId);return {ok:true,state:s,order:o};
}
export const deliveryTodos=(state)=>{const superseded=new Set(state.orders.flatMap(o=>o.feedback.flatMap(f=>(f.correctionHistory||[]).map(h=>h.revisionId))));return state.orders.filter(o=>(['draft','submitted'].includes(o.status)||(o.status==='rejected'&&!superseded.has(o.id)&&!o.revisions.some(id=>state.orders.some(r=>r.id===id&&r.status!=='cancelled'))))||o.feedback.some(f=>f.status==='open')).map(o=>({id:o.id,projectId:o.projectId,status:o.status,feedbackOpen:o.feedback.filter(f=>f.status==='open').length}));};

// Legacy snapshots may omit delivery. Once present, reject malformed references.
export function validateDeliveryState(state,versions){
 if(state===undefined)return;
 const fail=()=>{throw new Error('交付快照结构或版本关联无效。')};
 if(!state||!Number.isSafeInteger(state.sequence)||state.sequence<0||!Array.isArray(state.orders)||!Array.isArray(state.events))fail();
 const ids=new Set();
 for(const o of state.orders){
  if(!o||typeof o.id!=='string'||ids.has(o.id)||!/^DLV-[1-9]\d*$/.test(o.id)||Number(o.id.slice(4))>state.sequence)fail();ids.add(o.id);
  if(!['draft','submitted','accepted','rejected','cancelled'].includes(o.status)||!o.projectId||!o.customerId||!versions.some(v=>v.id===o.versionId)||!Array.isArray(o.history)||!o.history.length||!Array.isArray(o.feedback)||!Array.isArray(o.revisions))fail();
  const version=versions.find(v=>v.id===o.versionId);if(version.projectId!==o.projectId)fail();
  if(o.versionSnapshot&&JSON.stringify(o.versionSnapshot)!==JSON.stringify(version))fail();
  if(o.status==='accepted'&&(o.acceptedBy!==o.customerId||!Number.isFinite(Date.parse(o.acceptedAt))||!o.history.some(h=>h.action==='accept'&&h.actorId===o.acceptedBy&&h.at===o.acceptedAt&&h.note?.trim())||o.history.some(h=>['create','createRevision','package','submit'].includes(h.action)&&h.actorId===o.acceptedBy)))fail();
  if(['submitted','accepted','rejected'].includes(o.status)&&!o.package)fail();
  if(o.package&&(o.package.versionId!==o.versionId||!o.package.checksum||!o.package.qualityReportId||!o.package.licenseRef||!Array.isArray(o.package.manifest)||!o.package.manifest.length))fail();
  if(o.history.some(h=>!h.actorId||!Number.isFinite(Date.parse(h.at))))fail();
  if(new Set(o.feedback.map(f=>f.id)).size!==o.feedback.length||o.feedback.some(f=>!f.id||!['open','closed'].includes(f.status)||!f.note))fail();
 }
 for(const o of state.orders){
  const ancestors=new Set([o.id]);let parent=o.revisionOf;while(parent){if(ancestors.has(parent))fail();ancestors.add(parent);parent=state.orders.find(x=>x.id===parent)?.revisionOf;}
  if(o.revisionOf&&!state.orders.some(p=>p.id===o.revisionOf&&p.revisions.includes(o.id)&&p.projectId===o.projectId&&p.customerId===o.customerId&&p.versionId!==o.versionId))fail();
  if(o.revisions.some(id=>!state.orders.some(r=>r.id===id&&r.revisionOf===o.id)))fail();
  for(const f of o.feedback){
   if(f.revisionId&&!state.orders.some(r=>r.id===f.revisionId&&r.revisionOf===o.id))fail();
   if(f.resolvedRevisionId&&(!f.revisionId||f.status!=='closed'||!descendant(state,f.resolvedRevisionId,f.revisionId)))fail();
   if(f.status==='closed'&&f.revisionId){const resolved=f.resolvedRevisionId?state.orders.find(r=>r.id===f.resolvedRevisionId):acceptedReplacement(state,f.revisionId);if(resolved?.status!=='accepted')fail();}
  }
 }
 if(state.events.some(e=>!ids.has(e.orderId)))fail();
}
