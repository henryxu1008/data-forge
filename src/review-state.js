// Local prototype state: these actors describe the simulated flow, not permissions.
export const reviewLabels = ['物流', '售后', '商品', '咨询'];

export function createReviewState(tasks, counts) {
  return {
    tasks: tasks.map(task => ({...task, history: (task.history || []).map(event => ({...event}))})),
    counts: {...counts},
  };
}

export function transitionReviewState(state, {id, status, label, note = '', at}) {
  const task = state.tasks.find(item => item.id === id);
  const transitions = {review: ['approved', 'rework'], rework: ['review']};
  if (!task || !transitions[task.status]?.includes(status)) return state;
  const nextLabel = typeof label === 'string' ? label.trim() : '';
  const detail = typeof note === 'string' ? note.trim() : '';
  if (!reviewLabels.includes(nextLabel)) return state;
  if ((status === 'rework' || status === 'review') && !detail) return state;
  if (Object.values(state.counts).some(count => !Number.isSafeInteger(count) || count < 0)
    || !(state.counts[task.status] > 0) || !Number.isSafeInteger(state.counts[status])) return state;

  const resubmitting = status === 'review';
  const history = [...(task.history || []), {
    id: `${id}-${(task.history || []).length + 1}`,
    from: task.status,
    to: status,
    action: resubmitting ? '返工后重新提交' : status === 'approved' ? '审核通过' : '退回修改',
    actor: resubmitting ? `${task.annotator} · 演示标注人` : '演示管理员 · 演示审核员',
    at,
    label: nextLabel,
    note: detail,
  }];
  const updated = {
    ...task,
    status,
    label: nextLabel,
    history,
    updatedAt: at,
    ...(status === 'rework' ? {reason: detail, returnReason: detail} : {}),
    ...(resubmitting ? {reworkNote: detail, resubmissions: (task.resubmissions || 0) + 1} : {}),
    ...(status === 'approved' ? {reason: detail, reviewNote: detail} : {}),
  };
  return {
    tasks: state.tasks.map(item => item.id === id ? updated : item),
    counts: {...state.counts, [task.status]: state.counts[task.status] - 1, [status]: state.counts[status] + 1},
  };
}

export function currentSampleRows(samples, tasks) {
  return samples.map(row => {
    const task = tasks.find(item => item.id === row.id);
    return task ? {...row, label: task.label, status: task.status} : {...row};
  });
}

export function publicationSampleRecords(tasks, baselineSamples) {
  return [...tasks.filter(task => task.status === 'approved'), ...baselineSamples]
    .slice(0, 3)
    .map(({id, text, label}) => ({id, text, label}));
}
