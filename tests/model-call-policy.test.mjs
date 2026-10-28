import test from 'node:test';
import assert from 'node:assert/strict';
import {checkModelCall,hasUnsavedModelConfig,modelCallRecord} from '../src/settings/model-call-policy.js';

const spaces=[{id:'demo',name:'演示空间',status:'active'},{id:'quality',name:'质量审核空间',status:'active'}];
const service={id:'vision',name:'图片预标注服务',modelId:'surface-detect',status:'passed',spaces:['quality']};

test('only the saved authorized space can make a successful simulated call',()=>{
  const allowed=checkModelCall({service,spaceId:'quality',spaces});
  const denied=checkModelCall({service,spaceId:'demo',spaces});
  assert.equal(allowed.allowed,true);
  assert.equal(allowed.space,'质量审核空间');
  assert.equal(denied.allowed,false);
  assert.equal(denied.code,'unauthorized');
  const record=modelCallRecord({id:'attempt-1',at:'now',service,access:denied});
  assert.equal(record.result,'模拟拒绝');
  assert.equal(record.spaceId,'demo');
  assert.equal(record.space,'演示空间');
});

test('authorized spaces still cannot call an unverified or failed saved service',()=>{
  for(const status of ['untested','failed']){
    const access=checkModelCall({service:{...service,status},spaceId:'quality',spaces});
    assert.equal(access.allowed,false);
    assert.equal(access.code,'unverified');
  }
});

test('unsaved authorization, credentials, or test results block calling a previously valid service',()=>{
  const changed={...service,spaces:['demo','quality']};
  assert.equal(hasUnsavedModelConfig(changed,service),true);
  assert.equal(hasUnsavedModelConfig(service,service,{credentialPending:true}),true);
  assert.equal(hasUnsavedModelConfig(service,service,{testPending:true}),true);
  assert.equal(hasUnsavedModelConfig({...service,calls:[{id:'historic'}]},service),false);
  const access=checkModelCall({service,spaceId:'quality',spaces,hasUnsavedChanges:true});
  assert.equal(access.allowed,false);
  assert.equal(access.code,'unsaved');
  assert.equal(checkModelCall({service,spaceId:'quality',spaces,testing:true}).code,'testing');
});

test('revoking space access changes the next result and preserves past call snapshots',()=>{
  const access=checkModelCall({service,spaceId:'quality',spaces});
  const historic=modelCallRecord({id:'attempt-1',at:'before',service,access});
  const renamed=spaces.map(space=>space.id==='quality'?{...space,name:'新质检空间'}:space);
  const next=checkModelCall({service:{...service,spaces:['demo']},spaceId:'quality',spaces:renamed});
  assert.equal(next.allowed,false);
  assert.equal(next.space,'新质检空间');
  assert.equal(historic.result,'模拟成功');
  assert.equal(historic.spaceId,'quality');
  assert.equal(historic.space,'质量审核空间');
});

test('missing and archived spaces cannot pass the authorization check',()=>{
  assert.equal(checkModelCall({service,spaceId:'missing',spaces}).code,'space-unavailable');
  const archived=spaces.map(space=>({...space,status:'archived'}));
  assert.equal(checkModelCall({service,spaceId:'quality',spaces:archived}).code,'space-unavailable');
});
