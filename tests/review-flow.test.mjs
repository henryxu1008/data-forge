import assert from 'node:assert/strict';
import test from 'node:test';
import {createReviewState,transitionReviewState,currentSampleRows,publicationSampleRecords} from '../src/review-state.js';

const seedTasks = [{id:'0148',text:'物流三天没有更新',label:'物流',status:'review',annotator:'李一'}];
const seedCounts = {todo:120,review:60,rework:20,approved:960};
const action = (status, note = '已核对', label = '物流') => ({id:'0148',status,label,note,at:'2026-10-27 12:00:00'});
const total = state => Object.values(state.counts).reduce((sum,n)=>sum+n,0);

test('return, revise, resubmit and approve preserve counts and an immutable operation history', () => {
  const initial = createReviewState(seedTasks,seedCounts);
  const returned = transitionReviewState(initial,action('rework','请补充判定依据'));
  assert.deepEqual(returned.counts,{todo:120,review:59,rework:21,approved:960});
  assert.equal(returned.tasks[0].returnReason,'请补充判定依据');
  assert.equal(initial.tasks[0].status,'review');
  assert.equal(initial.tasks[0].history.length,0);

  const resubmitted = transitionReviewState(returned,action('review','按咨询规范重新标注','咨询'));
  assert.deepEqual(resubmitted.counts,seedCounts);
  assert.equal(resubmitted.tasks[0].resubmissions,1);
  assert.equal(resubmitted.tasks[0].returnReason,'请补充判定依据');
  assert.equal(resubmitted.tasks[0].reworkNote,'按咨询规范重新标注');
  assert.equal(returned.tasks[0].history.length,1);
  assert.equal(returned.tasks[0].label,'物流');

  const returnedAgain = transitionReviewState(resubmitted,action('rework','主要诉求为配送进度','咨询'));
  const corrected = transitionReviewState(returnedAgain,action('review','已依据完整文本修正'));
  const approved = transitionReviewState(corrected,action('approved','修正符合规范'));
  assert.deepEqual(approved.counts,{todo:120,review:59,rework:20,approved:961});
  assert.equal(approved.tasks[0].resubmissions,2);
  assert.deepEqual(approved.tasks[0].history.map(event=>event.to),['rework','review','rework','review','approved']);
  assert.equal(approved.tasks[0].history[0].note,'请补充判定依据');
  assert.equal(approved.tasks[0].history[1].note,'按咨询规范重新标注');
  assert.equal(approved.tasks[0].history[2].note,'主要诉求为配送进度');
  for(const state of [initial,returned,resubmitted,returnedAgain,corrected,approved])assert.equal(total(state),1160);
});

test('duplicate, illegal, incomplete and underflowing transitions leave the same state untouched', () => {
  const initial = createReviewState(seedTasks,seedCounts);
  const invalid = [action('review'),action('todo'),action('rework','   '),action('approved','','未知标签'),{...action('approved'),id:'missing'}];
  for(const payload of invalid)assert.equal(transitionReviewState(initial,payload),initial);
  const returned = transitionReviewState(initial,action('rework'));
  assert.equal(transitionReviewState(returned,action('rework')),returned);
  assert.equal(transitionReviewState(returned,action('approved')),returned);
  assert.equal(transitionReviewState(returned,action('review','')),returned);
  const approved = transitionReviewState(initial,action('approved'));
  for(const status of ['review','approved','rework'])assert.equal(transitionReviewState(approved,action(status)),approved);
  const emptyCount = {...initial,counts:{...initial.counts,review:0}};
  assert.equal(transitionReviewState(emptyCount,action('approved')),emptyCount);
  const corruptCount = {...initial,counts:{...initial.counts,rework:-1}};
  assert.equal(transitionReviewState(corruptCount,action('approved')),corruptCount);
});

test('current sample output follows revised labels while publication samples stay frozen', () => {
  const originalSamples = [{id:'0148',text:'物流三天没有更新',label:'物流'}];
  const baseline = [{id:'base-1',text:'需要更换尺码',label:'售后'},{id:'base-2',text:'库存还有多少',label:'咨询'}];
  const initial = createReviewState(seedTasks,seedCounts);
  const revised = transitionReviewState(initial,action('approved','完成核对','咨询'));
  const current = currentSampleRows(originalSamples,revised.tasks);
  assert.equal(current[0].label,'咨询');
  assert.equal(originalSamples[0].label,'物流');
  assert.equal(JSON.parse(JSON.stringify(current[0])).label,'咨询');

  const snapshot = publicationSampleRecords(revised.tasks,baseline);
  assert.equal(snapshot[0].label,'咨询');
  assert.notEqual(snapshot[0],revised.tasks[0]);
  assert.notEqual(snapshot[1],baseline[0]);
  revised.tasks[0].label='商品';
  baseline[0].label='物流';
  assert.equal(snapshot[0].label,'咨询');
  assert.equal(snapshot[1].label,'售后');
  const excluded = publicationSampleRecords([{...seedTasks[0],status:'rework'}],[]);
  assert.deepEqual(excluded,[]);
});

test('reset state does not retain returned labels or history from a previous run', () => {
  let state=createReviewState(seedTasks,seedCounts);
  state=transitionReviewState(state,action('rework','需要修改','咨询'));
  const reset=createReviewState(seedTasks,seedCounts);
  assert.equal(reset.tasks[0].status,'review');
  assert.equal(reset.tasks[0].label,'物流');
  assert.deepEqual(reset.tasks[0].history,[]);
  assert.deepEqual(reset.counts,seedCounts);
});
