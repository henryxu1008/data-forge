import {imageRecordIssues} from './image-production-state.js';
/** Local prototype state only. No training, inference, network or resource allocation. */

const clone = value => JSON.parse(JSON.stringify(value));
const text = value => typeof value === 'string' ? value.trim() : '';
const unique = values => [...new Set(values)];
const round = value => Math.round(value * 100) / 100;
const actionNames = {
  startTraining: '创建训练任务', startEvaluation: '创建模型评测',
  publishService: '发布模型服务', retryDeployment: '重试服务部署',
  offlineService: '下线模型服务', invokeService: '测试模型服务', tick: '推进模型任务'
};

export function createModelLifecycleState() {
  return {sequence: 0, trainings: [], models: [], evaluations: [], services: [], calls: []};
}

function audit(action, object, result, at, before = {}, after = {}, details = '') {
  return {action, object, result, at, before, after, details};
}

function denied(state, action, reason, at, object = '模型生产流程') {
  return {
    ok: false, state, error: reason,
    events: at ? [audit(actionNames[action.type] || '操作模型生产流程', object, '拒绝', at, {}, {}, reason)] : []
  };
}

function nextId(state, prefix) {
  state.sequence += 1;
  return `${prefix}-${String(state.sequence).padStart(4, '0')}`;
}

function configuredLabels(version) {
  const labels = version?.specSnapshot?.labels;
  if (!Array.isArray(labels)) return null;
  return unique(labels.map(item => text(typeof item === 'string' ? item : item?.name)).filter(Boolean));
}

function sourceVersion(versions, versionId) {
  const matches = Array.isArray(versions) ? versions.filter(item => item?.id === versionId) : [];
  if (matches.length !== 1) return {error: '请重新选择一个存在且唯一的已发布数据版本。'};
  const source = matches[0];
  if (!text(source.id) || !text(source.datasetId) || !text(source.projectId) || !text(source.batchId)) {
    return {error: '数据版本缺少项目、数据集或批次来源，不能进入模型生产。'};
  }
  if (!Array.isArray(source.records) || source.records.length === 0) {
    return {error: '该发布版本没有可使用的完整记录，请先完成数据生产与发布。'};
  }
  const ids = source.records.map(record => text(record?.id));
  if (ids.some(id => !id) || unique(ids).length !== ids.length) {
    return {error: '数据版本的样本编号缺失或重复，请检查发布来源。'};
  }
  if (source.type === 'image') {
    if(source.records.some(r=>r.status!=='approved'||imageRecordIssues(r,source.specSnapshot).length)) return {error:'图片版本缺少审核结果、原图或有效框。'};
    return {version:clone(source),labels:configuredLabels(source)||[],type:'image'};
  }
  if (source.records.some(record => !text(record.text) || !text(record.label) || (record.status && record.status !== 'approved'))) {
    return {error: '数据版本含空文本、无标签或尚未审核通过的记录。'};
  }
  const configured = configuredLabels(source);
  const labels = configured === null ? unique(source.records.map(record => text(record.label))) : configured;
  if (!labels.length || source.records.some(record => !labels.includes(text(record.label)))) {
    return {error: '数据记录的标签不符合该发布版本的冻结规范。'};
  }
  return {version: clone(source), labels};
}

function parseParams(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const params = {rank: Number(value.rank), epochs: Number(value.epochs), rate: Number(value.rate), batch: Number(value.batch)};
  if (!Number.isInteger(params.rank) || params.rank < 1 || params.rank > 256 ||
      !Number.isInteger(params.epochs) || params.epochs < 1 || params.epochs > 100 ||
      !Number.isFinite(params.rate) || params.rate <= 0 || params.rate > 1 ||
      !Number.isInteger(params.batch) || params.batch < 1 || params.batch > 1024) return null;
  return params;
}

function parseThresholds(value) {
  const source = value === undefined ? {accuracy: 90, macroF1: 80} : value;
  if (!source || typeof source !== 'object') return null;
  const thresholds = {accuracy: Number(source.accuracy), macroF1: Number(source.macroF1)};
  if (Object.values(thresholds).some(number => !Number.isFinite(number) || number < 1 || number > 100)) return null;
  return thresholds;
}

function sameLabels(a, b) {
  return a.length === b.length && a.every(label => b.includes(label));
}

export function getLatestEvaluation(state, modelVersionId) {
  // Reports are prepended on creation, so equal timestamps cannot reorder history.
  return state.evaluations.find(item => item.modelVersionId === modelVersionId);
}

function metricsPass(report) {
  const thresholds = parseThresholds(report.thresholds);
  return !!thresholds && Number.isFinite(report.metrics?.accuracy) && Number.isFinite(report.metrics?.macroF1) &&
    report.metrics.accuracy >= 0 && report.metrics.accuracy <= 100 && report.metrics.macroF1 >= 0 && report.metrics.macroF1 <= 100 &&
    report.metrics.accuracy >= thresholds.accuracy && report.metrics.macroF1 >= thresholds.macroF1;
}

export function getPublishEligibility(state, modelVersionId, evaluationId) {
  const model = state.models.find(item => item.id === modelVersionId);
  if (!model) return {ok: false, reason: '请先选择由已完成训练生成的模型版本。'};
  const training = state.trainings.find(item => item.id === model.trainingId);
  if (!training || training.status !== 'completed' || training.modelVersionId !== model.id) {
    return {ok: false, reason: '模型缺少已完成的训练来源，不能发布服务。'};
  }
  const latest = getLatestEvaluation(state, modelVersionId);
  if (!latest) return {ok: false, reason: '该模型尚未评测，请先完成评测并达到发布门槛。'};
  if (evaluationId && !state.evaluations.some(item => item.id === evaluationId && item.modelVersionId === modelVersionId)) {
    return {ok: false, reason: '指定评测报告不属于当前模型版本。', evaluation: latest};
  }
  if (latest.status === 'running') return {ok: false, reason: '最新一次评测正在运行，完成前不能使用旧报告发布。', evaluation: latest};
  if (latest.status === 'error') return {ok: false, reason: '最新一次评测运行异常，请完成新的评测后再发布。', evaluation: latest};
  if (latest.status !== 'passed' || !metricsPass(latest)) {
    return {ok: false, reason: '最新一次评测未达到发布门槛，请查看结果并重新评测。', evaluation: latest};
  }
  if (latest.modelSnapshot?.id !== model.id || latest.modelSnapshot?.trainingId !== model.trainingId || !latest.rows?.length) {
    return {ok: false, reason: '评测报告的模型来源或记录不完整，不能发布。', evaluation: latest};
  }
  if (evaluationId && latest.id !== evaluationId) {
    return {ok: false, reason: '所选报告不是该模型的最新一次评测，请使用最新达标报告重新发布。', evaluation: latest};
  }
  return {ok: true, reason: '最新评测已达到发布门槛。', evaluation: latest};
}

export function modelLifecycleHasWork(state) {
  return state.trainings.some(item => ['running','queued'].includes(item.status)) ||
    state.evaluations.some(item => item.status === 'running') ||
    state.services.some(item => item.status === 'deploying');
}

function lineage(model) {
  return {
    模型版本编号: model.id, 模型版本: model.version, 训练任务编号: model.trainingId,
    项目编号: model.projectId, 数据版本编号: model.dataVersionId, 批次编号: model.dataVersion.batchId
  };
}

function measureRows(rows) {
  const observed = unique(rows.flatMap(row => [row.truth, row.predicted]));
  const perClass = observed.map(label => {
    const support = rows.filter(row => row.truth === label).length;
    const predicted = rows.filter(row => row.predicted === label).length;
    const truePositive = rows.filter(row => row.truth === label && row.predicted === label).length;
    const precision = predicted ? truePositive / predicted : 0;
    const recall = support ? truePositive / support : 0;
    const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
    return {label, support, precision: round(precision * 100), recall: round(recall * 100), f1: round(f1 * 100)};
  });
  const average = field => round(perClass.reduce((sum, item) => sum + item[field], 0) / perClass.length);
  return {
    metrics: {
      accuracy: round(rows.filter(row => row.correct).length / rows.length * 100),
      precision: average('precision'), recall: average('recall'), macroF1: average('f1')
    },
    perClass
  };
}

function finishEvaluation(report, at) {
  report.progress = 100;
  report.completedAt = at;
  if (report.scenario === 'error') {
    report.status = 'error';
    report.error = '模拟评测执行失败：评测任务未完成，没有生成可发布的质量结论。';
    return;
  }
  const labels = report.modelSnapshot.labels;
  if(report.modelSnapshot.type==='image'){
    report.rows=report.dataVersion.records.map(record=>({id:record.id,text:record.fileName||record.name||record.id,truth:record.noDefect?'无缺陷':record.boxes.map(b=>b.label||b.category).join('、'),predicted:report.scenario==='pass'?(record.noDefect?'无缺陷':record.boxes.map(b=>b.label||b.category).join('、')):'未命中',correct:report.scenario==='pass',boxes:clone(record.boxes),noDefect:record.noDefect}));
    report.metrics={accuracy:report.scenario==='pass'?100:0,macroF1:report.scenario==='pass'?100:0,precision:report.scenario==='pass'?100:0,recall:report.scenario==='pass'?100:0};report.perClass=[];report.status=metricsPass(report)?'passed':'failed';report.metricNotice='冻结标注回放一致率，非真实检测 mAP/IoU 评测';return;
  }
  report.rows = report.dataVersion.records.map(record => {
    const truth = text(record.label);
    const predicted = report.scenario === 'pass' ? truth :
      labels.length > 1 ? labels[(labels.indexOf(truth) + 1) % labels.length] : '未识别（模拟）';
    return {id: record.id, text: record.text, truth, predicted, correct: truth === predicted};
  });
  Object.assign(report, measureRows(report.rows));
  report.status = metricsPass(report) ? 'passed' : 'failed';
}

function exampleOutput(service, input) {
  if(service.modelSnapshot.type==='image')return JSON.stringify({demo:true,modelVersionId:service.modelVersionId,dataVersionId:service.dataVersionId,noDefect:(service.dataVersion.records.find(r=>r.id===input)||service.dataVersion.records[0])?.noDefect,imageId:(service.dataVersion.records.find(r=>r.id===input)||service.dataVersion.records[0])?.id,detections:(service.dataVersion.records.find(r=>r.id===input)||service.dataVersion.records[0])?.boxes||[],notice:'冻结图片标注回放，非真实检测预测'},null,2);
  const rules = [
    ['售后', /退货|换货|退款|维修|划痕|售后|退换/],
    ['物流', /物流|发货|配送|快递|送达|运输|订单/],
    ['商品', /蓝牙|规格|尺寸|容量|型号|使用|参数/],
    ['咨询', /现货|颜色|白色|咨询|客服|库存/]
  ];
  const labels = service.modelSnapshot.labels;
  const matched = rules.find(([label, pattern]) => labels.includes(label) && pattern.test(input));
  const label = matched?.[0] || labels[0];
  return `模拟分类：${label}\n\n这是本地规则生成的流程示例，未执行真实模型推理。`;
}

export function applyModelLifecycleAction(state, action, {versions = [], concurrency = 100, gpu = 100, externalRunning = 0,acceptanceFactory} = {}) {
  if (!action || typeof action !== 'object') return {ok: false, state, error: '未提供有效操作。', events: []};
  const at = text(action.at);
  if (!at || !Number.isFinite(Date.parse(at))) return denied(state, action, '缺少有效操作时间，请刷新后重试。', null);
  const fail = (reason, object) => denied(state, action, reason, at, object);

  if (action.type === 'startTraining') {
    const name = text(action.name), base = text(action.base), params = parseParams(action.params);
    if (!name || name.length > 120 || !base || base.length > 200) return fail('请填写有效的训练任务名称和基础模型。');
    if (!params) return fail('训练参数无效，请检查 LoRA 秩、轮次、学习率和批大小。', name);
    const source = sourceVersion(versions, action.dataVersionId);
    if (source.error) return fail(source.error, name);
    if((source.type==='image')!==/YOLO|图像|检测/i.test(base))return fail('基础模型能力与数据类型不匹配；图片版本请选择检测流程，文本版本请选择文本模型。',name);
    if (state.trainings.some(item => ['running','queued'].includes(item.status) && item.name === name && item.dataVersionId === action.dataVersionId && item.base === base && JSON.stringify(item.params) === JSON.stringify(params))) {
      return fail('相同配置的训练任务已经运行，请等待本次任务完成。', name);
    }
    const next = clone(state);
    const entity = {
      id: nextId(next, 'TRAIN'), name, base, params, dataVersionId: source.version.id,
      dataVersion: source.version, progress: 0, status: state.trainings.filter(x=>x.status==='running').length < Math.min(gpu,concurrency-externalRunning) ? 'running':'queued', modelVersionId: null, createdAt: at, type:source.type||'text', scenario:action.scenario==='fail'?'fail':'success', attempts:[{id:nextId(next,'ATTEMPT'),status:'running',startedAt:at,params:clone(params),base,scenario:action.scenario==='fail'?'fail':'success'}]
    };
    entity.attempts[0].status=entity.status;next.trainings.unshift(entity);
    return {ok: true, state: next, entity, events: [audit('创建训练任务', name, '成功', at, {}, {
      训练任务编号: entity.id, 数据版本编号: entity.dataVersionId, 项目编号: entity.dataVersion.projectId,
      批次编号: entity.dataVersion.batchId, 完整演示记录: entity.dataVersion.records.length
    }, '训练配置与发布数据已保存独立快照；本任务仅模拟进度，不生成真实权重。')]};
  }

  if (action.type === 'cancelTraining' || action.type === 'retryTraining') {
    const previous=state.trainings.find(t=>t.id===action.trainingId);
    if(!previous) return fail('训练任务不存在。');
    if(!text(action.note)) return fail('请填写取消或重试说明。',previous.name);
    const next=clone(state),entity=next.trainings.find(t=>t.id===previous.id);
    if(action.type==='cancelTraining') {
      if(!['running','queued'].includes(entity.status))return fail('仅运行或排队任务可取消。',entity.name);
      entity.status='cancelled';entity.completedAt=at;entity.lastError=text(action.note);
      if(entity.attempts?.length)Object.assign(entity.attempts.at(-1),{status:'cancelled',endedAt:at,reason:text(action.note)});
    }else{
      if(!['failed','cancelled'].includes(entity.status))return fail('仅失败或取消任务可重试。',entity.name);
      const params=action.params?parseParams(action.params):entity.params;if(!params)return fail('重试参数无效。');
      entity.params=clone(params);entity.scenario=action.scenario==='fail'?'fail':'success';entity.progress=0;entity.status='queued';entity.lastError='';entity.completedAt=null;
      entity.attempts=entity.attempts||[];entity.attempts.push({id:nextId(next,'ATTEMPT'),status:'queued',startedAt:at,params:clone(params),base:entity.base,scenario:entity.scenario,note:text(action.note)});
    }
    return {ok:true,state:next,entity,events:[audit(action.type==='cancelTraining'?'取消训练任务':'重试训练任务',entity.name,'成功',at,{状态:previous.status},{状态:entity.status,训练任务编号:entity.id},text(action.note))]};
  }

  if (action.type === 'startEvaluation') {
    const model = state.models.find(item => item.id === action.modelVersionId);
    if (!model) return fail('请先选择由训练完成后生成的模型版本。');
    const training = state.trainings.find(item => item.id === model.trainingId);
    if (!training || training.status !== 'completed' || training.modelVersionId !== model.id) return fail('当前模型的训练来源未完成，不能启动评测。', model.name);
    if (state.evaluations.some(item => item.modelVersionId === model.id && item.status === 'running')) return fail('该模型已有评测运行中，请等待完成。', model.name);
    const scenario = action.scenario || 'pass';
    if (!['pass', 'fail', 'error'].includes(scenario)) return fail('请选择有效的演示评测场景。', model.name);
    const taskPlan=model.dataVersion?.taskPlan;
    if(taskPlan&&action.thresholds&&(Number(action.thresholds.accuracy)!==taskPlan.metrics.accuracy||Number(action.thresholds.macroF1)!==taskPlan.metrics.macroF1))return fail('评测必须使用模型数据冻结的任务指标版本。',model.name);
    const thresholds = parseThresholds(taskPlan?.metrics||action.thresholds);
    if (!thresholds) return fail('准确率和宏平均 F1 门槛必须在 1–100 之间。', model.name);
    const source = sourceVersion(versions, action.dataVersionId);
    if (source.error) return fail(source.error, model.name);
    if(taskPlan&&source.version.taskPlan?.id!==taskPlan.id)return fail('评测数据与模型的任务指标版本不兼容。',model.name);
    const configured = configuredLabels(source.version);
    if ((source.version.type==='image') !== (model.type==='image') || (model.type!=='image' && source.version.records.some(record => !model.labels.includes(text(record.label)))) || (configured !== null && !sameLabels(configured, model.labels))) {
      return fail('评测数据的标签与模型训练规范不兼容，请选择标签一致的发布版本。', model.name);
    }
    const acceptance=acceptanceFactory?acceptanceFactory(model,source.version,{...action,at}):null;
    if(acceptance&&!acceptance.ok)return fail(acceptance.error,model.name);
    const next = clone(state);
    const entity = {
      ...(acceptance?.snapshot?{acceptanceSnapshot:clone(acceptance.snapshot)}:{}),
      id: nextId(next, 'EVAL'), name: `${model.name} ${model.version} · 评测`, modelVersionId: model.id,
      modelSnapshot: clone(model), dataVersionId: source.version.id, dataVersion: source.version,
      scenario, thresholds:acceptance?.snapshot?.planSnapshot?{accuracy:acceptance.snapshot.planSnapshot.metrics.accuracy,macroF1:acceptance.snapshot.planSnapshot.metrics.macroF1}:thresholds, progress: 0, status: 'running', rows: [], createdAt: at,
      sameSource: source.version.id === model.dataVersionId,...(taskPlan?{taskPlan:clone(taskPlan)}:{})
    };
    next.evaluations.unshift(entity);
    return {ok: true, state: next, entity, events: [audit('创建模型评测', entity.name, '成功', at, {}, {
      ...lineage(model), 评测编号: entity.id, 评测数据版本编号: entity.dataVersionId,
      实际评测记录: entity.dataVersion.records.length, 准确率门槛: thresholds.accuracy, 宏平均F1门槛: thresholds.macroF1
    }, entity.sameSource ? '同源快照回放，仅验证本地流程，不能作为模型泛化性能结论。' : '使用独立数据快照和模拟预测结果验证本地评测流程。')]};
  }

  if (action.type === 'publishService') {
    const name = text(action.name), note = text(action.note), scenario = action.scenario || 'success';
    if (!name || name.length > 120 || !note) return fail('请填写服务名称和发布说明。', name || undefined);
    if (!['success', 'fail'].includes(scenario)) return fail('请选择有效的模拟部署场景。', name);
    if (!text(action.evaluationId)) return fail('请明确选择本次发布绑定的评测报告。', name);
    const eligibility = getPublishEligibility(state, action.modelVersionId, action.evaluationId);
    if (!eligibility.ok) return fail(eligibility.reason, name);
    if (state.services.some(item => item.name === name && item.status !== 'offline')) return fail('已有同名服务，请查看已有部署或使用其他名称。', name);
    const model = state.models.find(item => item.id === action.modelVersionId);
    const next = clone(state);
    const entity = {
      id: nextId(next, 'SERVICE'), name, status: 'deploying', modelVersionId: model.id,
      modelSnapshot: clone(model), trainingId: model.trainingId, dataVersionId: model.dataVersionId,
      dataVersion: clone(model.dataVersion), evaluationId: eligibility.evaluation.id,
      evaluationSnapshot: clone(eligibility.evaluation), releaseNote: note, progress: 0,
      attempts: [{id: nextId(next, 'DEPLOY'), status: 'deploying', scenario, progress: 0, startedAt: at}], createdAt: at
    };
    next.services.unshift(entity);
    return {ok: true, state: next, entity, events: [audit('发布模型服务', name, '成功', at, {}, {
      ...lineage(model), 服务编号: entity.id, 评测编号: entity.evaluationId, 状态: '部署中'
    }, `${note}；仅创建本地模拟服务，不建立真实网络端点。`)]};
  }

  if (action.type === 'retryDeployment') {
    const service = state.services.find(item => item.id === action.serviceId);
    if (!service) return fail('未找到待重试的服务。');
    if (service.status !== 'failed') return fail('仅部署失败的服务可以重试。', service.name);
    const eligibility = getPublishEligibility(state, service.modelVersionId, service.evaluationId);
    if (!eligibility.ok) return fail(eligibility.reason, service.name);
    const scenario = action.scenario || 'success';
    if (!['success', 'fail'].includes(scenario)) return fail('请选择有效的模拟部署场景。', service.name);
    const next = clone(state), entity = next.services.find(item => item.id === service.id);
    entity.status = 'deploying'; entity.progress = 0; entity.lastError = '';
    entity.attempts.push({id: nextId(next, 'DEPLOY'), status: 'deploying', scenario, progress: 0, startedAt: at});
    return {ok: true, state: next, entity, events: [audit('重试服务部署', service.name, '成功', at, {
      状态: service.status, 上次失败: service.lastError
    }, {服务编号: service.id, 部署次数: entity.attempts.length, 模型版本编号: service.modelVersionId, 评测编号: service.evaluationId}, '保留原失败记录，按相同模型和评测来源启动新的模拟部署。')]};
  }

  if (action.type === 'offlineService') {
    const service = state.services.find(item => item.id === action.serviceId);
    if (!service) return fail('未找到要下线的服务。');
    if (service.status !== 'running') return fail('仅运行中的服务可以下线。', service.name);
    const note = text(action.note);
    if (!note) return fail('请填写服务下线原因。', service.name);
    const next = clone(state), entity = next.services.find(item => item.id === service.id);
    entity.status = 'offline'; entity.offlineAt = at; entity.offlineReason = note;
    return {ok: true, state: next, entity, events: [audit('下线模型服务', service.name, '成功', at,
      {状态: 'running'}, {状态: 'offline', 服务编号: service.id, 模型版本编号: service.modelVersionId, 评测编号: service.evaluationId}, note)]};
  }

  if (action.type === 'invokeService') {
    const service = state.services.find(item => item.id === action.serviceId);
    if (!service) return fail('未找到所选服务，请重新选择。');
    const input = text(action.input), scenario = action.scenario || 'success';
    if (!input || input.length > 8000) return fail('请输入 1–8000 个字符的测试内容。', service.name);
    if (!['success', 'error'].includes(scenario)) return fail('请选择有效的调用场景。', service.name);
    let status = 'succeeded', reason = '', output = '';
    if (service.status !== 'running') {
      status = 'rejected';
      const descriptions = {deploying: '正在部署', failed: '部署失败', offline: '已下线'};
      reason = `服务${descriptions[service.status] || '未运行'}，不能处理新的调用。`;
    } else if (scenario === 'error') {
      status = 'failed'; reason = '模拟推理执行异常；请求已记录，可保持配置重新测试。';
    } else output = exampleOutput(service, input);
    const next = clone(state);
    const entity = {
      id: nextId(next, 'CALL'), serviceId: service.id, serviceName: service.name,
      modelVersionId: service.modelVersionId, trainingId: service.trainingId,
      dataVersionId: service.dataVersionId, evaluationId: service.evaluationId,
      input, output, status, reason, at, serviceStatus: service.status
    };
    next.calls.unshift(entity);
    return {ok: status === 'succeeded', state: next, entity, ...(status !== 'succeeded' ? {error: reason} : {}), events: [audit(
      '测试模型服务', service.name, status === 'succeeded' ? '成功' : status === 'failed' ? '失败' : '拒绝', at, {},
      {调用编号: entity.id, 服务编号: service.id, 模型版本编号: service.modelVersionId, 训练任务编号: service.trainingId, 数据版本编号: service.dataVersionId, 评测编号: service.evaluationId, 调用时服务状态: service.status},
      reason || '本地模拟请求成功；输出为示例，不执行真实模型推理。'
    )]};
  }

  if (action.type === 'tick') {
    if (!modelLifecycleHasWork(state)) return {ok: true, state, events: []};
    const next = clone(state), events = [];
    let slots=Math.max(0,concurrency-externalRunning-next.trainings.filter(t=>t.status==='running').length);
    let gpuSlots=Math.max(0,gpu-next.trainings.filter(t=>t.status==='running').length);
    for(const waiting of [...next.trainings].reverse()){if(waiting.status==='queued'&&slots>0&&gpuSlots>0){waiting.status='running';if(waiting.attempts?.length)waiting.attempts.at(-1).status='running';slots--;gpuSlots--}}
    for (const training of next.trainings) {
      if (training.status !== 'running') continue;
      training.progress = Math.min(100, training.progress + 25);
      if (training.progress < 100) continue;
      if(training.scenario==='fail'){training.status='failed';training.lastError='模拟训练失败：资源执行异常，请检查参数后重试。';training.completedAt=at;if(training.attempts?.length)Object.assign(training.attempts.at(-1),{status:'failed',endedAt:at,reason:training.lastError});events.push(audit('训练任务失败',training.name,'失败',at,{}, {训练任务编号:training.id,状态:'failed'},training.lastError));continue}
      training.status = 'completed'; training.completedAt = at;
      if(training.attempts?.length)Object.assign(training.attempts.at(-1),{status:'completed',endedAt:at});
      const versionNumber = next.models.filter(item => item.datasetId === training.dataVersion.datasetId).length + 1;
      const labels = configuredLabels(training.dataVersion) || unique(training.dataVersion.records.map(record => record.label));
      const model = {
        id: nextId(next, 'MODEL'), type:training.type||'text', name: `${training.dataVersion.datasetName || training.dataVersion.projectName || '文本分类'} · ${training.type==='image'?'检测模型':'分类模型'}`,
        version: `v${versionNumber}`, trainingId: training.id, projectId: training.dataVersion.projectId,
        datasetId: training.dataVersion.datasetId, base: training.base, params: clone(training.params),
        dataVersionId: training.dataVersionId, dataVersion: clone(training.dataVersion), labels, createdAt: at
      };
      training.modelVersionId = model.id;
      next.models.unshift(model);
      events.push(audit('完成演示训练', training.name, '成功', at, {状态: 'running'}, {
        状态: 'completed', ...lineage(model)
      }, '训练模拟完成并生成独立模型版本记录；不包含真实模型权重。'));
      events.push(audit('登记模型版本', `${model.name} ${model.version}`, '成功', at, {}, lineage(model), '从已完成的训练自动登记模型版本，保留训练参数和数据来源快照。'));
    }
    for (const report of next.evaluations) {
      if (report.status !== 'running') continue;
      report.progress = Math.min(100, report.progress + 25);
      if (report.progress < 100) continue;
      finishEvaluation(report, at);
      events.push(audit('完成模型评测', report.name, report.status === 'passed' ? '成功' : '失败', at, {状态: 'running'}, {
        状态: report.status, 模型版本编号: report.modelVersionId, 评测编号: report.id,
        评测数据版本编号: report.dataVersionId, 实际评测记录: report.dataVersion.records.length,
        ...(report.metrics ? {准确率: report.metrics.accuracy, 宏平均F1: report.metrics.macroF1} : {})
      }, report.error || (report.status === 'passed' ? '模拟预测达到本次冻结门槛，可进入服务发布。' : '模拟预测未达到本次冻结门槛，已阻止服务发布。')));
    }
    for (const service of next.services) {
      if (service.status !== 'deploying') continue;
      const attempt = service.attempts.at(-1);
      service.progress = Math.min(100, service.progress + 25);
      attempt.progress = service.progress;
      if (service.progress < 100) continue;
      attempt.endedAt = at;
      if (attempt.scenario === 'fail') {
        service.status = 'failed'; attempt.status = 'failed';
        service.lastError = '模拟部署失败：运行资源检查未通过，可修复演示条件后重试。';
        attempt.error = service.lastError;
      } else {
        service.status = 'running'; attempt.status = 'running'; service.lastError = '';
      }
      events.push(audit('完成服务部署', service.name, service.status === 'running' ? '成功' : '失败', at, {状态: 'deploying'}, {
        状态: service.status, 服务编号: service.id, 部署记录编号: attempt.id, 模型版本编号: service.modelVersionId, 评测编号: service.evaluationId
      }, service.lastError || '本地模拟服务已运行，可测试请求；未部署真实推理端点。'));
    }
    if(JSON.stringify(next)===JSON.stringify(state))return {ok:true,state,events:[]};
    return {ok: true, state: next, events};
  }
  return fail('不支持该模型生产操作，当前记录未改变。');
}
