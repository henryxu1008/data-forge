import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import assert from 'node:assert/strict';
import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import {enableGovernance,checkSampleOverlap} from '../src/governance-state.js';
const folder=path.resolve('tmp/governance-static');await fs.mkdir(folder,{recursive:true});
await build({entryPoints:['src/GovernanceViews.jsx'],bundle:true,platform:'node',format:'cjs',external:['react','react-dom/server'],loader:{'.css':'empty'},outfile:path.join(folder,'views.cjs')});
const imported=await import(pathToFileURL(path.join(folder,'views.cjs')).href),views=imported.default||imported,{default:GovernanceView,GovernanceEntry,EvaluationIntegrityPanel,AcceptanceSnapshot}=views;
const p=JSON.parse(await fs.readFile('examples/governance-completed-session.json','utf8')).payload,w=p.workspaces.demo,noop=()=>{};
const props={w,platform:p,onGovernanceAction:()=>({ok:false,error:'static only'}),onNavigate:noop};
const model=w.modelState.models.find(m=>m.type!=='image'&&m.dataVersionId!=='customer:v0.2'),version=w.textBatches['gov-heldout-example'].versions[0],report=w.modelState.evaluations.find(e=>e.dataVersionId===version.id&&e.acceptanceSnapshot),copied={...structuredClone(version),id:'copy-static',records:model.dataVersion.records.map((r,i)=>({...r,id:'copy-'+i}))};
assert.equal(checkSampleOverlap(model.dataVersion,copied).overlapCount,model.dataVersion.records.length);
const pending=enableGovernance(JSON.parse(await fs.readFile('examples/ai-completed-session.json','utf8')).payload).workspaces.demo;
const cases=[
 ['charter-and-swimlane',GovernanceView,{...props,request:{target:'governance',projectId:'PRJ-001',tab:'charter'}},['角色责任泳道','负责人','批准人','质量负责人','退出条件','PLAN-1']],
 ['admission-revocation-impact',GovernanceView,{...props,request:{target:'governance',projectId:'PRJ-001',tab:'admission',sourceId:'data:customer'}},['已撤回','撤回当时的冻结影响清单','既有下游影响','来源方','模型','服务']],
 ['evidence-cost-acceptance',GovernanceView,{...props,request:{target:'governance',projectId:'PRJ-001',tab:'evidence',versionId:version.id}},['同一质量口径的人工流程假设','20.00','10.00','不是实际账单','模拟流程验收通过','复核用时（假设）']],
 ['independent-evaluation',EvaluationIntegrityPanel,{w,model,version,mode:'independent',onModeChange:noop,onNavigate:noop},['可信验收与防污染','实际重叠 0','评测','所有预测与指标仍是本地模拟']],
 ['different-version-overlap',EvaluationIntegrityPanel,{w,model,version:copied,mode:'independent',onModeChange:noop,onNavigate:noop},['实际重叠 3','独立验收','父来源']],
 ['frozen-acceptance',AcceptanceSnapshot,{report},['独立数据检查通过','模拟结果','训练','冻结立项、许可和基线依据','local-simulation']],
 ['legacy-pending-entry',GovernanceEntry,{w:pending,datasetId:'customer',onNavigate:noop},['尚未批准立项','旧记录保留','查看治理与影响']],
 ['approved-project-entry',GovernanceEntry,{w,datasetId:'defects',onNavigate:noop},['已批准立项','每次新增使用仍检查来源用途与期限']],
];
const results=[];for(const [name,View,props,texts]of cases){const html=renderToStaticMarkup(React.createElement(View,props));for(const text of texts)assert.ok(html.includes(text),name+' missing '+text);await fs.writeFile(path.join(folder,name+'.html'),html);results.push({name,assertions:texts.length,bytes:Buffer.byteLength(html),passed:true});}
for(const filename of ['src/governance-state.js','src/governance-sources.js','src/evaluation-integrity.js','src/GovernanceViews.jsx'])assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(await fs.readFile(filename,'utf8')),'network call');
const app=await fs.readFile('src/App.jsx','utf8');assert.ok(app.includes("['governance','立项与验收治理']")&&app.includes("id==='governance'?<GovernanceView"));assert.ok(app.includes('enableGovernance({...saved')&&app.includes("old,'data',{...action,datasetId}"));assert.ok(app.includes('acceptanceFactory:')&&app.includes('haltGovernedWork(old,'));assert.ok((await fs.readFile('src/DataViews.jsx','utf8')).includes('if(accepted===false)return;setReceipt(record)'));
const allowedGlobals=new Set('Array Boolean Date Error Infinity JSON Map Math NaN Number Object Promise RegExp Set String Symbol Uint8Array WeakMap WeakSet parseInt parseFloat isFinite undefined window document navigator location history globalThis URL URLSearchParams Blob File FileReader Image indexedDB setTimeout clearTimeout setInterval clearInterval console TextEncoder TextDecoder atob btoa crypto performance requestAnimationFrame cancelAnimationFrame'.split(' '));
const checkedSources=['src/App.jsx','src/GovernanceViews.jsx','src/governance-state.js','src/governance-sources.js','src/evaluation-integrity.js','src/ModelViews.jsx','src/ModelLifecycleViews.jsx','src/ModelServiceViews.jsx','src/DataViews.jsx','src/model-lifecycle-state.js','src/ai-annotation-state.js','src/platform-policy.js','src/persistence.js'];
const traverse=traverseModule.default||traverseModule,unbound=[];
for(const file of checkedSources){const ast=parse(await fs.readFile(file,'utf8'),{sourceType:'module',plugins:['jsx']});traverse(ast,{ReferencedIdentifier(p){const name=p.node.name;if(!allowedGlobals.has(name)&&!p.scope.hasBinding(name))unbound.push(file+':'+p.node.loc.start.line+' '+name);}});}
assert.deepEqual(unbound,[],'unbound identifiers in changed application branches');
const result={kind:'React static render, routing and Babel scope checks; no interactive UI validation',passed:results.length,screens:results,babelScopeSources:checkedSources.length,unboundIdentifiers:unbound,networkCalls:false,brand:'创平数智工场'};await fs.writeFile('governance-static-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
