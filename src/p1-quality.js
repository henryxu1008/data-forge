// Shared local contracts. No model calls, external IO or executable user rules.
export const clone=value=>JSON.parse(JSON.stringify(value));
export const sourceKinds=['local','demo','published','aggregation','enhancement'];
export const ruleTypes={requiredText:'文本非空',minLength:'最短文本长度',maxLength:'最长文本长度',uniqueText:'文本不重复',allowedLabels:'允许标签',forbiddenText:'禁止词',requiredField:'必填字段'};
const fields=['id','text','label','channel','question','answer'];
const integer=(x,min,max)=>Number.isInteger(x)&&x>=min&&x<=max;
export function validatePlan(requirements,metrics){
 if(!requirements||!['text','image'].includes(requirements.type)||!integer(requirements.minimumRecords,1,1000000)||!Array.isArray(requirements.sources)||!requirements.sources.length||new Set(requirements.sources).size!==requirements.sources.length||requirements.sources.some(x=>!sourceKinds.includes(x)))throw Error('请填写有效的数据类型、1–1000000 条规模和允许来源。');
 if(!metrics||!Number.isFinite(metrics.accuracy)||metrics.accuracy<1||metrics.accuracy>100||!Number.isFinite(metrics.macroF1)||metrics.macroF1<1||metrics.macroF1>100||!integer(metrics.minTextLength??0,0,100000))throw Error('准确率/F1 须为 1–100，最短文本长度须为 0–100000。');
 return {requirements:clone(requirements),metrics:{accuracy:metrics.accuracy,macroF1:metrics.macroF1,minTextLength:metrics.minTextLength??0}};
}
export function validateRules(rules){
 if(!Array.isArray(rules)||!rules.length||rules.length>30||new Set(rules.map(r=>r.id)).size!==rules.length)throw Error('规则模块须含 1–30 个唯一规则。');
 for(const r of rules){
  if(typeof r.id!=='string'||!r.id.trim()||!Object.hasOwn(ruleTypes,r.type)||typeof r.enabled!=='boolean')throw Error('规则编号、类型或启停状态无效。');
  if(['minLength','maxLength'].includes(r.type)&&!integer(r.value,0,100000))throw Error('长度参数须为 0–100000 的整数。');
  if(r.type==='forbiddenText'&&(typeof r.value!=='string'||!r.value.trim()||r.value.length>1000))throw Error('请填写有效禁止词。');
  if(r.type==='allowedLabels'&&(!Array.isArray(r.value)||!r.value.length||r.value.some(x=>typeof x!=='string'||!x.trim())))throw Error('允许标签须为非空文本列表。');
  if(r.type==='requiredField'&&!fields.includes(r.value))throw Error('必填字段只能选 id/text/label/channel/question/answer。');
 }
 return clone(rules);
}
export function evaluateRules(records,module){
 if(!module)return [];
 validateRules(module.rules);const issues=[],seen=new Set();
 for(const row of records){const text=typeof row.text==='string'?row.text:'';
  for(const rule of module.rules.filter(x=>x.enabled)){let reason='';
   if(rule.type==='requiredText'&&!text.trim())reason='文本为空';
   if(rule.type==='minLength'&&text.length<rule.value)reason=`文本长度 ${text.length} 小于 ${rule.value}`;
   if(rule.type==='maxLength'&&text.length>rule.value)reason=`文本长度 ${text.length} 超过 ${rule.value}`;
   if(rule.type==='uniqueText'&&seen.has(text.trim()))reason='文本重复';
   if(rule.type==='allowedLabels'&&!rule.value.includes(row.label))reason='标签不在允许范围';
   if(rule.type==='forbiddenText'&&text.includes(rule.value))reason=`含禁止词：${rule.value}`;
   if(rule.type==='requiredField'&&(row[rule.value]===undefined||row[rule.value]===null||!String(row[rule.value]).trim()))reason=`缺少字段 ${rule.value}`;
   if(reason)issues.push({recordId:row.id,ruleId:rule.id,type:rule.type,field:rule.type==='requiredField'?rule.value:rule.type==='allowedLabels'?'label':'text',reason,parents:clone(row.parents||[])});
  }seen.add(text.trim());
 }return issues;
}
export function taskPlanIssues(records,plan,type='text'){
 if(!plan)return [];validatePlan(plan.requirements,plan.metrics);const issues=[];
 if(plan.requirements.type!==type)issues.push({recordId:'*',ruleId:'task-type',reason:'数据类型不符合冻结任务计划'});
 if(records.length<plan.requirements.minimumRecords)issues.push({recordId:'*',ruleId:'task-size',reason:`任务要求至少 ${plan.requirements.minimumRecords} 条，当前 ${records.length} 条`});
 if(type==='text')for(const r of records)if((r.text||'').length<plan.metrics.minTextLength)issues.push({recordId:r.id,ruleId:'task-length',reason:`短于任务规定的 ${plan.metrics.minTextLength} 字符`});
 return issues;
}
export function planForProject(w,projectId){return w.flow?.planVersions?.find(x=>x.projectId===projectId)||null;}
export function bindTaskPlan(w,data,kind='text',sourceKind='local'){
 const plan=data.taskPlan||planForProject(w,data.projectId);if(!plan)return data;
 validatePlan(plan.requirements,plan.metrics);
 if(plan.projectId!==data.projectId||plan.requirements.type!==kind||!plan.requirements.sources.includes(sourceKind))throw Error('数据类型或来源不符合任务冻结需求。');
 return {...data,taskPlan:clone(plan)};
}
