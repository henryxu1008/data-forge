import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconAlertTriangle, IconArrowLeft, IconArrowRight, IconCheck, IconCircleCheck, IconClock, IconDownload, IconEye, IconInfoCircle, IconLock, IconPhoto, IconRefresh, IconShieldCheck, IconTrash, IconUpload } from '@tabler/icons-react';
import { Badge, Button, Empty, Field, Modal, PageHeader, Panel, Search, StepBar, downloadText } from './ui';
import { createDemoImageRecords, imageBatchCounts, imageCocoPayload, imageExportPayload } from './image-production-state.js';
import './image-production-panels.css';

const MAX_FILES = 12;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 8192;
const MAX_PIXELS = 24000000;
const IMAGE_STAGES = ['图片接入', '标注与审核', '质量检查', '版本发布'];
const STATUS_LABELS = { todo: '待标注', review: '待审核', rework: '待返工', approved: '已通过' };
const STATUS_TONES = { todo: 'gray', review: 'blue', rework: 'amber', approved: 'mint' };
const formatNumber = value => Number(value || 0).toLocaleString('zh-CN');
const boxCount = records => (records || []).reduce((sum, record) => sum + (record.boxes?.length || 0), 0);
const normalCount = records => (records || []).filter(record => record.noDefect && !record.boxes?.length).length;
const labelColor = (spec, label) => spec?.labels?.find(item => item.name === label)?.color || '#42d8c1';
const fileSafe = value => String(value || '图片数据').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 150);

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function actionError(error) {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : '操作未完成，请检查当前批次状态后重试。';
}

function ImageIdentity({ batch, version }) {
  const source = version || batch;
  return <dl className="ip-identity">
    <div><dt>所属任务</dt><dd>{source.projectName}<small>{source.projectId}</small></dd></div>
    <div><dt>{version ? '来源批次' : '工作批次'}</dt><dd>{source.batchId}<small>{source.datasetId}</small></dd></div>
    <div><dt>冻结规范</dt><dd>{source.specSnapshot?.name || '图像目标检测'}<small>{source.taskSpecVersionId || source.specSnapshot?.versionId}</small></dd></div>
    <div><dt>{version ? '快照修订' : '当前修订'}</dt><dd>R{version ? version.sourceRevision : batch.revision}<small>{version ? version.id : '所有统计来自本批次实际记录'}</small></dd></div>
  </dl>;
}

function Notice({ title, children, tone = 'info', className = '' }) {
  const Icon = tone === 'warning' || tone === 'error' ? IconAlertTriangle : tone === 'success' ? IconCircleCheck : IconInfoCircle;
  return <div className={`ip-notice ip-notice-${tone} ${className}`} role={tone === 'error' ? 'alert' : undefined}><Icon size={20} stroke={1.7}/><div>{title && <strong>{title}</strong>}{children && <div>{children}</div>}</div></div>;
}

function FrozenLabels({ spec }) {
  return <div className="ip-labels">{(spec?.labels || []).map(label => <span key={label.name} style={{ '--ip-label-color': label.color || '#42d8c1' }} title={label.description}><i/>{label.name}</span>)}</div>;
}

function ReadOnlyImage({ record, spec, compact = false }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [record?.id, record?.src]);
  if (!record?.src || !record.width || !record.height || failed) return <div className={`ip-image-missing ${compact ? 'ip-image-compact' : ''}`}><IconPhoto size={28}/><span>原图无法显示</span><small>{record?.name || '缺少有效图片来源'}</small></div>;
  const fontSize = Math.max(14, Math.min(record.width, record.height) / 34);
  return <div className={`ip-image-frame ${compact ? 'ip-image-compact' : ''}`}>
    <svg viewBox={`0 0 ${record.width} ${record.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${record.name}，${record.width} × ${record.height} 像素，${record.boxes?.length || 0} 个标注框`}>
      <image href={record.src} x="0" y="0" width={record.width} height={record.height} onError={() => setFailed(true)}/>
      {(record.boxes || []).map((box, index) => {
        const color = labelColor(spec, box.label);
        const label = `${index + 1} ${box.label || '未选类别'}`;
        const textY = box.y >= fontSize * 1.6 ? box.y - fontSize * 1.6 : box.y;
        return <g key={box.id}>
          <rect x={box.x} y={box.y} width={box.width} height={box.height} fill="none" stroke={color} strokeWidth={compact ? 2 : 2.5} vectorEffect="non-scaling-stroke"/>
          {!compact && <><rect x={box.x} y={textY} width={Math.min(record.width - box.x, (label.length + 1) * fontSize)} height={fontSize * 1.6} fill="#10211fe8"/><text x={box.x + fontSize * 0.35} y={textY + fontSize * 1.15} fill={color} fontSize={fontSize} fontWeight="600">{label}</text></>}
        </g>;
      })}
    </svg>
    {record.noDefect && !record.boxes?.length && <span className="ip-normal-overlay"><IconCheck size={13}/>已确认无缺陷</span>}
  </div>;
}

function BoxTable({ record, spec }) {
  if (!record.boxes?.length) return <Notice tone={record.noDefect ? 'success' : 'warning'} title={record.noDefect ? '已明确确认：无缺陷' : '尚未完成标注'}><p>{record.noDefect ? '该图片保留在数据快照中，目标框数量为 0。' : '没有标注框，也未声明无缺陷；需要完成标注后才能提交审核。'}</p></Notice>;
  return <div className="table-wrap ip-box-table"><table><caption>标注框坐标以原图像素为单位，原点位于图片左上角。</caption><thead><tr><th>框</th><th>缺陷类别</th><th>严重程度</th><th>X</th><th>Y</th><th>宽</th><th>高</th></tr></thead><tbody>{record.boxes.map((box, index) => <tr key={box.id}><td><span className="ip-box-index" title={box.id}>{index + 1}</span></td><td><span className="ip-box-category" style={{ '--ip-label-color': labelColor(spec, box.label) }}><i/>{box.label || '未选择'}</span></td><td>{box.severity || '未选择'}</td>{['x', 'y', 'width', 'height'].map(key => <td className="ip-number" key={key}>{Number.isInteger(box[key]) ? box[key] : Number(box[key]).toFixed(2)}</td>)}</tr>)}</tbody></table></div>;
}

function ImageRecordDetails({ record, spec }) {
  return <div className="ip-record-details">
    <div className="ip-record-heading"><div><strong>{record.name}</strong><span>{record.id} · {formatNumber(record.width)} × {formatNumber(record.height)} px</span></div><Badge tone={STATUS_TONES[record.status] || 'gray'}>{STATUS_LABELS[record.status] || record.status}</Badge></div>
    <ReadOnlyImage record={record} spec={spec}/>
    <div className="ip-image-caption"><span>{record.source === 'built-in' ? '内置示意图' : '本地导入图片'} · {record.mimeType}</span><span>{record.boxes?.length || 0} 个框 · 标注人 {record.assignee || '未分配'}</span></div>
    <BoxTable record={record} spec={spec}/>
    {record.note && <div className="ip-record-note"><span>标注说明</span><p>{record.note}</p></div>}
  </div>;
}

function exportSnapshot(batch, version, kind, onToast) {
  try {
    const payload = kind === 'coco' ? imageCocoPayload(batch, version) : imageExportPayload(batch, version);
    const filename = fileSafe(`${version.datasetName || batch.name}-${version.datasetId}-${version.batchId}-${version.version}`);
    downloadText(`${filename}.${kind === 'coco' ? 'coco' : 'snapshot'}.json`, JSON.stringify(payload, null, 2));
    onToast?.(kind === 'coco' ? `已下载 ${version.version} 的 COCO 标注 JSON；图片文件需另外保留。` : `已下载 ${version.version} 的完整图片与标注快照。`);
  } catch (error) {
    onToast?.(actionError(error), 'warning');
  }
}

export function ImageVersionPreview({ batch, version, onClose, onToast }) {
  const [selectedId, setSelectedId] = useState(version.records?.[0]?.id || '');
  useEffect(() => setSelectedId(version.records?.[0]?.id || ''), [version.id]);
  const records = version.records || [];
  const selected = records.find(record => record.id === selectedId) || records[0];
  const actualBoxes = boxCount(records);
  return <Modal title={`图片数据版本 ${version.version}`} description="已发布的独立快照 · 原图与标注只读" wide onClose={onClose} footer={<><Button onClick={onClose}>关闭</Button><Button icon={IconDownload} onClick={() => exportSnapshot(batch, version, 'coco', onToast)}>导出 COCO 标注</Button><Button variant="primary" icon={IconDownload} onClick={() => exportSnapshot(batch, version, 'full', onToast)}>导出完整快照 JSON</Button></>}>
    <div className="ip-version-viewer">
      <div className="ip-version-banner"><span><IconLock size={18}/>历史快照保持独立</span><Badge>{records.length} 张图片 · {actualBoxes} 个框</Badge></div>
      <ImageIdentity batch={batch} version={version}/>
      <dl className="ip-version-meta"><div><dt>发布时间</dt><dd>{formatTime(version.date)}（UTC+8）</dd></div><div><dt>发布人</dt><dd>{version.owner || '当前演示用户'}</dd></div><div><dt>无缺陷图片</dt><dd>{normalCount(records)} 张</dd></div></dl>
      <div className="ip-record-note"><span>发布说明</span><p>{version.note}</p></div>
      <FrozenLabels spec={version.specSnapshot}/>
      {records.length ? <><Field label={`快照图片（${records.length} 张）`}><select value={selected?.id || ''} onChange={event => setSelectedId(event.target.value)}>{records.map((record, index) => <option key={record.id} value={record.id}>{index + 1}. {record.name} · {record.boxes?.length || 0} 个框{record.noDefect ? ' · 无缺陷' : ''}</option>)}</select></Field><ImageRecordDetails record={selected} spec={version.specSnapshot}/></> : <Empty title="该快照没有可读取的图片" description="请核对该版本的来源；不会替换成当前工作批次。"/>}
      <Notice title="两种导出格式"><p>完整快照 JSON 包含图片 data URL、原始尺寸、标注、冻结规范及来源，可以独立留存。COCO JSON 仅包含图片索引、类别和标注；使用时需另备对应的原始图片文件。</p></Notice>
    </div>
  </Modal>;
}

async function readLocalImage(file, index, generation) {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const isPng = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => header[i] === byte);
  const isJpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
  const isWebp = header[0] === 82 && header[1] === 73 && header[2] === 70 && header[3] === 70 && header[8] === 87 && header[9] === 69 && header[10] === 66 && header[11] === 80;
  if (!isPng && !isJpeg && !isWebp) throw new Error(`${file.name}：文件内容不是有效的 PNG、JPEG 或 WebP。`);
  const mimeType = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : 'image/webp';
  const src = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name}：本地文件读取失败，请重新选择。`));
    reader.onabort = () => reject(new Error(`${file.name}：读取已中止。`));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      if (comma < 0) reject(new Error(`${file.name}：无法读取图片内容。`));
      else resolve(`data:${mimeType};base64,${result.slice(comma + 1)}`);
    };
    reader.readAsDataURL(file);
  });
  const dimensions = await new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => { cleanup(); reject(new Error(`${file.name}：解码超时，请检查图片或缩小尺寸。`)); }, 15000);
    const cleanup = () => { clearTimeout(timer); image.onload = null; image.onerror = null; image.src = ''; };
    image.onload = () => { const dimensions = { width: image.naturalWidth, height: image.naturalHeight }; cleanup(); resolve(dimensions); };
    image.onerror = () => { cleanup(); reject(new Error(`${file.name}：图片无法解码，文件可能损坏。`)); };
    image.src = src;
  });
  if (!dimensions.width || !dimensions.height) throw new Error(`${file.name}：图片尺寸无效。`);
  if (Math.max(dimensions.width, dimensions.height) > MAX_EDGE || dimensions.width * dimensions.height > MAX_PIXELS) throw new Error(`${file.name}：${dimensions.width} × ${dimensions.height} px 超出限制，长边须 ≤ 8192 px、总像素须 ≤ 2400 万。`);
  return { id: `IMG-UP-${generation}-${index + 1}`, name: file.name, src, ...dimensions, mimeType, source: 'upload', boxes: [], noDefect: false, note: '', status: 'todo', assignee: '', history: [] };
}

export function ImageIngestionView({ projects = [], onCreateImageDataset, onNavigate, onToast, requestedProjectId, active = true }) {
  const imageProjects = projects.filter(project => project.type === 'image');
  const [projectId, setProjectId] = useState(() => requestedProjectId ? imageProjects.find(project => project.id === requestedProjectId)?.id || '' : imageProjects[0]?.id || '');
  const [name, setName] = useState('工业缺陷图片 · 新批次');
  const [records, setRecords] = useState([]);
  const [fileBytes, setFileBytes] = useState({});
  const [errors, setErrors] = useState([]);
  const [createError, setCreateError] = useState('');
  const [reading, setReading] = useState(false);
  const [readProgress, setReadProgress] = useState({ done: 0, total: 0 });
  const [receipt, setReceipt] = useState(null);
  const [previewId, setPreviewId] = useState(null);
  const fileInput = useRef(null);
  const requestToken = useRef('');
  const generationRef = useRef(0);
  const busyRef = useRef(false);
  const project = imageProjects.find(item => item.id === projectId);
  const spec = project?.specSnapshot;
  const validSpec = Boolean(spec?.versionId && spec.labels?.length && spec.labels.every(label => label.name?.trim()));
  const selectedBytes = Object.values(fileBytes).reduce((sum, bytes) => sum + bytes, 0);
  const preview = records.find(record => record.id === previewId);

  useEffect(() => {
    const matching = requestedProjectId ? imageProjects.find(item => item.id === requestedProjectId) : imageProjects[0];
    const token = `${requestedProjectId || 'default'}|${matching?.id || 'missing'}`;
    if (requestToken.current === token) return;
    requestToken.current = token;
    setProjectId(matching?.id || '');
    if (matching) setName(`${matching.name} · 图片批次`.slice(0, 60));
    setReceipt(null); setCreateError('');
  }, [requestedProjectId, projects]);

  useEffect(() => () => { generationRef.current += 1; }, []);
  useEffect(() => { if (!active) setPreviewId(null); }, [active]);

  const selectBuiltIn = () => {
    if (busyRef.current) return;
    generationRef.current += 1;
    setReceipt(null); setErrors([]); setCreateError(''); setPreviewId(null); setFileBytes({});
    try { setRecords(createDemoImageRecords()); }
    catch (error) { setRecords([]); setErrors([actionError(error)]); }
  };

  const chooseFiles = async event => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length || busyRef.current) return;
    const generation = ++generationRef.current;
    busyRef.current = true;
    setReading(true); setReceipt(null); setPreviewId(null); setRecords([]); setFileBytes({}); setErrors([]); setCreateError('');
    setReadProgress({ done: 0, total: files.length });
    const validationErrors = [];
    if (files.length > MAX_FILES) validationErrors.push(`选择了 ${files.length} 张图片；每批最多 ${MAX_FILES} 张，请减少后重新选择。`);
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) validationErrors.push('文件总量超过 20 MiB，请分成多个批次。');
    const names = new Set();
    files.forEach(file => {
      if (!/\.(png|jpe?g|webp)$/i.test(file.name)) validationErrors.push(`${file.name}：只支持 .png、.jpg、.jpeg、.webp 文件。`);
      if (!file.size) validationErrors.push(`${file.name}：文件为空。`);
      if (file.size > MAX_FILE_BYTES) validationErrors.push(`${file.name}：单张文件超过 5 MiB。`);
      const key = file.name.toLocaleLowerCase();
      if (names.has(key)) validationErrors.push(`${file.name}：同批文件名重复，请重命名后重新选择。`);
      names.add(key);
    });
    try {
      if (validationErrors.length) { setErrors(validationErrors); return; }
      const imported = [];
      const bytes = {};
      const decodeErrors = [];
      for (let index = 0; index < files.length; index += 1) {
        if (generation !== generationRef.current) return;
        try {
          const record = await readLocalImage(files[index], index, `${Date.now().toString(36)}-${generation}`);
          imported.push(record); bytes[record.id] = files[index].size;
        } catch (error) { decodeErrors.push(actionError(error)); }
        if (generation === generationRef.current) setReadProgress({ done: index + 1, total: files.length });
      }
      if (generation !== generationRef.current) return;
      if (decodeErrors.length) { setErrors(decodeErrors); return; }
      setRecords(imported); setFileBytes(bytes);
    } finally {
      busyRef.current = false;
      if (generation === generationRef.current) setReading(false);
    }
  };

  const create = () => {
    if (reading || receipt || !project || !validSpec || !name.trim() || !records.length || errors.length) return;
    setCreateError('');
    try {
      const datasetId = onCreateImageDataset?.({ name: name.trim(), projectId: project.id, projectName: project.name, specSnapshot: spec, records });
      if (!datasetId) { setCreateError('图片批次未创建，请检查任务规范与图片后重试。'); return; }
      setReceipt({ datasetId, name: name.trim(), count: records.length, projectId: project.id, projectName: project.name });
      onToast?.(`已接入 ${records.length} 张图片，创建独立图片批次。`);
    } catch (error) { setCreateError(actionError(error)); }
  };

  const resetSelection = () => {
    generationRef.current += 1;
    setRecords([]); setFileBytes({}); setReceipt(null); setErrors([]); setCreateError(''); setPreviewId(null);
  };

  return <div className="ip-ingestion">
    <PageHeader title="图片接入" description="读取原图，固定作业规范，进入同一批次的标注与审核。" eyebrow="数据生产中心"><Badge tone="blue">本地交互原型</Badge></PageHeader>
    <StepBar steps={IMAGE_STAGES} current={0}/>
    {receipt && <div className="ip-ingestion-receipt" role="status"><IconCircleCheck size={28}/><div><h3>{receipt.count} 张图片已接入</h3><p>{receipt.name} · {receipt.projectName}<span>{receipt.datasetId}</span></p></div><div className="ip-actions"><Button onClick={() => onNavigate('datasets', { datasetId: receipt.datasetId, tab: 'overview' })}>查看数据集</Button><Button variant="primary" onClick={() => onNavigate('review', { datasetId: receipt.datasetId })}>进入本批次标注<IconArrowRight size={16}/></Button><Button variant="ghost" onClick={resetSelection}>接入下一批</Button></div></div>}
    <div className="ip-ingestion-grid">
      <div className="ip-stack">
        <Panel title="1. 关联任务与规范" description="新批次使用所选任务创建时冻结的规范与标签。">
          <div className="ip-panel-body">
            <div className="ip-form-grid"><Field label="图片任务" required><select value={projectId} disabled={reading || Boolean(receipt)} onChange={event => { setProjectId(event.target.value); setReceipt(null); setCreateError(''); }}><option value="">请选择图片任务</option>{imageProjects.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></Field><Field label="数据集名称" required><input value={name} maxLength={60} placeholder="例如：产线 A 表面缺陷 · 第 2 批" disabled={reading || Boolean(receipt)} onChange={event => { setName(event.target.value); setCreateError(''); }}/></Field></div>
            {project && validSpec ? <div className="ip-frozen-spec"><div><IconLock size={16}/><strong>{spec.name}</strong><span>{spec.version || spec.versionId}</span></div><FrozenLabels spec={spec}/><p>{spec.guide}</p><small>冻结规范 ID：{spec.versionId}</small></div> : <Notice tone="warning" title={project ? '当前任务缺少有效的冻结规范' : '请选择图片任务'}><p>{project ? '请在任务建模中配置规范和标签后，创建可用于图片标注的任务。' : imageProjects.length ? '图片批次需要关联明确的图像任务，才能固定标签与审核依据。' : '还没有图片任务，请先在任务建模中心创建图像目标检测任务。'}</p><Button variant="ghost" onClick={() => onNavigate('projects')}>前往任务建模<IconArrowRight size={15}/></Button></Notice>}
          </div>
        </Panel>
        <Panel title="2. 选择图片来源" description="本次选择会替换尚未接入的图片；不会覆盖已创建的数据集。" actions={records.length ? <Badge tone="blue">{records.length} 张已就绪</Badge> : null}>
          <div className="ip-panel-body">
            <input ref={fileInput} type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" multiple onChange={chooseFiles} className="ip-file-input" aria-label="选择本地图片文件" disabled={reading || Boolean(receipt)}/>
            <div className="ip-source-choices"><button className="ip-source-choice" onClick={selectBuiltIn} disabled={reading || Boolean(receipt)}><span className="ip-source-icon"><IconPhoto size={25}/></span><strong>使用 3 张内置示意图</strong><p>划痕、凹陷、正常零件<br/>1024 × 640 px · 无预置标注</p><span className="ip-source-link">载入示例<IconArrowRight size={15}/></span></button><button className="ip-source-choice" onClick={() => fileInput.current?.click()} disabled={reading || Boolean(receipt)}><span className="ip-source-icon ip-source-blue"><IconUpload size={25}/></span><strong>选择本地图片</strong><p>PNG / JPEG / WebP<br/>读取原始内容并校验图片尺寸</p><span className="ip-source-link">{records.some(record => record.source === 'upload') ? '重新选择图片' : '浏览本地文件'}<IconArrowRight size={15}/></span></button></div>
            <p className="ip-help">每批最多 12 张，单张 ≤ 5 MiB，总量 ≤ 20 MiB；长边 ≤ 8192 px，总像素 ≤ 2400 万。图片仅留在当前浏览器会话，不会发送到服务器。</p>
            {reading && <div className="ip-reading" role="status"><div><span>正在读取与解码图片…</span><strong>{readProgress.done} / {readProgress.total}</strong></div><progress value={readProgress.done} max={readProgress.total || 1}/></div>}
            {!!errors.length && <Notice tone="error" title="本次操作未完成"><p>以下问题需要处理。本次文件选择中有无效图片时，整批均不会接入。</p><ul>{errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul></Notice>}
            {records.length > 0 && <><div className="ip-section-heading"><h3>接入预览 <span>{records.length} 张</span></h3><span>{selectedBytes ? `${(selectedBytes / 1024 / 1024).toFixed(2)} MiB` : '内置示意图'}{!receipt && <Button variant="ghost" icon={IconTrash} onClick={resetSelection} disabled={reading}>清空选择</Button>}</span></div><div className="ip-import-thumbnails">{records.map(record => <article className="ip-import-card" key={record.id}><button className="ip-thumbnail-button" onClick={() => setPreviewId(record.id)} aria-label={`预览 ${record.name}`}><ReadOnlyImage record={record} spec={spec} compact/><span className="ip-preview-overlay"><IconEye size={17}/>预览原图</span></button><div><strong title={record.name}>{record.name}</strong><small>{record.width} × {record.height} px</small><span>{record.source === 'built-in' ? '内置示意图' : '本地图片'}{fileBytes[record.id] ? ` · ${(fileBytes[record.id] / 1024).toFixed(0)} KiB` : ''}</span></div></article>)}</div></>}
          </div>
        </Panel>
      </div>
      <aside className="ip-stack"><Panel title="接入确认"><div className="ip-panel-body ip-import-summary"><span className="ip-summary-icon"><IconPhoto size={30} stroke={1.4}/></span><h3>准备 {records.length} 张原图</h3><p>接入后先分配标注员，再逐张画框、分类或确认无缺陷。</p><dl className="ip-key-values"><div><dt>任务</dt><dd>{project?.name || '未选择'}</dd></div><div><dt>图片来源</dt><dd>{records.length ? records[0].source === 'built-in' ? '本地内置示意图' : '本地文件' : '尚未选择'}</dd></div><div><dt>初始状态</dt><dd>待标注 · 未分配</dd></div><div><dt>冻结规范</dt><dd>{validSpec ? spec.version || spec.versionId : '未就绪'}</dd></div></dl>{createError && <Notice tone="error"><p>{createError}</p></Notice>}<Button variant="primary" icon={IconArrowRight} disabled={reading || Boolean(receipt) || !project || !validSpec || !name.trim() || !records.length || Boolean(errors.length)} loading={reading} onClick={create}>{receipt ? '本批次已接入' : '创建图片批次'}</Button></div></Panel><Notice title="会话内完整流程"><p>图片内容与标注状态保存在当前前端会话。刷新会恢复初始演示数据；发布后可下载含原图的完整快照 JSON 留存。</p></Notice></aside>
    </div>
    {active && preview && <Modal title="接入图片预览" description={`${preview.name} · 原始图片`} wide onClose={() => setPreviewId(null)} footer={<Button variant="primary" onClick={() => setPreviewId(null)}>关闭预览</Button>}><ReadOnlyImage record={preview} spec={spec}/><div className="ip-image-caption"><span>{preview.width} × {preview.height} px</span><span>{preview.source === 'built-in' ? '内置示意图' : '本地导入'} · {preview.mimeType}</span></div></Modal>}
  </div>;
}

export function ImageDatasetDetails({ batch, tab, onImageAction, onNavigate, onToast, datasetRequest, active = true }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [recordPreviewId, setRecordPreviewId] = useState(null);
  const [versionPreview, setVersionPreview] = useState(null);
  const [requestError, setRequestError] = useState('');
  const consumedRequest = useRef('');
  const counts = imageBatchCounts(batch);
  const versions = batch.versions || [];
  const records = batch.records || [];
  const selectedRecord = records.find(record => record.id === recordPreviewId);
  const filtered = records.filter(record => (filter === 'all' || record.status === filter) && `${record.id} ${record.name} ${(record.boxes || []).map(box => box.label).join(' ')}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  useEffect(() => { setSearch(''); setFilter('all'); setRecordPreviewId(null); setVersionPreview(null); setRequestError(''); }, [batch.datasetId]);
  useEffect(() => { if (!active) { setRecordPreviewId(null); setVersionPreview(null); } }, [active]);
  useEffect(() => {
    if (!active || !datasetRequest?.versionId || (datasetRequest.datasetId && datasetRequest.datasetId !== batch.datasetId)) return;
    const key = `${batch.datasetId}|${datasetRequest.versionId}|${datasetRequest.key || ''}`;
    if (consumedRequest.current === key) return;
    consumedRequest.current = key;
    const version = versions.find(item => item.id === datasetRequest.versionId);
    setRecordPreviewId(null);
    if (version) { setVersionPreview(version); setRequestError(''); }
    else { setVersionPreview(null); setRequestError(`请求的图片版本 ${datasetRequest.versionId} 不存在于当前数据集。请核对来源版本 ID；未切换到其他版本。`); }
  }, [active, batch.datasetId, datasetRequest?.versionId, datasetRequest?.datasetId, datasetRequest?.key, versions]);

  const openVersion = version => { setRequestError(''); setVersionPreview(version); };
  return <div className="ip-dataset-details">
    {requestError && <Notice tone="error" title="无法打开指定版本"><p>{requestError}</p></Notice>}
    {tab === 'overview' && <>
      <div className="ip-overview-intro"><div><Badge tone="blue">图片目标检测</Badge><p>原图、目标框与审核状态保留在同一个工作批次中。</p></div><Badge tone="gray">R{batch.revision}</Badge></div>
      <div className="ip-stat-grid"><div><span>实际图片</span><strong>{formatNumber(counts.total)}<small>张</small></strong></div><div><span>标注框</span><strong>{formatNumber(counts.boxes)}<small>个</small></strong></div><div><span>审核通过</span><strong>{formatNumber(counts.approved)}<small>张</small></strong></div><div><span>发布版本</span><strong>{versions.length}<small>个</small></strong></div></div>
      <ImageIdentity batch={batch}/>
      <div className="ip-section"><div className="ip-section-heading"><h3>当前生产状态</h3><span>{counts.unassigned} 张未分配</span></div><div className="ip-status-grid">{Object.entries(STATUS_LABELS).map(([status, label]) => <div key={status}><Badge tone={STATUS_TONES[status]}>{label}</Badge><strong>{counts[status]}<small>张</small></strong></div>)}</div><div className="ip-actions"><Button variant="primary" onClick={() => onNavigate('review', { datasetId: batch.datasetId })}>进入本批次标注与审核<IconArrowRight size={16}/></Button><Button icon={IconShieldCheck} onClick={() => onNavigate('quality', { datasetId: batch.datasetId })}>检查本批次质量</Button></div></div>
      <div className="ip-section"><div className="ip-section-heading"><h3>冻结作业规范</h3><span><IconLock size={14}/> {batch.specSnapshot?.version}</span></div><FrozenLabels spec={batch.specSnapshot}/><dl className="ip-spec-details"><div><dt>标注指南</dt><dd>{batch.specSnapshot?.guide || '按冻结标签逐一框选可见缺陷区域。'}</dd></div><div><dt>审核说明</dt><dd>{batch.specSnapshot?.review || '提交后经人工审核，通过的记录方可进入发布范围。'}</dd></div><div><dt>严重程度</dt><dd>轻微 / 一般 / 严重</dd></div><div><dt>坐标约定</dt><dd>原图像素坐标；左上角为原点，框包含 X、Y、宽、高。</dd></div></dl></div>
      <Notice title="来源与范围"><p>共 {records.filter(record => record.source === 'upload').length} 张本地导入、{records.filter(record => record.source === 'built-in').length} 张内置示意图；当前已有 {normalCount(records)} 张明确标记为无缺陷。版本发布仅冻结审核通过的图片，其余记录继续留在工作批次。</p></Notice>
    </>}
    {tab === 'preview' && <>
      <div className="ip-section-heading"><div><h3>图片与标注预览</h3><p>当前工作批次 · {records.length} 张图片 · {boxCount(records)} 个框</p></div><Button variant="outline" onClick={() => onNavigate('review', { datasetId: batch.datasetId })}>进入作业区<IconArrowRight size={16}/></Button></div>
      <div className="ip-preview-filters"><Search value={search} onChange={setSearch} placeholder="搜索文件名、图片 ID 或缺陷类别"/><select aria-label="按图片状态筛选" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部状态（{counts.total}）</option>{Object.entries(STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{label}（{counts[status]}）</option>)}</select></div>
      {filtered.length ? <div className="ip-dataset-thumbnails">{filtered.map(record => <article className="ip-dataset-card" key={record.id}><button className="ip-thumbnail-button" onClick={() => setRecordPreviewId(record.id)} aria-label={`查看图片 ${record.name} 的标注`}><ReadOnlyImage record={record} spec={batch.specSnapshot} compact/><span className="ip-preview-overlay"><IconEye size={17}/>查看原图与框</span></button><div className="ip-dataset-card-body"><div><strong title={record.name}>{record.name}</strong><Badge tone={STATUS_TONES[record.status]}>{STATUS_LABELS[record.status]}</Badge></div><small>{record.width} × {record.height} px · {record.boxes?.length || 0} 个框</small><p>{record.source === 'built-in' ? '内置示意图' : '本地图片'} · {record.assignee || '未分配'}</p></div></article>)}</div> : <Empty title="当前筛选下没有图片" description="调整状态或搜索条件，查看本批次其他图片。"><Button onClick={() => { setFilter('all'); setSearch(''); }}>清除筛选</Button></Empty>}
    </>}
    {tab === 'versions' && <>
      <div className="ip-section-heading"><div><h3>已发布图片版本 <span>{versions.length}</span></h3><p>每个版本固定原图、框、标签、来源与发布时的修订号。</p></div><Button variant="primary" onClick={() => onNavigate('quality', { datasetId: batch.datasetId })}>质量检查与发布<IconArrowRight size={16}/></Button></div>
      {versions.length ? <div className="ip-version-list">{versions.map(version => <article className="ip-version-card" key={version.id}><div className="ip-version-card-header"><div><strong>{version.version}</strong><Badge><IconLock size={12}/>已冻结</Badge><span>R{version.sourceRevision}</span></div><Button variant="outline" icon={IconEye} onClick={() => openVersion(version)}>预览此版本</Button></div><div className="ip-version-counts"><span><b>{version.records?.length || 0}</b> 张图片</span><span><b>{boxCount(version.records)}</b> 个框</span><span><b>{normalCount(version.records)}</b> 张无缺陷</span></div><p>{version.note}</p><small>{version.id}</small><div className="ip-version-card-footer"><span><IconClock size={14}/>{formatTime(version.date)} · {version.owner || '当前演示用户'}</span><Button variant="ghost" icon={IconDownload} onClick={() => exportSnapshot(batch, version, 'full', onToast)}>完整快照 JSON</Button></div></article>)}</div> : <Empty title="还没有发布图片版本" description="完成图片标注与人工审核，再对已通过记录执行质量检查。"><Button onClick={() => onNavigate('review', { datasetId: batch.datasetId })}>继续本批次作业</Button></Empty>}
      <Notice title="保存独立图片快照"><p>完整 JSON 包含原图与标注，COCO 标注可在版本预览中导出。本原型的图片数据支持生产与交付；图像模型训练尚未接入。</p></Notice>
    </>}
    {active && selectedRecord && <Modal title="工作批次图片详情" description={`${batch.name} · ${batch.batchId} · R${batch.revision}`} wide onClose={() => setRecordPreviewId(null)} footer={<><Button onClick={() => setRecordPreviewId(null)}>关闭</Button><Button variant="primary" onClick={() => { setRecordPreviewId(null); onNavigate('review', { datasetId: batch.datasetId }); }}>进入本批次作业区<IconArrowRight size={16}/></Button></>}><ImageRecordDetails record={selectedRecord} spec={batch.specSnapshot}/></Modal>}
    {active && versionPreview && versionPreview.datasetId === batch.datasetId && <ImageVersionPreview batch={batch} version={versionPreview} onClose={() => setVersionPreview(null)} onToast={onToast}/>}
  </div>;
}

const PENDING_QUALITY_RULES = [
  { name: '图片来源与尺寸', detail: '逐张检查内嵌原图、文件类型与原始尺寸。' },
  { name: '标注框几何', detail: '坐标为原图像素，框面积有效且未超出图片边界。' },
  { name: '标签与严重程度', detail: '类别来自冻结规范，严重程度已填写。' },
  { name: '审核与无缺陷声明', detail: '只纳入审核通过记录，无框图片须明确声明无缺陷。' },
  { name: '来源与记录完整性', detail: '保留图片 ID、任务、数据集、批次及固定规范。' },
];

export function ImageQualityView({ batch, onImageAction, onNavigate, onToast, active = true }) {
  const [publishDraft, setPublishDraft] = useState(null);
  const [note, setNote] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [versionPreview, setVersionPreview] = useState(null);
  const counts = imageBatchCounts(batch);
  const quality = batch.quality;
  const qualityCurrent = Boolean(quality && quality.sourceRevision === batch.revision);
  const passed = qualityCurrent && quality.status === 'passed';
  const stale = Boolean(quality && !qualityCurrent);
  const approved = useMemo(() => batch.records.filter(record => record.status === 'approved'), [batch.records]);
  const approvedBoxes = boxCount(approved);
  const excluded = counts.total - counts.approved;
  const currentVersion = batch.versions?.find(version => version.sourceRevision === batch.revision);
  const visibleReceipt = receipt?.datasetId === batch.datasetId && receipt.sourceRevision === batch.revision ? receipt : null;
  const ready = passed && counts.approved > 0 && !currentVersion;
  const nextVersion = `v0.${(batch.versions?.length || 0) + 1}`;
  const rules = qualityCurrent ? quality.rules : PENDING_QUALITY_RULES;
  const publishDraftCurrent = publishDraft?.revision === batch.revision && publishDraft?.datasetId === batch.datasetId;

  useEffect(() => { setPublishDraft(null); setReceipt(null); setVersionPreview(null); setError(''); setNote(''); setConsent(false); }, [batch.datasetId]);
  useEffect(() => { if (!active) { setPublishDraft(null); setVersionPreview(null); } }, [active]);

  const check = () => {
    setError('');
    try {
      const result = onImageAction(batch.datasetId, { type: 'checkQuality' });
      if (!result?.ok) { setError(actionError(result?.error)); return; }
      const actualQuality = result.batch?.quality;
      onToast?.(actualQuality?.status === 'passed' ? `R${batch.revision} 的 ${approved.length} 张审核通过图片已完成质量检查。` : '质量检查未通过，请按规则结果修正本批次。', actualQuality?.status === 'passed' ? undefined : 'warning');
    } catch (failure) { setError(actionError(failure)); }
  };

  const openPublish = () => {
    if (!ready) return;
    setError(''); setNote(''); setConsent(false);
    setPublishDraft({ datasetId: batch.datasetId, revision: batch.revision, count: approved.length, boxCount: approvedBoxes, excluded, version: nextVersion });
  };

  const publish = () => {
    if (!ready || !publishDraftCurrent || !consent || !note.trim()) { setError('发布条件已变化，请重新确认当前修订、质量结果及发布范围。'); return; }
    try {
      const result = onImageAction(batch.datasetId, { type: 'publish', note: note.trim() });
      if (!result?.ok || !result.version) { setError(actionError(result?.error || '版本未生成，请检查发布条件。')); return; }
      setReceipt(result.version); setVersionPreview(result.version); setPublishDraft(null); setError('');
      onToast?.(`已发布图片版本 ${result.version.version}，冻结 ${result.version.records.length} 张图片与 ${boxCount(result.version.records)} 个框。`);
    } catch (failure) { setError(actionError(failure)); }
  };

  return <div className="ip-quality">
    <PageHeader title="图片质量检查" description={`${batch.name} · 从审核通过的实际图片生成独立发布版本。`} eyebrow="数据生产中心"><Button icon={IconArrowLeft} onClick={() => onNavigate('review', { datasetId: batch.datasetId })}>返回本批次审核</Button></PageHeader>
    <StepBar steps={IMAGE_STAGES} current={currentVersion ? 3 : 2}/>
    <ImageIdentity batch={batch}/>
    {error && !publishDraft && <Notice tone="error" title="操作未完成"><p>{error}</p></Notice>}
    {stale && <Notice tone="warning" title={`旧质检已失效：R${quality.sourceRevision} → R${batch.revision}`}><p>标注、分配或审核状态已变化。即使通过数量相同，也需要对当前修订重新检查。</p></Notice>}
    <div className="ip-quality-grid">
      <Panel title="本次检查范围" description={`工作批次 ${batch.batchId} · 当前修订 R${batch.revision}`} actions={<Badge tone={passed ? 'mint' : qualityCurrent && quality.status === 'failed' ? 'red' : 'amber'}>{passed ? '当前修订检查通过' : qualityCurrent && quality.status === 'failed' ? '检查未通过' : stale ? '需要重新检查' : '待检查'}</Badge>}>
        <div className="ip-panel-body">
          <div className="ip-quality-scope"><div><strong>{approved.length}<small>张</small></strong><span>已审核通过 · 可检查范围</span><b>{approvedBoxes} 个框 · {normalCount(approved)} 张无缺陷</b></div><div><span>本次暂不纳入</span><strong>{excluded}<small>张</small></strong><p>待标注 {counts.todo} · 待审核 {counts.review} · 返工 {counts.rework}</p></div></div>
          <Notice title={excluded ? '允许发布审核通过的部分范围' : '本批次图片已全部通过审核'}><p>{excluded ? `本次仅冻结 ${approved.length} 张已通过图片，另 ${excluded} 张继续留在工作批次，后续完成后可发布新版本。` : '质量检查与版本发布均依据当前工作批次的实际记录。历史版本保留原有图片和标注。'}</p></Notice>
          <div className="ip-section-heading"><h3>质量规则</h3><span>{qualityCurrent ? `检查于 ${formatTime(quality.checkedAt)}` : '逐条校验当前记录'}</span></div>
          <div className="ip-quality-rules">{rules.map((rule, index) => <div key={`${index}-${rule.name}`} className={qualityCurrent ? rule.passed ? 'passed' : 'failed' : ''}><span className="ip-rule-icon">{qualityCurrent ? rule.passed ? <IconCheck size={19}/> : <IconAlertTriangle size={19}/> : <IconShieldCheck size={19}/>}</span><div><h3>{rule.name}</h3><p>{rule.detail}</p></div><Badge tone={qualityCurrent ? rule.passed ? 'mint' : 'red' : 'gray'}>{qualityCurrent ? rule.passed ? '通过' : '未通过' : '待检查'}</Badge></div>)}</div>
          {!approved.length && <Notice tone="warning" title="尚无审核通过的图片"><p>先为图片分配标注员，完成画框或无缺陷确认并通过审核，再执行质量检查。</p><Button variant="ghost" onClick={() => onNavigate('review', { datasetId: batch.datasetId })}>进入本批次作业区<IconArrowRight size={15}/></Button></Notice>}
          <div className="ip-quality-actions"><p>检查源图片结构、标注规则及审核状态；不代表自动识别缺陷或人工判断的准确率评估。</p><Button variant={passed ? 'secondary' : 'primary'} icon={passed || stale ? IconRefresh : IconShieldCheck} disabled={!approved.length} onClick={check}>{qualityCurrent || stale ? '重新检查当前修订' : '运行图片质量检查'}</Button></div>
        </div>
      </Panel>
      <aside className="ip-stack"><Panel title="发布准备"><div className="ip-panel-body ip-publish-summary"><span className="ip-summary-icon"><IconLock size={30} stroke={1.4}/></span><h3>{currentVersion ? `当前修订已发布 ${currentVersion.version}` : ready ? '已具备发布条件' : '完成当前修订检查后发布'}</h3><p>冻结原图与框、标注属性、审核记录及任务规范，形成可导出的独立版本。</p><dl className="ip-key-values"><div><dt>数据类型</dt><dd>图片目标检测</dd></div><div><dt>规范版本</dt><dd>{batch.specSnapshot?.version || batch.taskSpecVersionId}</dd></div><div><dt>发布范围</dt><dd>{approved.length} 张图片 / {approvedBoxes} 个框</dd></div><div><dt>当前修订</dt><dd>R{batch.revision}</dd></div><div><dt>{currentVersion ? '已发布版本' : '下一版本'}</dt><dd>{currentVersion?.version || nextVersion}</dd></div></dl>{currentVersion ? <Button variant="primary" icon={IconEye} onClick={() => setVersionPreview(currentVersion)}>查看当前修订快照</Button> : <Button variant="primary" disabled={!ready} onClick={openPublish}>确认范围并发布<IconArrowRight size={16}/></Button>}<Button onClick={() => onNavigate('datasets', { datasetId: batch.datasetId, tab: 'versions' })}>查看全部历史版本</Button></div></Panel><Notice title="图片生产原型"><p>此处在当前会话创建数据快照。完整 JSON 可保留原图；COCO JSON 需配套原始图片。图片训练、评测与推理为本地模拟，未接入真实图像模型或后端存储。</p></Notice></aside>
    </div>
    {visibleReceipt && <div className="ip-publish-receipt" role="status"><IconCircleCheck size={28}/><div><h3>{visibleReceipt.version} 发布完成 · R{visibleReceipt.sourceRevision}</h3><p>已冻结 {visibleReceipt.records.length} 张图片与 {boxCount(visibleReceipt.records)} 个框。{excluded > 0 ? `剩余 ${excluded} 张继续留在工作批次。` : '本批次全部审核通过图片已进入此版本。'}</p></div><Button variant="outline" icon={IconDownload} onClick={() => exportSnapshot(batch, visibleReceipt, 'full', onToast)}>导出完整快照</Button></div>}
    {active && publishDraft && <Modal title={`发布图片数据版本 ${publishDraft.version}`} description={`来源：${batch.batchId} · 修订 R${publishDraft.revision}`} onClose={() => { setPublishDraft(null); setError(''); }} footer={<><Button onClick={() => { setPublishDraft(null); setError(''); }}>取消</Button><Button variant="primary" disabled={!ready || !publishDraftCurrent || !consent || !note.trim()} onClick={publish}>确认发布图片版本</Button></>}>
      <div className="ip-publish-dialog"><div className="ip-release-scope"><div><strong>{publishDraft.count}</strong><span>张审核通过图片</span></div><div><strong>{publishDraft.boxCount}</strong><span>个标注框</span></div><Badge tone={publishDraftCurrent && passed ? 'mint' : 'amber'}>{publishDraftCurrent && passed ? '当前修订质检通过' : '发布范围已变化'}</Badge></div>
        <Notice tone={publishDraft.excluded ? 'warning' : 'info'} title={publishDraft.excluded ? `还有 ${publishDraft.excluded} 张不在本次发布范围内` : '本批次审核通过图片全部纳入'}><p>{publishDraft.excluded ? '待标注、待审核和返工图片不会混入快照，将继续保留在工作批次；以后通过审核可发布新的独立版本。' : '发布后的快照保持独立，后续修改工作批次不会改写本版本。'}</p></Notice>
        {!publishDraftCurrent && <Notice tone="error" title="工作批次修订已变化"><p>请关闭此窗口，重新检查当前修订并确认发布范围。</p></Notice>}
        <Field label="发布说明" required hint="写明本次范围、验收用途或已知限制，随快照保存。"><textarea rows={3} maxLength={600} value={note} onChange={event => setNote(event.target.value)} placeholder="例如：产线 A 表面缺陷首批已完成人工审核，冻结划痕与凹陷目标框用于验收。"/></Field>
        <label className="ip-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/><span>我已确认 {publishDraft.count} 张图片、{publishDraft.boxCount} 个框、冻结规范及来源信息{publishDraft.excluded ? `，并知晓 ${publishDraft.excluded} 张未通过记录不在本次范围内` : ''}。</span></label>
        {error && <Notice tone="error"><p>{error}</p></Notice>}<p className="ip-help">这是当前浏览器会话内的版本发布，不会向外部服务器上传图片。</p>
      </div>
    </Modal>}
    {active && versionPreview && versionPreview.datasetId === batch.datasetId && <ImageVersionPreview batch={batch} version={versionPreview} onClose={() => setVersionPreview(null)} onToast={onToast}/>}
  </div>;
}
