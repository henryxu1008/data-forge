import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import assert from 'node:assert/strict';
import {applyAIAnnotationAction} from '../src/ai-annotation-state.js';
import {applyTextBatchAction} from '../src/text-production-state.js';
import {applyImageBatchAction} from '../src/image-production-state.js';
const output=path.resolve('tmp/ai-static');await fs.mkdir(output,{recursive:true});
await build({entryPoints:['src/AIAnnotationView.jsx','src/AIAnnotationProvenance.jsx','src/DataViews.jsx','src/ImageWorkspaceView.jsx'],bundle:true,platform:'node',format:'cjs',external:['react','react-dom/server'],loader:{'.css':'empty'},outdir:output,outExtension:{'.js':'.cjs'}});
const load=async name=>{const m=await import(pathToFileURL(path.join(output,name+'.cjs')).href);return m.default.default||m.default;};
const View=await load('AIAnnotationView'),Provenance=await load('AIAnnotationProvenance'),DataViews=await load('DataViews'),ImageView=await load('ImageWorkspaceView');
const original=JSON.parse(await fs.readFile('examples/p1-completed-session.json','utf8')).payload.workspaces.demo;
let w=structuredClone(original);const at='2026-10-27T08:50:00Z';const action=(type,rest={})=>{const r=applyAIAnnotationAction(w,{type,...rest,at},{actorId:'henry',actorName:'演示管理员'});assert.equal(r.ok,true,r.error);w=r.workspace;return r.entity;};
const t=action('createAnnotationBatch',{versionId:'customer:v0.2',name:'文本预标注静态样例'});w.textBatches[t.datasetId]=applyTextBatchAction(t,{type:'clean',at}).batch;
function predict(id,model){action('bindModel',{datasetId:id,modelVersionId:model});const j=action('createPredictionJob',{datasetId:id,name:'批量预标注静态样例'});action('startPredictionJob',{jobId:j.id});for(let i=0;i<4;i++)action('advancePredictionJobs');return j.id;}
const textJob=predict(t.datasetId,'SIM-TEXT-1');w.textBatches[t.datasetId]=applyTextBatchAction(w.textBatches[t.datasetId],{type:'assign',assignee:'演示管理员',at}).batch;
action('acceptPredictions',{predictionIds:w.aiAnnotation.jobs.find(j=>j.id===textJob).predictionIds.slice(0,1)});
const imageJob=predict('defects','SIM-VISION-1');w.imageBatches.defects=applyImageBatchAction(w.imageBatches.defects,{type:'assign',assignee:'演示管理员',at}).batch;
action('acceptPredictions',{predictionIds:w.aiAnnotation.jobs.find(j=>j.id===imageJob).predictionIds.slice(0,1)});
const record=w.textBatches[t.datasetId].records.find(r=>r.aiAnnotation),image=w.imageBatches.defects.records.find(r=>r.aiAnnotation);
const noop=()=>{};const props={w,onAIAction:()=>({ok:false,error:'static only'}),onNavigate:noop};
const cases=[
 ['text-suggestions',View,{...props,request:{datasetId:t.datasetId,jobId:textJob}},['文本预标注静态样例','模型版本绑定','模拟置信度','已接受','人工校正与审核','SIM-TEXT-1']],
 ['image-suggestions',View,{...props,request:{datasetId:'defects',jobId:imageJob}},['图片几何模拟基线','原图','预测记录','SIM-VISION-1','不识别图像']],
 ['legacy-bridge',View,{...props,request:{datasetId:'customer'}},['还没有可预标注的批次','从发布版本建立批次']],
 ['text-draft-provenance',Provenance,{record,datasetId:t.datasetId,onNavigate:noop},['AI 模拟建议来源',record.aiAnnotation.predictionId,'查看预标注来源']],
 ['text-review',DataViews,{view:'review',selectedId:t.datasetId,textBatches:w.textBatches,imageBatches:w.imageBatches,onNavigate:noop,onTextAction:noop},['AI 模拟建议来源','保存草稿','提交审核','查看预标注来源']],
 ['image-review',ImageView,{batch:w.imageBatches.defects,onNavigate:noop,onImageAction:noop},['AI 模拟建议来源','画框','提交审核',image.aiAnnotation.predictionId]],
];
const results=[];for(const [name,Component,props,texts]of cases){const html=renderToStaticMarkup(React.createElement(Component,props));for(const text of texts)assert.ok(html.includes(text),name+' missing '+text);await fs.writeFile(path.join(output,name+'.html'),html);results.push({name,assertions:texts.length,bytes:Buffer.byteLength(html),passed:true});}
for(const p of ['src/ai-annotation-state.js','src/AIAnnotationView.jsx','src/AIAnnotationProvenance.jsx'])assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(await fs.readFile(p,'utf8')),'unexpected network call');
const app=await fs.readFile('src/App.jsx','utf8');assert.ok(app.includes("['ai-annotation','AI 标注']")&&app.includes("id==='ai-annotation'?<AIAnnotationView"));assert.ok((await fs.readFile('src/ModelServiceViews.jsx','utf8')).includes('返回 AI 标注使用此模型'));
const result={kind:'React static rendering and source contract checks; not interactive browser validation',passed:results.length,screens:results,noNewNetworkCalls:true,brand:'创平数智工场'};await fs.writeFile('ai-static-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
