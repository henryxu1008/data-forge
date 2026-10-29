// Pure prototype domain state machine. Does not authorize access, transfer files or notify customers.
// Caller must validate workspace/project permission and governance before invoking.
const copy = x => structuredClone(x);
const err = message => ({ok:false,error:message});
const required = (s,n) => typeof s === 'string' && s.trim() ? null : n+'不能为空';
export const createDeliveryState = () => ({sequence:0,orders:[],events:[]});
const events = (state,action,order,at,actorId) => state.events.unshift({orderId:order.id,action,at,actorId,status:order.status});
const appendHistory = (o,action,actorId,at,note='') => o.history.push({action,actorId,at,note});
const unique = xs => [...new Set(xs)];
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
      if(required(a.checksum,'校验和')||required(a.qualityReportId,'质量报告')||required(a.licenseRef,'许可引用'))return err('交付证据不完整');
      o.package={versionId:o.versionId,checksum:a.checksum,qualityReportId:a.qualityReportId,licenseRef:a.licenseRef,manifest:unique(a.manifest||[])};
      break;
    case 'submit':
      if(!inStatus('draft')||!o.package)return err('交付包未准备完成或交付单状态不正确');
      if(!versionEligible(o.versionId,project))return err('数据版本已不符合交付条件');
      o.status='submitted';break;
    case 'accept':
      if(!inStatus('submitted'))return err('仅已提交的交付单可验收');
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
      if(required(a.note,'处理说明'))return err('处理说明不能为空');
      f.status='closed';f.resolution=a.note;f.resolvedBy=actorId;f.resolvedAt=at;break;
    }
    case 'requestRevision':{
      if(!inStatus('rejected','accepted'))return err('仅拒收或已验收的交付可以申请补交');
      if(required(a.newVersionId,'新版本'))return err('缺少补交版本');
      if(a.newVersionId===o.versionId)return err('补交必须使用新版本');
      if(!versionEligible(a.newVersionId,project))return err('补交版本不满足交付条件');
      const id='DLV-'+(++s.sequence);
      const next={id,projectId:project,customerId:o.customerId,versionId:a.newVersionId,status:'draft',revisionOf:o.id,revisions:[],package:null,feedback:[],history:[]};
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
export const deliveryTodos=(state)=>state.orders.filter(o=>['draft','submitted','rejected'].includes(o.status)||o.feedback.some(f=>f.status==='open')).map(o=>({id:o.id,projectId:o.projectId,status:o.status,feedbackOpen:o.feedback.filter(f=>f.status==='open').length}));
