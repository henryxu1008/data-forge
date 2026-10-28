import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import assert from 'node:assert/strict';
import {createProductionFlowState,applyProductionFlowAction} from '../src/p1-production-flow.js';
import {createModelLifecycleState} from '../src/model-lifecycle-state.js';
const output=path.resolve('tmp/p1-static');await fs.mkdir(output,{recursive:true});
await build({entryPoints:['src/P1FlowViews.jsx'],bundle:true,platform:'node',format:'cjs',external:['react','react-dom/server'],loader:{'.css':'empty'},outfile:path.join(output,'views.cjs')});
const loadedViews=await import(pathToFileURL(path.join(output,'views.cjs')).href);const {TaskPlanningView,ProductionFlowView,BatchRulePanel}=loadedViews.default||loadedViews;
const spec={versionId:'s1',name:'文本意图分类',labels:[{name:'甲'}]};
let w={datasets:[],textBatches:{},imageBatches:{},versions:[],flow:createProductionFlowState(),modelState:createModelLifecycleState(),production:{projects:[{id:'P1',name:'静态检查项目',type:'text',specSnapshot:spec}],templates:[{id:'t1',name:'文本意图分类',type:'text',labels:'标签'}],taxonomies:[{id:'x',name:'标签',tags:spec.labels}]}};
const action=(type,rest)=>{const r=applyProductionFlowAction(w,{type,...rest,at:'2026-10-27T07:30:00Z'},{spaceId:'demo',actorId:'u'});assert.equal(r.ok,true,r.error);w=r.workspace;return r.entity;};
const plan=action('saveTaskPlan',{projectId:'P1',requirements:{type:'text',minimumRecords:1,sources:['published','aggregation','enhancement']},metrics:{accuracy:90,macroF1:80,minTextLength:1}});
w.flow.versions=[{id:'a',datasetId:'a',batchId:'a',projectId:'P1',type:'text',datasetName:'输入A',specSnapshot:spec,records:[{id:'a1',text:'原文A',label:'甲'}]},{id:'b',datasetId:'b',batchId:'b',projectId:'P1',type:'text',datasetName:'输入B',specSnapshot:spec,records:[{id:'b1',text:'原文B',label:'甲'}]}];
const rules=action('saveRuleModule',{projectId:'P1',name:'静态质量规则',rules:[{id:'text',type:'requiredText',enabled:true}]});
const job=action('createJob',{kind:'aggregation',name:'静态汇聚',projectId:'P1',inputVersionIds:['a','b'],config:{conflict:'namespace'}});action('runJob',{jobId:job.id});action('reviewJob',{jobId:job.id,decision:'approve',note:'静态测试审核'});action('assessJob',{jobId:job.id,ruleVersionId:rules.id});
const enhanced=action('createJob',{kind:'enhancement',name:'静态增强',projectId:'P1',inputVersionIds:['a'],config:{prefix:'增强前缀：',suffix:''}});action('runJob',{jobId:enhanced.id});
const props={w,onFlowAction:()=>({ok:false,error:'static only'}),onNavigate:()=>{}};
const cases=[['task-plan',TaskPlanningView,{...props,request:{target:'task-plan',projectId:'P1'}},['基本信息','数据需求','质量与评测指标','确认创建']],['aggregation',ProductionFlowView,{...props,request:{target:'pipeline',mode:'aggregation',jobId:job.id}},['静态汇聚','父来源','执行当前规则质评','发布准备数据版本','原文A']],['enhancement',ProductionFlowView,{...props,request:{target:'pipeline',mode:'enhancement',jobId:enhanced.id}},['静态增强','增强前缀：原文A','人工审核通过','父来源']],['rules',ProductionFlowView,{...props,request:{target:'pipeline',mode:'rules'}},['静态质量规则','修订为新版','查看版本历史']],['reports',ProductionFlowView,{...props,request:{target:'pipeline',mode:'reports'}},['发起质评并保留报告','全部质评历史']],['batch-rules',BatchRulePanel,{batch:{id:'B',projectId:'P1',taskPlan:plan},flow:w.flow,onSelect:()=>{}},[plan.id,'本批次固定规则版本']]];
const results=[];
for(const [name,Component,props,texts]of cases){const html=renderToStaticMarkup(React.createElement(Component,props));for(const text of texts)assert.ok(html.includes(text),name+' missing '+text);assert.ok(!html.includes('undefined'));await fs.writeFile(path.join(output,name+'.html'),html);results.push({name,rendered:true,assertions:texts.length,bytes:Buffer.byteLength(html)});}
// Inspect all local app sources, not historical reports, whitepaper citations or stored samples.
const appSources=[];async function visit(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await visit(p);else if(/\.(js|jsx)$/.test(e.name))appSources.push(p);}}await visit('src');
for(const p of appSources){const text=await fs.readFile(p,'utf8');assert.ok(!/(?<!创平)数智工场|创平数智工厂|(?<!创平)数智工厂/.test(text),'old visible brand in '+p);}
const result={kind:'React static rendering and source checks; not a browser/UI test',screens:results,sourceFiles:appSources.length,brand:'创平数智工场',noNewNetworkCalls:true};
for(const p of ['src/p1-production-flow.js','src/p1-quality.js','src/P1FlowViews.jsx'])assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(await fs.readFile(p,'utf8')),'network call in '+p);
await fs.writeFile('p1-static-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
