import test from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkspaceDelivery,deliveryAccess} from '../src/delivery-platform.js';
import {visibleWorkspace,unifiedTodos} from '../src/platform-policy.js';
import {encodeSnapshot,decodeSnapshot} from '../src/persistence.js';
import {createCompletionState} from '../src/completion-state.js';
import {createModelLifecycleState} from '../src/model-lifecycle-state.js';
const at='2026-10-29T09:00:00Z';
export function fixture(){
 const settings={spaces:[{id:'demo',status:'active'}],users:['producer','customer','outsider'].map(id=>({id,name:id,status:'active'})),members:['producer','customer','outsider'].map(id=>({id,userId:id,spaceId:'demo',roleId:'worker',projectIds:id==='outsider'?['P2']:['P1'],status:'active'})),roles:[{id:'worker',permissions:['view','edit','publish','export','approve']}],projects:[{id:'P1',spaceId:'demo'},{id:'P2',spaceId:'demo'}],apiApps:[]};
 const versions=['v1','v2'].map(id=>({id,datasetId:'D',batchId:'B',projectId:'P1',datasetName:'测试集',version:id,specSnapshot:{versionId:'spec'},qualitySnapshot:{status:'passed'},records:[{id:'r',text:id,label:'标签',status:'approved'}]}));
 const w={datasets:[{id:'D',name:'测试集'}],versions:[],textBatches:{D:{datasetId:'D',batchId:'B',projectId:'P1',specSnapshot:{versionId:'spec'},records:[],versions}},imageBatches:{},reviewState:{tasks:[]},completion:createCompletionState(),modelState:createModelLifecycleState(),production:{projects:[{id:'P1'}],templates:[],taxonomies:[]},events:[]};
 return {schemaVersion:2,activeSpaceId:'demo',actorId:'producer',settings,workspaces:{demo:w}};
}
function act(p,type,extra={},actor='producer'){const r=applyWorkspaceDelivery(p.workspaces.demo,p.settings,actor,'demo',{type,...extra},at);assert.equal(r.ok,true,r.error);p.workspaces.demo=r.workspace;return r;}
function create(p){act(p,'create',{projectId:'P1',customerId:'customer',versionId:'v1'});}
function submit(p,id='DLV-1'){act(p,'package',{orderId:id,checksum:'sha256:test',qualityReportId:'q',licenseRef:'l',manifest:['data.json']});act(p,'submit',{orderId:id});}
test('workspace delivery rejection, revised version, acceptance and snapshot restore',()=>{
 const p=fixture();create(p);submit(p);
 act(p,'reject',{orderId:'DLV-1',note:'标签错误'},'customer');
 act(p,'requestRevision',{orderId:'DLV-1',newVersionId:'v2',note:'已修订标签'});submit(p,'DLV-2');
 act(p,'accept',{orderId:'DLV-2',note:'通过'},'customer');
 assert.equal(unifiedTodos(p.workspaces.demo).filter(t=>t.target==='deliveries').length,0);
 assert.deepEqual(decodeSnapshot(encodeSnapshot(p)).platform,p);
 assert.equal(p.workspaces.demo.delivery.orders.find(o=>o.id==='DLV-1').versionSnapshot.id,'v1');
});
test('assigned customer only, author separation, project visibility and disabled memberships',()=>{
 const p=fixture();create(p);submit(p);const w=p.workspaces.demo;
 for(const actor of ['producer','outsider'])assert.equal(applyWorkspaceDelivery(w,p.settings,actor,'demo',{type:'accept',orderId:'DLV-1',note:'pass'},at).ok,false);
 assert.equal(visibleWorkspace(w,p.settings,'outsider','demo').delivery.orders.length,0);
 assert.equal(visibleWorkspace(w,p.settings,'outsider','demo').delivery.events.length,0);
 p.settings.members[1].status='disabled';assert.equal(deliveryAccess(w,p.settings,'customer','demo',{type:'accept',orderId:'DLV-1'}).ok,false);
});
test('frozen content, governance withdrawal and missing quality block progress',()=>{
 for(const mode of ['mutate','governance','quality']){const p=fixture();create(p);submit(p);const w=p.workspaces.demo;
 if(mode==='mutate')w.textBatches.D.versions[0].records[0].text='changed';
 if(mode==='quality')w.textBatches.D.versions[0].qualitySnapshot.status='failed';
 if(mode==='governance')w.governance={enabled:true,charters:[],admissions:[]};
 const before=structuredClone(w);assert.equal(applyWorkspaceDelivery(w,p.settings,'customer','demo',{type:'accept',orderId:'DLV-1',note:'pass'},at).ok,false);assert.deepEqual(w,before);}
});
test('legacy snapshots load, broken delivery references and sequence reject restore',()=>{
 const p=fixture();assert.deepEqual(decodeSnapshot(encodeSnapshot(p)).platform,p);create(p);
 for(const corrupt of [p=>p.workspaces.demo.delivery.sequence=0,p=>p.workspaces.demo.delivery.orders[0].versionId='missing',p=>p.workspaces.demo.delivery.orders[0].revisions=['missing']]){const bad=structuredClone(p);corrupt(bad);assert.throws(()=>decodeSnapshot(encodeSnapshot(bad)),/交付/);}
});
test('cross-project source cannot be delivered or exposed',()=>{const p=fixture();create(p);p.workspaces.demo.textBatches.D.versions[0].sourceProjects=['P2'];p.workspaces.demo.delivery.orders[0].versionSnapshot.sourceProjects=['P2'];assert.equal(deliveryAccess(p.workspaces.demo,p.settings,'producer','demo',{type:'submit',orderId:'DLV-1'}).ok,false);assert.equal(visibleWorkspace(p.workspaces.demo,p.settings,'producer','demo').delivery.orders.length,0);});
test('sharing licence revocation blocks acceptance and includes deliveries in impact analysis',async()=>{
 const {sourceCatalog,affectedAssets}=await import('../src/governance-sources.js');
 const p=fixture();const w=p.workspaces.demo;
 w.governance={enabled:true,charters:[{id:'c',projectId:'P1',status:'approved'}],admissions:[{id:'a',sourceId:'data:D',status:'approved',validUntil:'2099-01-01T00:00:00Z',purposes:['sharing'],sourceSnapshot:sourceCatalog(w)[0]}]};
 create(p);submit(p);
 const current=p.workspaces.demo;current.governance.admissions[0].status='revoked';
 assert.equal(applyWorkspaceDelivery(current,p.settings,'customer','demo',{type:'accept',orderId:'DLV-1',note:'pass'},at).ok,false);
 assert.ok(affectedAssets(current,'data:D').some(a=>a.type==='delivery'&&a.orderId==='DLV-1'));
});
