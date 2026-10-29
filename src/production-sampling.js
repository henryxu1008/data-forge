// Batch sampling is an additional acceptance gate after per-record review.
export function validSamplingPolicy(p){return !!p&&Number.isFinite(p.rate)&&p.rate>0&&p.rate<=100&&Number.isSafeInteger(p.minimum)&&p.minimum>0&&Number.isFinite(p.threshold)&&p.threshold>0&&p.threshold<=100;}
export function samplingPassed(t,b){const r=t.samplingRounds?.at(-1);return !t.samplingPolicy||(r?.status==='passed'&&!r.returnedAt&&r.revision===b.revision&&JSON.stringify(r.population)===JSON.stringify(b.records));}
export function applySampling(t,b,a,actorId,at){
 const fail=error=>({ok:false,error});
 if(!t.samplingPolicy||t.status!=='review'||actorId!==t.reviewerId)return fail('仅指定审核人可在待验收阶段执行抽检');
 const rounds=t.samplingRounds||[],last=rounds.at(-1);
 if(a.type==='startSampling'){
  if(b.records.some(r=>r.status!=='approved')||b.quality?.status!=='passed'||(b.quality.revision??b.quality.sourceRevision)!==b.revision)return fail('请先完成全部样本审核及当前修订质量检查');
  if(last&&(!last.returnedAt||last.revision===b.revision))return fail('本修订已抽检；不合格须退回返工，不能重新抽取名单');
  const count=Math.min(b.records.length,Math.max(t.samplingPolicy.minimum,Math.ceil(b.records.length*t.samplingPolicy.rate/100)));
  const ids=b.records.map(r=>r.id);
  // Fisher-Yates with browser/Node Web Crypto; no caller-provided seed or list.
  for(let i=ids.length-1;i>0;i--){const bound=i+1,limit=Math.floor(4294967296/bound)*bound;let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0]}while(n>=limit);const j=n%bound;[ids[i],ids[j]]=[ids[j],ids[i]];}
  t.samplingRounds=[...rounds,{number:rounds.length+1,revision:b.revision,policy:structuredClone(t.samplingPolicy),population:structuredClone(b.records),sampleIds:ids.slice(0,count),results:[],status:'pending',startedAt:at,actorId}];
 }else{
  if(!last||last.returnedAt||last.status!=='pending'||last.revision!==b.revision||JSON.stringify(last.population)!==JSON.stringify(b.records))return fail('抽检未启动、已结束或数据已变化，请返工后复检');
  if(a.type==='recordSampling'){
   if(!last.sampleIds.includes(a.recordId)||!['pass','fail'].includes(a.verdict)||!a.note?.trim()||last.results.some(r=>r.recordId===a.recordId))return fail('只能判定名单内未检查的样本，并填写依据');
   last.results.push({recordId:a.recordId,verdict:a.verdict,note:a.note.trim(),actorId,at});
  }else if(a.type==='finishSampling'){
   if(last.results.length!==last.sampleIds.length)return fail('请完成全部抽检样本判定');
   last.passRate=last.results.filter(r=>r.verdict==='pass').length/last.sampleIds.length*100;last.status=last.results.filter(r=>r.verdict==='pass').length*100>=last.sampleIds.length*last.policy.threshold?'passed':'failed';last.finishedAt=at;
  }else return fail('未知抽检操作');
 }
 return {ok:true};
}
export function validateSampling(t,b){
 const bad=()=>{throw Error('生产工单抽检快照无效。')};
 if(!t.samplingPolicy){if(t.samplingRounds?.length)bad();return;}
 if(!validSamplingPolicy(t.samplingPolicy)||!Array.isArray(t.samplingRounds))bad();
 for(const [i,r] of t.samplingRounds.entries()){
  if(r.number!==i+1||!Number.isSafeInteger(r.revision)||r.actorId!==t.reviewerId||!Number.isFinite(Date.parse(r.startedAt))||JSON.stringify(r.policy)!==JSON.stringify(t.samplingPolicy)||!Array.isArray(r.population)||!r.population.length||!Array.isArray(r.sampleIds)||!Array.isArray(r.results)||!['pending','passed','failed'].includes(r.status))bad();
  if(i&&(!t.samplingRounds[i-1].returnedAt||r.revision<=t.samplingRounds[i-1].revision))bad();
  if(r.population.some(x=>x.status!=='approved'))bad();
  const ids=r.population.map(x=>x.id),count=Math.min(ids.length,Math.max(r.policy.minimum,Math.ceil(ids.length*r.policy.rate/100)));
  if(new Set(ids).size!==ids.length||r.sampleIds.length!==count||new Set(r.sampleIds).size!==count||r.sampleIds.some(id=>!ids.includes(id))||new Set(r.results.map(x=>x.recordId)).size!==r.results.length||r.results.some(x=>!r.sampleIds.includes(x.recordId)||!['pass','fail'].includes(x.verdict)||!x.note?.trim()||x.actorId!==t.reviewerId||!Number.isFinite(Date.parse(x.at))))bad();
  if(['passed','failed'].includes(r.status)){const rate=r.results.filter(x=>x.verdict==='pass').length/count*100;if(r.results.length!==count||r.passRate!==rate||(r.status==='passed')!==(r.results.filter(x=>x.verdict==='pass').length*100>=count*r.policy.threshold)||!Number.isFinite(Date.parse(r.finishedAt)))bad();}
  if(r.returnedAt&&(!Number.isFinite(Date.parse(r.returnedAt))||!r.returnReason?.trim()))bad();
 }
 if(t.status==='accepted'&&!samplingPassed(t,b))bad();
}
