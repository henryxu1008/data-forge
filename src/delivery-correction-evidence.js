// A correction obligation follows every descendant, including legacy replacement chains.
export function correctionOwner(w,orderId){
 const seen=new Set();let id=orderId;
 while(id&&!seen.has(id)){
  seen.add(id);
  for(const o of w.delivery?.orders||[])for(const f of o.feedback)if(f.correction&&(f.revisionId===id||f.correctionHistory?.some(h=>h.revisionId===id)))return {order:o,feedback:f};
  id=w.delivery?.orders.find(o=>o.id===id)?.revisionOf;
 }
 return null;
}
export function correctionVersionMatches(w,feedback,versionId){
 const c=feedback.correction,t=w.workOrders?.orders.find(t=>t.id===c?.taskId),b=w.textBatches[c?.datasetId]||w.imageBatches[c?.datasetId],v=b?.versions.find(v=>v.id===versionId);
 return !!t&&t.status==='accepted'&&t.datasetId===c.datasetId&&!!v&&v.datasetId===c.datasetId&&v.sourceRevision===t.acceptedRevision;
}
