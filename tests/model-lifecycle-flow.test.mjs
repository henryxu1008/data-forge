import assert from 'node:assert/strict';
import test from 'node:test';
import {applyModelLifecycleAction, createModelLifecycleState, getLatestEvaluation, getPublishEligibility, modelLifecycleHasWork} from '../src/model-lifecycle-state.js';
import {createTextBatch, createDemoTextRecords, applyTextBatchAction} from '../src/text-production-state.js';

const at = '2026-10-27T07:00:00.000Z';
const labels = ['物流', '售后', '商品', '咨询'];
function version(id = 'D-A-v1', options = {}) {
  return {
    id, datasetId: 'D-A', datasetName: '售后批次 A', projectId: 'P-A', projectName: '售后意图项目', batchId: 'B-A',
    version: 'v0.1', count: 4,
    specSnapshot: {versionId: 'spec-v1', labels: labels.map(name => ({name}))},
    records: labels.map((label, index) => ({id: `sample-${index + 1}`, text: `${label}相关测试内容`, label, status: 'approved'})),
    ...options
  };
}
const baseParams = () => ({rank: 16, epochs: 3, rate: 0.0002, batch: 4});
function act(state, type, payload = {}, versions = [version()]) {
  return applyModelLifecycleAction(state, {type, ...payload, at}, {versions});
}
function must(state, type, payload = {}, versions = [version()]) {
  const result = act(state, type, payload, versions);
  assert.equal(result.ok, true, result.error);
  return result;
}
function reject(state, type, payload = {}, versions = [version()]) {
  const saved = JSON.stringify(state);
  const result = act(state, type, payload, versions);
  assert.equal(result.ok, false);
  assert.equal(result.state, state);
  assert.equal(JSON.stringify(state), saved);
  assert.ok(result.error);
  return result;
}
function finish(state) {
  for (let i = 0; i < 4; i++) state = must(state, 'tick').state;
  return state;
}
function trained(versions = [version()], payload = {}) {
  return finish(must(createModelLifecycleState(), 'startTraining', {
    name: '训练 A', base: 'Qwen2.5-7B-Instruct', params: baseParams(), dataVersionId: versions[0].id, ...payload
  }, versions).state);
}
function evaluated(state, scenario = 'pass', versions = [version()], payload = {}) {
  return finish(must(state, 'startEvaluation', {
    modelVersionId: state.models[0].id, dataVersionId: versions[0].id, scenario,
    thresholds: {accuracy: 90, macroF1: 80}, ...payload
  }, versions).state);
}
function published(state, scenario = 'success') {
  const model = state.models[0], evaluation = getLatestEvaluation(state, model.id);
  return must(state, 'publishService', {modelVersionId: model.id, evaluationId: evaluation.id, name: '售后意图服务', note: '首轮本地演示发布', scenario}).state;
}

test('training validates authoritative published sources and parameters without accepting client snapshots', () => {
  const state = createModelLifecycleState(), valid = {name: '训练', base: 'Qwen', params: baseParams(), dataVersionId: 'D-A-v1'};
  reject(state, 'startTraining', {...valid, dataVersionId: 'fake', dataVersion: version('fake')});
  reject(state, 'startTraining', valid, []);
  reject(state, 'startTraining', valid, [version(), version()]);
  reject(state, 'startTraining', {...valid, name: '  '});
  reject(state, 'startTraining', {...valid, params: null});
  reject(state, 'startTraining', {...valid, params: {...baseParams(), epochs: 0}});
  reject(state, 'startTraining', {...valid, params: {...baseParams(), rate: Infinity}});
  reject(state, 'startTraining', valid, [version('D-A-v1', {records: []})]);
  reject(state, 'startTraining', valid, [version('D-A-v1', {projectId: ''})]);
  reject(state, 'startTraining', valid, [version('D-A-v1', {records: [{id: '1', text: '文本', label: '未知'}]})]);
  assert.equal(state.trainings.length, 0);
});

test('training freezes configuration and source; completion creates exactly one linked model', () => {
  const source = version(), params = baseParams();
  let result = must(createModelLifecycleState(), 'startTraining', {name: '训练 A', base: 'Qwen', params, dataVersionId: source.id}, [source]);
  const running = result.state;
  assert.equal(running.models.length, 0);
  assert.equal(modelLifecycleHasWork(running), true);
  source.records[0].label = '被外部修改'; params.rank = 128;
  assert.equal(running.trainings[0].dataVersion.records[0].label, '物流');
  assert.equal(running.trainings[0].params.rank, 16);
  reject(running, 'startTraining', {name: '训练 A', base: 'Qwen', params: baseParams(), dataVersionId: 'D-A-v1'});
  let state = finish(running);
  assert.equal(state.models.length, 1);
  assert.equal(state.trainings[0].status, 'completed');
  assert.equal(state.trainings[0].modelVersionId, state.models[0].id);
  assert.equal(state.models[0].trainingId, state.trainings[0].id);
  assert.equal(state.models[0].dataVersionId, 'D-A-v1');
  assert.notEqual(state.models[0].dataVersion, state.trainings[0].dataVersion);
  const unchanged = must(state, 'tick');
  assert.equal(unchanged.state, state);
  assert.deepEqual(unchanged.events, []);
  assert.equal(running.trainings[0].progress, 0);
  assert.equal(modelLifecycleHasWork(state), false);
});

test('multiple trainings preserve independent model versions and exact dataset provenance', () => {
  const v1 = version(), v2 = version('D-A-v2', {version: 'v0.2', count: 3, records: version().records.slice(1)});
  let state = trained([v1]);
  const first = JSON.stringify(state.trainings[0]), firstModel = JSON.stringify(state.models[0]);
  state = must(state, 'startTraining', {name: '训练 B', base: 'Qwen', params: {...baseParams(), rank: 32}, dataVersionId: v2.id}, [v1, v2]).state;
  state = finish(state);
  assert.equal(state.trainings.length, 2);
  assert.equal(state.models.length, 2);
  assert.notEqual(state.models[0].id, state.models[1].id);
  assert.equal(state.models[0].version, 'v2');
  assert.equal(state.models[1].version, 'v1');
  assert.equal(state.models[0].dataVersion.records.length, 3);
  assert.equal(JSON.stringify(state.trainings[1]), first);
  assert.equal(JSON.stringify(state.models[1]), firstModel);
});

test('evaluation rejects incompatible labels, empty snapshots and duplicate in-flight evaluations', () => {
  let state = trained(); const modelVersionId = state.models[0].id;
  const config = {modelVersionId, dataVersionId: 'D-A-v1', scenario: 'pass', thresholds: {accuracy: 90, macroF1: 80}};
  reject(state, 'startEvaluation', {...config, modelVersionId: 'missing'});
  reject(state, 'startEvaluation', {...config, thresholds: {accuracy: 0, macroF1: 101}});
  reject(state, 'startEvaluation', {...config, scenario: 'pretend'});
  reject(state, 'startEvaluation', config, [version('D-A-v1', {records: []})]);
  const incompatible = version('D-A-v1', {specSnapshot: {labels: ['物流', '售后', '咨询']}, records: version().records.filter(row => row.label !== '商品')});
  reject(state, 'startEvaluation', config, [incompatible]);
  state = must(state, 'startEvaluation', config).state;
  reject(state, 'startEvaluation', config);
  assert.equal(state.evaluations.length, 1);
  assert.match(getPublishEligibility(state, modelVersionId).reason, /正在运行/);
});

test('evaluation calculates only real snapshot records and freezes thresholds, model and source', () => {
  const legacy = version('customer:v0.2', {count: 880, specSnapshot: undefined, records: version().records.slice(0, 3)});
  let state = trained([legacy]);
  const thresholds = {accuracy: 91, macroF1: 81};
  const result = must(state, 'startEvaluation', {modelVersionId: state.models[0].id, dataVersionId: legacy.id, scenario: 'pass', thresholds}, [legacy]);
  legacy.records[0].text = '外部重写'; thresholds.accuracy = 100;
  state = finish(result.state);
  const report = state.evaluations[0];
  assert.equal(report.rows.length, 3);
  assert.equal(report.dataVersion.count, 880);
  assert.equal(report.rows[0].text, '物流相关测试内容');
  assert.equal(report.thresholds.accuracy, 91);
  assert.equal(report.sameSource, true);
  assert.deepEqual(report.metrics, {accuracy: 100, precision: 100, recall: 100, macroF1: 100});
  assert.equal(report.status, 'passed');
  assert.notEqual(report.modelSnapshot, state.models[0]);
});

test('failed and errored reports prevent publication, and new passing reports preserve history', () => {
  let state = evaluated(trained(), 'fail');
  const model = state.models[0], failed = state.evaluations[0];
  assert.equal(failed.status, 'failed');
  assert.equal(failed.metrics.accuracy, 0);
  assert.ok(failed.rows.every(row => !row.correct));
  reject(state, 'publishService', {modelVersionId: model.id, evaluationId: failed.id, name: '服务', note: '发布'});
  state = evaluated(state, 'error');
  assert.equal(state.evaluations[0].status, 'error');
  assert.equal(state.evaluations[0].metrics, undefined);
  assert.equal(state.evaluations[0].rows.length, 0);
  assert.equal(getPublishEligibility(state, model.id).ok, false);
  state = evaluated(state, 'pass');
  assert.equal(getPublishEligibility(state, model.id).ok, true);
  assert.deepEqual(state.evaluations.map(report => report.status), ['passed', 'error', 'failed']);
  assert.deepEqual(state.evaluations[2], failed);
});

test('latest evaluation governs new publication, including running and report/model mismatch', () => {
  let state = evaluated(trained());
  const model = state.models[0], first = state.evaluations[0];
  state = must(state, 'startEvaluation', {modelVersionId: model.id, dataVersionId: 'D-A-v1', scenario: 'pass'}).state;
  assert.equal(getPublishEligibility(state, model.id, first.id).ok, false);
  reject(state, 'publishService', {modelVersionId: model.id, evaluationId: first.id, name: '服务', note: '不能用旧报告'});
  state = finish(state);
  assert.equal(getPublishEligibility(state, model.id, first.id).ok, false);
  assert.equal(getPublishEligibility(state, model.id, 'unknown-report').ok, false);
  assert.equal(getPublishEligibility(state, model.id, state.evaluations[0].id).ok, true);
  const unrelated = version('D-B-v1', {datasetId: 'D-B', batchId: 'B-B'});
  state = finish(must(state, 'startTraining', {name: 'B', base: 'Qwen', params: baseParams(), dataVersionId: unrelated.id}, [unrelated]).state);
  reject(state, 'publishService', {modelVersionId: state.models[0].id, evaluationId: first.id, name: '服务', note: '不能跨模型'});
});

test('service publication freezes exact model, training, data and evaluation provenance', () => {
  let state = evaluated(trained());
  const model = state.models[0], report = state.evaluations[0];
  reject(state, 'publishService', {modelVersionId: model.id, evaluationId: report.id, name: '服务', note: ''});
  reject(state, 'publishService', {modelVersionId: model.id, name: '服务', note: '必须选择报告'});
  const previous = state;
  state = published(state);
  const service = state.services[0];
  assert.equal(service.status, 'deploying');
  assert.equal(service.modelVersionId, model.id);
  assert.equal(service.trainingId, model.trainingId);
  assert.equal(service.dataVersionId, model.dataVersionId);
  assert.equal(service.evaluationId, report.id);
  assert.notEqual(service.modelSnapshot, model);
  assert.notEqual(service.evaluationSnapshot, report);
  assert.notEqual(service.dataVersion, model.dataVersion);
  assert.equal(previous.services.length, 0);
  reject(state, 'publishService', {modelVersionId: model.id, evaluationId: report.id, name: service.name, note: '重复点击'});
});

test('failed deployment rejects calls; retry appends an attempt and retains original failure', () => {
  let state = finish(published(evaluated(trained()), 'fail'));
  const service = state.services[0];
  assert.equal(service.status, 'failed');
  assert.equal(service.attempts.length, 1);
  assert.ok(service.attempts[0].error);
  const oldAttempt = JSON.stringify(service.attempts[0]);
  const blocked = act(state, 'invokeService', {serviceId: service.id, input: '查一下物流'});
  assert.equal(blocked.ok, false);
  assert.equal(blocked.entity.status, 'rejected');
  assert.equal(blocked.state.calls.length, 1);
  state = must(blocked.state, 'retryDeployment', {serviceId: service.id, scenario: 'success'}).state;
  assert.equal(state.services[0].attempts.length, 2);
  assert.equal(state.services[0].status, 'deploying');
  reject(state, 'retryDeployment', {serviceId: service.id});
  state = finish(state);
  assert.equal(state.services[0].status, 'running');
  assert.equal(state.services[0].attempts[1].status, 'running');
  assert.equal(JSON.stringify(state.services[0].attempts[0]), oldAttempt);
  assert.equal(service.status, 'failed');
});

test('deployment retry rechecks latest evaluation and cannot change pinned sources', () => {
  let state = finish(published(evaluated(trained()), 'fail'));
  const service = state.services[0];
  state = evaluated(state, 'pass');
  const rejection = reject(state, 'retryDeployment', {serviceId: service.id, scenario: 'success', evaluationId: state.evaluations[0].id});
  assert.match(rejection.error, /最新/);
  assert.equal(state.services[0].evaluationId, service.evaluationId);
  assert.equal(state.services[0].attempts.length, 1);
});

test('online calls succeed or fail honestly; offline rejects new requests and preserves old history', () => {
  let state = finish(published(evaluated(trained())));
  const service = state.services[0];
  const first = must(state, 'invokeService', {serviceId: service.id, input: '我的订单什么时候发货？'});
  assert.equal(first.entity.status, 'succeeded');
  assert.match(first.entity.output, /模拟分类：物流/);
  assert.equal(first.entity.modelVersionId, service.modelVersionId);
  assert.equal(first.entity.evaluationId, service.evaluationId);
  state = first.state;
  const successSnapshot = JSON.stringify(first.entity);
  const failed = act(state, 'invokeService', {serviceId: service.id, input: '测试失败', scenario: 'error'});
  assert.equal(failed.ok, false);
  assert.equal(failed.entity.status, 'failed');
  assert.equal(failed.entity.output, '');
  state = failed.state;
  reject(state, 'offlineService', {serviceId: service.id, note: '   '});
  state = must(state, 'offlineService', {serviceId: service.id, note: '完成演示，需要暂停调用'}).state;
  const rejected = act(state, 'invokeService', {serviceId: service.id, input: '下线后继续查询物流'});
  assert.equal(rejected.ok, false);
  assert.equal(rejected.entity.status, 'rejected');
  assert.equal(rejected.entity.serviceStatus, 'offline');
  assert.match(rejected.error, /已下线/);
  assert.equal(rejected.entity.output, '');
  assert.equal(JSON.stringify(rejected.state.calls.at(-1)), successSnapshot);
  assert.equal(rejected.events[0].result, '拒绝');
  assert.equal(rejected.events[0].after.模型版本编号, service.modelVersionId);
  reject(rejected.state, 'offlineService', {serviceId: service.id, note: '重复下线'});
  reject(rejected.state, 'retryDeployment', {serviceId: service.id});
});

test('later reevaluation does not rewrite or silently shut down a previously released service', () => {
  let state = finish(published(evaluated(trained())));
  const service = JSON.stringify(state.services[0]);
  state = evaluated(state, 'fail');
  assert.equal(getPublishEligibility(state, state.models[0].id).ok, false);
  assert.equal(JSON.stringify(state.services[0]), service);
  const invocation = must(state, 'invokeService', {serviceId: state.services[0].id, input: '现货咨询'});
  assert.equal(invocation.entity.evaluationId, state.services[0].evaluationId);
  assert.notEqual(invocation.entity.evaluationId, state.evaluations[0].id);
});

test('deploying services and absent or invalid actions cannot claim a successful inference', () => {
  const state = published(evaluated(trained()));
  const service = state.services[0];
  const result = act(state, 'invokeService', {serviceId: service.id, input: '是否有现货'});
  assert.equal(result.ok, false);
  assert.equal(result.entity.status, 'rejected');
  assert.equal(result.entity.serviceStatus, 'deploying');
  reject(state, 'invokeService', {serviceId: service.id, input: ' '});
  reject(state, 'invokeService', {serviceId: 'missing', input: '有内容'});
  reject(state, 'offlineService', {serviceId: service.id, note: '尚未运行'});
  reject(state, 'unrecognized', {});
  const noTime = applyModelLifecycleAction(state, {type: 'tick'});
  assert.equal(noTime.ok, false);
  assert.equal(noTime.state, state);
});

test('tick audit records only completions and concurrent objects never share source snapshots', () => {
  const sourceA = version(), sourceB = version('D-B-v1', {datasetId: 'D-B', projectId: 'P-B', batchId: 'B-B'});
  let state = createModelLifecycleState();
  state = must(state, 'startTraining', {name: 'A', base: 'Qwen', params: baseParams(), dataVersionId: sourceA.id}, [sourceA, sourceB]).state;
  state = must(state, 'startTraining', {name: 'B', base: 'Qwen', params: baseParams(), dataVersionId: sourceB.id}, [sourceA, sourceB]).state;
  for (let i = 0; i < 3; i++) {
    const result = must(state, 'tick');
    assert.deepEqual(result.events, []);
    state = result.state;
  }
  const completed = must(state, 'tick');
  assert.equal(completed.events.length, 4);
  assert.equal(completed.state.models.length, 2);
  const byDataset = new Map(completed.state.models.map(model => [model.datasetId, model]));
  assert.equal(byDataset.get('D-A').projectId, 'P-A');
  assert.equal(byDataset.get('D-B').projectId, 'P-B');
  assert.notEqual(byDataset.get('D-A').dataVersion.records, byDataset.get('D-B').dataVersion.records);
  assert.equal(must(completed.state, 'tick').events.length, 0);
});

test('real text production output carries the same 6-to-4 lineage through training, evaluation, service and calls', () => {
  let batch = createTextBatch({
    datasetId: 'integration-dataset', name: '真实契约验收批次', projectId: 'integration-project', projectName: '闭环验收项目',
    batchId: 'integration-batch', rawRecords: createDemoTextRecords('integration'),
    specSnapshot: {versionId: 'integration-spec-v1', name: '文本意图分类', version: 'v1', labels: labels.map(name => ({name}))}, at
  });
  assert.equal(batch.rawRecords.length, 6);
  const dataAction = (type, payload = {}) => {
    const result = applyTextBatchAction(batch, {type, ...payload, at});
    assert.equal(result.ok, true, result.error);
    batch = result.batch;
    return result;
  };
  dataAction('clean');
  assert.equal(batch.records.length, 4);
  dataAction('assign', {assignee: '李一'});
  for (const sample of batch.records) {
    dataAction('submit', {taskId: sample.id, label: sample.referenceLabel});
    dataAction('approve', {taskId: sample.id, note: '跨模块契约验收通过'});
  }
  dataAction('checkQuality');
  const publishedData = dataAction('publish', {note: '用于训练到服务的跨模块契约验证', owner: '演示管理员'}).version;
  assert.equal(publishedData.records.length, 4);
  const sourceSnapshot = JSON.stringify(publishedData);
  let state = trained([publishedData]);
  const model = state.models[0];
  assert.equal(model.projectId, batch.projectId);
  assert.equal(model.dataVersionId, publishedData.id);
  assert.equal(model.dataVersion.batchId, batch.batchId);
  state = evaluated(state, 'pass', [publishedData]);
  assert.equal(state.evaluations[0].rows.length, 4);
  assert.equal(state.evaluations[0].sameSource, true);
  state = finish(published(state));
  const service = state.services[0];
  const call = must(state, 'invokeService', {serviceId: service.id, input: '请查询订单的物流配送进度'}).entity;
  assert.equal(call.status, 'succeeded');
  assert.equal(call.dataVersionId, publishedData.id);
  assert.equal(call.modelVersionId, model.id);
  assert.equal(call.trainingId, model.trainingId);
  assert.equal(call.evaluationId, state.evaluations[0].id);
  assert.equal(service.dataVersion.specSnapshot.versionId, batch.taskSpecVersionId);
  assert.equal(JSON.stringify(publishedData), sourceSnapshot);
  assert.notEqual(service.dataVersion.records, publishedData.records);
});
