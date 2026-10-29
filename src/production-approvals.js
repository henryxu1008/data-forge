export const approvalLabels=['初审','复审','最终验收'];
export function activeApproval(t){const cycle=t.approvalCycles?.at(-1);return cycle&&!cycle.returnedAt?cycle:null;}
export function approvalIndex(t){return activeApproval(t)?.decisions.length||0;}
export function approvalActor(t){return t.approvalChain?t.approvalChain[approvalIndex(t)]:t.reviewerId;}
export function approvalComplete(t,b){const c=activeApproval(t);return !t.approvalChain||!!c&&c.decisions.length===3&&c.revision===b.revision&&JSON.stringify(c.records)===JSON.stringify(b.records)&&JSON.stringify(c.quality)===JSON.stringify(b.quality);}
export function approveStage(t,b,actorId,note,at){
 if(!note?.trim())return {ok:false,error:'请填写本级审核结论'};
 if(actorId!==approvalActor(t))return {ok:false,error:'只能由当前级别指定审核人按顺序审批'};
 let c=activeApproval(t);
 if(c&&(c.revision!==b.revision||JSON.stringify(c.records)!==JSON.stringify(b.records)||JSON.stringify(c.quality)!==JSON.stringify(b.quality)))return {ok:false,error:'审核依据已变化，请退回后重新审核'};
 if(!c){c={number:t.approvalCycles.length+1,revision:b.revision,records:structuredClone(b.records),quality:structuredClone(b.quality),decisions:[]};t.approvalCycles.push(c);}
 c.decisions.push({stage:c.decisions.length,actorId,note:note.trim(),at});return {ok:true,complete:c.decisions.length===3};
}
export function validateApprovals(t,b,settings){
 const bad=()=>{throw Error('生产工单多级审核快照无效。')};
 if(t.approvalChain===undefined){if(t.approvalCycles!==undefined)bad();return;}
 if(!Array.isArray(t.approvalChain)||t.approvalChain.length!==3||t.approvalChain[0]!==t.reviewerId||new Set([...t.approvalChain,t.assigneeId]).size!==4||t.approvalChain.some(id=>!settings.users.some(u=>u.id===id))||!Array.isArray(t.approvalCycles))bad();
 for(const [i,c] of t.approvalCycles.entries()){
  if(c.number!==i+1||!Number.isSafeInteger(c.revision)||!Array.isArray(c.records)||!c.records.length||c.records.some(r=>r.status!=='approved')||c.quality?.status!=='passed'||(c.quality.revision??c.quality.sourceRevision)!==c.revision||!Array.isArray(c.decisions)||!c.decisions.length||c.decisions.length>3)bad();
  if(c.decisions.some((d,j)=>d.stage!==j||d.actorId!==t.approvalChain[j]||!d.note?.trim()||!Number.isFinite(Date.parse(d.at))))bad();
  if(i&&(!t.approvalCycles[i-1].returnedAt||c.revision<=t.approvalCycles[i-1].revision))bad();
  if(c.returnedAt){if(!Number.isFinite(Date.parse(c.returnedAt))||!c.returnReason?.trim()||c.returnedBy!==t.approvalChain[c.decisions.length])bad();}
  else if(i!==t.approvalCycles.length-1||!['review','accepted'].includes(t.status)||c.revision!==b.revision||JSON.stringify(c.records)!==JSON.stringify(b.records)||JSON.stringify(c.quality)!==JSON.stringify(b.quality))bad();
 }
 if(t.status==='accepted'&&!approvalComplete(t,b))bad();
 if(t.status!=='accepted'&&activeApproval(t)?.decisions.length===3)bad();
}
