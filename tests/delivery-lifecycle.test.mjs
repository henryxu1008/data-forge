import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryState,applyDeliveryAction,deliveryTodos} from '../src/delivery-lifecycle-state.js';
const context={actorId:'manager',at:'2026-10-29T00:00:00.000Z',canAccess:(actor,project,permission)=>actor==='manager'&&permission!=='accept'||actor==='customer'&&permission==='accept',versionEligible:(v,p)=>p==='p1'&&['v1','v2'].includes(v)};
const run=(s,a,ctx=context)=>applyDeliveryAction(s,a,ctx);
test('delivery: submit, accept, feedback, revise and immutable version snapshot',()=>{
 let s=createDeliveryState();
 let r=run(s,{type:'create',projectId:'p1',customerId:'c1',versionId:'v1'});assert.equal(r.ok,true);s=r.state;
 assert.equal(s.orders[0].status,'draft');
 assert.equal(run(s,{type:'submit',orderId:'DLV-1'}).ok,false);
 r=run(s,{type:'package',orderId:'DLV-1',checksum:'sha256:abc',qualityReportId:'q1',licenseRef:'lic1',manifest:['a','a']});assert.equal(r.ok,true);s=r.state;
 assert.deepEqual(s.orders[0].package.manifest,['a']);
 r=run(s,{type:'submit',orderId:'DLV-1'});assert.equal(r.ok,true);s=r.state;
 assert.equal(run(s,{type:'accept',orderId:'DLV-1',note:'pass'}).ok,false);
 r=run(s,{type:'accept',orderId:'DLV-1',note:'pass'},{...context,actorId:'customer'});assert.equal(r.ok,true);s=r.state;
 assert.equal(run(s,{type:'accept',orderId:'DLV-1',note:'repeat'},{...context,actorId:'customer'}).ok,false);
 r=run(s,{type:'openFeedback',orderId:'DLV-1',note:'incorrect row'});assert.equal(r.ok,true);s=r.state;
 assert.equal(deliveryTodos(s)[0].feedbackOpen,1);
 r=run(s,{type:'requestRevision',orderId:'DLV-1',newVersionId:'v2',note:'correct row',feedbackId:'DLV-1-FB-1'});assert.equal(r.ok,true);s=r.state;
 assert.equal(s.orders.find(o=>o.id==='DLV-1').versionId,'v1');
 assert.equal(s.orders.find(o=>o.id==='DLV-2').revisionOf,'DLV-1');
 assert.equal(run(s,{type:'requestRevision',orderId:'DLV-1',newVersionId:'v1'}).ok,false);
});
test('delivery: reject and cancel, unauthorized mutation remains unchanged',()=>{
 let r=run(createDeliveryState(),{type:'create',projectId:'p1',customerId:'c1',versionId:'v1'});let s=r.state;
 const before=JSON.stringify(s);
 assert.equal(run(s,{type:'package',orderId:'DLV-1',checksum:'x',qualityReportId:'q',licenseRef:'l',manifest:['data.json']},{...context,actorId:'intruder'}).ok,false);
 assert.equal(JSON.stringify(s),before);
 r=run(s,{type:'package',orderId:'DLV-1',checksum:'x',qualityReportId:'q',licenseRef:'l',manifest:['data.json']});s=r.state;
 r=run(s,{type:'submit',orderId:'DLV-1'});s=r.state;
 r=run(s,{type:'reject',orderId:'DLV-1',note:'fails quality'},{...context,actorId:'customer'});assert.equal(r.ok,true);s=r.state;
 r=run(s,{type:'cancel',orderId:'DLV-1',note:'abandon'});assert.equal(r.ok,true);assert.equal(r.order.status,'cancelled');
});

function submitted(){
 let s=run(createDeliveryState(),{type:'create',projectId:'p1',customerId:'c1',versionId:'v1'}).state;
 s=run(s,{type:'package',orderId:'DLV-1',checksum:'checksum',qualityReportId:'q1',licenseRef:'l1',manifest:['data.json']}).state;
 return run(s,{type:'submit',orderId:'DLV-1'}).state;
}
test('revocation after submission blocks acceptance without changing the original',()=>{
 const s=submitted(), before=structuredClone(s);
 const r=run(s,{type:'accept',orderId:'DLV-1',note:'pass'},{...context,actorId:'customer',versionEligible:()=>false});
 assert.equal(r.ok,false);assert.deepEqual(s,before);
 assert.equal(run(s,{type:'reject',orderId:'DLV-1',note:'revoked'},{...context,actorId:'customer',versionEligible:()=>false}).ok,true);
});
test('package rejects missing, empty and malformed manifests',()=>{
 const s=run(createDeliveryState(),{type:'create',projectId:'p1',customerId:'c1',versionId:'v1'}).state;
 for(const manifest of [undefined,[],42,'data.json',[null],[' ']])assert.equal(run(s,{type:'package',orderId:'DLV-1',checksum:'x',qualityReportId:'q',licenseRef:'l',manifest}).ok,false);
});
test('feedback revision remains open until replacement accepted; original history survives',()=>{
 let s=run(submitted(),{type:'accept',orderId:'DLV-1',note:'pass'},{...context,actorId:'customer'}).state;
 s=run(s,{type:'openFeedback',orderId:'DLV-1',note:'wrong label'}).state;
 const revision={type:'requestRevision',orderId:'DLV-1',newVersionId:'v2',note:'fix label',feedbackId:'DLV-1-FB-1'};
 assert.equal(run(s,{...revision,feedbackId:undefined}).ok,false);
 assert.equal(run(s,{...revision,note:''}).ok,false);
 s=run(s,revision).state;
 assert.equal(run(s,revision).ok,false);
 assert.equal(s.orders.find(o=>o.id==='DLV-1').history.at(-1).action,'requestRevision');
 const close={type:'closeFeedback',orderId:'DLV-1',feedbackId:'DLV-1-FB-1',note:'replacement accepted'};
 assert.equal(run(s,close).ok,false);
 s=run(s,{type:'package',orderId:'DLV-2',checksum:'new',qualityReportId:'q2',licenseRef:'l1',manifest:['corrected.json']}).state;
 s=run(s,{type:'submit',orderId:'DLV-2'}).state;
 s=run(s,{type:'accept',orderId:'DLV-2',note:'fixed'},{...context,actorId:'customer'}).state;
 s=run(s,close).state;
 assert.equal(s.orders.find(o=>o.id==='DLV-1').feedback[0].status,'closed');
 assert.equal(s.orders.find(o=>o.id==='DLV-1').package.checksum,'checksum');
 assert.equal(deliveryTodos(s).length,0);
});
