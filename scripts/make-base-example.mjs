// Synthetic, reproducible legacy-schema fixture; not a recovered user session.
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import {encodeSnapshot,decodeSnapshot} from '../src/persistence.js';
import {applyModelLifecycleAction} from '../src/model-lifecycle-state.js';
import {applyCompletionAction} from '../src/completion-state.js';
import {workspaceVersions} from '../src/platform-policy.js';
const at='2026-10-27T07:00:00.000Z';
const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'});
try {
 const {makePlatform}=await server.ssrLoadModule('/src/App.jsx');const platform=makePlatform(at);
 for(const w of Object.values(platform.workspaces))delete w.governance;
 const w=platform.workspaces.demo,project=w.production.projects.find(p=>p.id==='PRJ-001');
 w.versions[0].specSnapshot=structuredClone(project.specSnapshot);
 w.versions.push({...structuredClone(w.versions[0]),version:'v0.1'});
 const model=(type,rest={})=>{const r=applyModelLifecycleAction(w.modelState,{type,...rest,at},{versions:workspaceVersions(w),concurrency:2,gpu:1});if(!r.ok)throw Error(r.error);w.modelState=r.state;return r.entity;};
 model('startTraining',{name:'合成基线模型',base:'Qwen',dataVersionId:'customer:v0.2',params:{rank:16,epochs:3,rate:.0002,batch:4}});for(let i=0;i<4;i++)model('tick');
 const m=w.modelState.models[0];const e=model('startEvaluation',{modelVersionId:m.id,dataVersionId:'customer:v0.2',scenario:'pass'});for(let i=0;i<4;i++)model('tick');
 model('publishService',{modelVersionId:m.id,evaluationId:e.id,name:'合成基线服务',note:'流程测试'});for(let i=0;i<4;i++)model('tick');
 const c=(type,rest={})=>{const r=applyCompletionAction(w.completion,{type,...rest,at},{modelState:w.modelState,versions:workspaceVersions(w),concurrency:2});if(!r.ok)throw Error(r.error);w.completion=r.state;return r.entity;};
 c('ingestDocument',{projectId:'PRJ-002',name:'合成售后规范',content:'七日内可以申请退货。'});const d=w.completion.documents[0];
 c('saveQA',{documentId:d.id,blockId:d.blocks[0].id,quote:d.blocks[0].text,question:'如何退货？',answer:'七日内申请。'});const q=w.completion.qas[0];c('submitQA',{qaId:q.id});c('approveQA',{qaId:q.id});c('publishKnowledge',{projectId:'PRJ-002',note:'合成规范'});
 c('createLibrary',{projectId:'PRJ-002',name:'合成知识库'});const lib=w.completion.libraries[0];c('configureLibrary',{libraryId:lib.id,sourceVersionId:w.completion.sourceVersions[0].id,config:{chunk:100,overlap:10,topk:3}});c('startIndex',{libraryId:lib.id});for(let i=0;i<4;i++)c('tick');
 c('createAgent',{projectId:'PRJ-002',name:'合成客服'});const agent=w.completion.agents[0],nodes=structuredClone(agent.nodes);nodes[1].config={libraryId:lib.id,indexId:w.completion.indexes[0].id};nodes[2].config={serviceId:w.modelState.services[0].id,prompt:'仅按引用作答'};c('saveAgent',{agentId:agent.id,name:agent.name,nodes});
 const snapshot=encodeSnapshot(platform,at);decodeSnapshot(snapshot);await fs.mkdir('examples',{recursive:true});await fs.writeFile('examples/completed-session.json',snapshot);console.log('Generated synthetic legacy-schema baseline from app seeds');
} finally {await server.close();}
