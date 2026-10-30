import {approvalActor} from './production-approvals.js';
export const dueSoonMs=24*60*60*1000;
export function workOwner(t){return t.status==='accepted'||t.status==='disputed'?null:t.status==='review'?approvalActor(t):t.assigneeId;}
export function workTiming(t,now=Date.now()){
 const due=Date.parse(t.dueAt),time=typeof now==='number'?now:Date.parse(now);
 if(!Number.isFinite(due)||!Number.isFinite(time))return {state:'invalid',label:'期限无效'};
 if(t.status==='accepted'){
  const accepted=t.history?.findLast(h=>h.action==='accept'&&h.status==='accepted')?.at;
  const late=Number.isFinite(Date.parse(accepted))&&Date.parse(accepted)>due;
  return {state:'completed',label:late?'逾期完成':'已完成',completedLate:late};
 }
 const remainingMs=due-time;
 return remainingMs<=0?{state:'overdue',label:'已逾期',remainingMs}:remainingMs<=dueSoonMs?{state:'soon',label:'24 小时内到期',remainingMs}:{state:'normal',label:'期限内',remainingMs};
}
export function recordDeadlineChange(t,before,actorId,action,note,at){
 const changes=t.deadlineChanges||[];
 t.deadlineChanges=[...changes,{number:changes.length+1,action,actorId,at,note:note.trim(),fromDueAt:before.dueAt,toDueAt:t.dueAt,fromAssigneeId:before.assigneeId,toAssigneeId:t.assigneeId,wasOverdue:Date.parse(at)>=Date.parse(before.dueAt)}];
}
export function validateDeadlineChanges(t,settings){
 if(t.deadlineChanges===undefined)return;
 const bad=()=>{throw Error('生产工单期限调整记录无效。')};
 if(!Array.isArray(t.deadlineChanges)||!t.deadlineChanges.length)bad();
 for(const [i,c] of t.deadlineChanges.entries()){
  if(c.number!==i+1||!['extendDeadline','reassign'].includes(c.action)||!c.note?.trim()||![c.actorId,c.fromAssigneeId,c.toAssigneeId].every(id=>settings.users.some(u=>u.id===id))||![c.at,c.fromDueAt,c.toDueAt].every(x=>Number.isFinite(Date.parse(x)))||Date.parse(c.toDueAt)<=Date.parse(c.at)||Date.parse(c.toDueAt)<=Date.parse(c.fromDueAt)||c.wasOverdue!==(Date.parse(c.at)>=Date.parse(c.fromDueAt)))bad();
  if(c.action==='extendDeadline'&&c.fromAssigneeId!==c.toAssigneeId||c.action==='reassign'&&(!c.wasOverdue||c.fromAssigneeId===c.toAssigneeId))bad();
  if(i&&(c.fromDueAt!==t.deadlineChanges[i-1].toDueAt||c.fromAssigneeId!==t.deadlineChanges[i-1].toAssigneeId))bad();
  if(!t.history.some(h=>h.action===c.action&&h.actorId===c.actorId&&h.at===c.at&&h.note===c.note&&h.assigneeId===c.toAssigneeId))bad();
 }
 const last=t.deadlineChanges.at(-1);if(last.toDueAt!==t.dueAt||last.toAssigneeId!==t.assigneeId)bad();
}
