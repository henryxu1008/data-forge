import React,{useEffect,useRef,useState} from 'react';
import {IconArrowLeft,IconArrowRight,IconCheck,IconChevronLeft,IconChevronRight,IconClipboardCheck,IconFocus2,IconHandMove,IconHistory,IconInfoCircle,IconPhoto,IconPlus,IconRefresh,IconShieldCheck,IconSquare,IconTrash,IconUser,IconUsers,IconZoomIn,IconZoomOut,IconArrowBackUp} from '@tabler/icons-react';
import {Badge,Button,Empty,Field,Modal,PageHeader,StepBar} from './ui.jsx';
import {imageBatchCounts,imageRecordIssues} from './image-production-state.js';
import './image-workspace-view.css';
import AIAnnotationProvenance from './AIAnnotationProvenance.jsx';

const statuses={todo:'待标注',review:'待审核',rework:'需返工',approved:'已通过'};
const tones={todo:'neutral',review:'amber',rework:'red',approved:'mint'};
const historyNames={assign:'分配标注人',saveDraft:'保存草稿',submit:'提交审核',reject:'退回修改',approve:'审核通过',reopen:'重新标注'};
const severities=['轻微','一般','严重'];
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const round=value=>Math.round(value*100)/100;
const copyAnnotation=record=>({boxes:(record.boxes||[]).map(box=>({...box})),noDefect:!!record.noDefect,note:record.note||''});
const annotationEqual=(a,b)=>JSON.stringify(copyAnnotation(a))===JSON.stringify(copyAnnotation(b));
const formatTime=value=>{if(!value)return '当前会话';const date=new Date(value);return Number.isNaN(date.getTime())?String(value):date.toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Singapore'})};
const labelItems=spec=>(spec?.labels||[]).map(label=>typeof label==='string'?{name:label,color:'#42d8c1'}:label);

function calculateGesture(gesture,point,width,height){
  const box=gesture.original;
  if(gesture.kind==='draw')return {...gesture.box,x:round(Math.min(gesture.start.x,point.x)),y:round(Math.min(gesture.start.y,point.y)),width:round(Math.abs(point.x-gesture.start.x)),height:round(Math.abs(point.y-gesture.start.y))};
  if(gesture.kind==='move')return {...box,x:round(clamp(box.x+point.x-gesture.start.x,0,width-box.width)),y:round(clamp(box.y+point.y-gesture.start.y,0,height-box.height))};
  const left=box.x,top=box.y,right=left+box.width,bottom=top+box.height;
  const x=gesture.corner.includes('w')?clamp(point.x,0,right-2):left;
  const y=gesture.corner.includes('n')?clamp(point.y,0,bottom-2):top;
  const r=gesture.corner.includes('e')?clamp(point.x,left+2,width):right;
  const b=gesture.corner.includes('s')?clamp(point.y,top+2,height):bottom;
  return {...box,x:round(x),y:round(y),width:round(r-x),height:round(b-y)};
}

export function RegionPreview({record,labels,selectedBoxId,workingBox,mode,editable,onSelect,onGestureStart,onGestureMove,onGestureEnd,onGestureCancel,svgRef,onImageError,onImageLoad,onCanvasKeyDown}){
  const width=Number(record.width)||1024,height=Number(record.height)||640;
  const boxes=(record.boxes||[]).map(box=>workingBox?.id===box.id?workingBox:box);
  if(workingBox&&!boxes.some(box=>box.id===workingBox.id))boxes.push(workingBox);
  const selected=boxes.find(box=>box.id===selectedBoxId);
  const handleSize=Math.max(9,width/70);
  return <svg ref={svgRef} className={'iw-svg '+(editable?'iw-tool-'+mode:'iw-readonly')} viewBox={'0 0 '+width+' '+height} role="img" aria-label={'图片标注画布：'+record.name+'；原图 '+width+' × '+height+' 像素'} tabIndex={0} onKeyDown={onCanvasKeyDown} onPointerDown={event=>onGestureStart(event,'draw')} onPointerMove={onGestureMove} onPointerUp={onGestureEnd} onPointerCancel={onGestureCancel} onLostPointerCapture={onGestureCancel}>
    <image href={record.src} x="0" y="0" width={width} height={height} preserveAspectRatio="none" onError={onImageError} onLoad={onImageLoad} pointerEvents="none"/>
    {boxes.map((box,index)=>{
      const color=labels.find(label=>label.name===box.label)?.color||'#f2b84c';
      const isSelected=box.id===selectedBoxId,isFlagged=record.status==='rework'&&(record.rejection?.boxIds||[]).includes(box.id);
      const caption=(index+1)+' · '+(box.label||'未选类别');
      return <g key={box.id} className={'iw-box '+(isSelected?'iw-box-selected':'')}>
        <rect x={box.x} y={box.y} width={Math.max(0,box.width)} height={Math.max(0,box.height)} fill={isSelected?color+'1a':color+'0a'} stroke={isFlagged?'#f26373':color} strokeWidth={isSelected?2.5:1.7} vectorEffect="non-scaling-stroke" strokeDasharray={isFlagged?'7 4':undefined} onPointerDown={event=>{
          if(editable&&mode==='draw')return;
          event.stopPropagation();onSelect(box.id);
          if(editable&&mode==='select')onGestureStart(event,'move',box);
        }}/>
        <g pointerEvents="none" transform={'translate('+box.x+','+Math.max(0,box.y-27)+')'}>
          <rect width={Math.max(96,caption.length*14+18)} height="25" rx="3" fill={isFlagged?'#ba4c5e':color}/>
          <text x="8" y="18" fontSize="14" fontWeight="600" fill="#102028">{caption}</text>
        </g>
      </g>;
    })}
    {editable&&mode==='select'&&selected&&[['nw',selected.x,selected.y],['ne',selected.x+selected.width,selected.y],['sw',selected.x,selected.y+selected.height],['se',selected.x+selected.width,selected.y+selected.height]].map(([corner,x,y])=><rect key={corner} className={'iw-resize iw-resize-'+corner} x={x-handleSize/2} y={y-handleSize/2} width={handleSize} height={handleSize} fill="#e6fffa" stroke="#1a796c" strokeWidth="1.5" vectorEffect="non-scaling-stroke" onPointerDown={event=>{event.stopPropagation();onGestureStart(event,'resize',selected,corner)}}/>)}
  </svg>;
}

export default function ImageWorkspaceView({batch,onImageAction,onNavigate,onToast,active=true}){
  const [filter,setFilter]=useState('all'),[selectedId,setSelectedId]=useState(batch.records[0]?.id||null);
  const [selectedBoxId,setSelectedBoxId]=useState(null),[mode,setMode]=useState('draw'),[zoom,setZoom]=useState(100);
  const [workingBox,setWorkingBox]=useState(null),[dialog,setDialog]=useState(null),[reason,setReason]=useState(''),[rejectedBoxIds,setRejectedBoxIds]=useState([]);
  const [assignee,setAssignee]=useState('李一'),[assignScope,setAssignScope]=useState('unassigned'),[error,setError]=useState(''),[saveStatus,setSaveStatus]=useState('');
  const [reviewNote,setReviewNote]=useState(''),[imageError,setImageError]=useState(false),[coordinates,setCoordinates]=useState({x:'',y:'',width:'',height:''});
  const [defaultLabel,setDefaultLabel]=useState(()=>labelItems(batch.specSnapshot)[0]?.name||''),[defaultSeverity,setDefaultSeverity]=useState('一般');
  const [undoCount,setUndoCount]=useState(0);
  const svgRef=useRef(null),gestureRef=useRef(null),undoRef=useRef({}),boxSequence=useRef(0),recordRef=useRef(null),reviewNotesRef=useRef({});
  const labels=labelItems(batch.specSnapshot),counts=imageBatchCounts(batch);
  const filtered=batch.records.filter(record=>filter==='all'||record.status===filter);
  const selected=filtered.find(record=>record.id===selectedId)||filtered[0]||null;
  recordRef.current=selected;
  const selectedBox=selected?.boxes?.find(box=>box.id===selectedBoxId)||null;
  const editable=!!selected&&['todo','rework'].includes(selected.status)&&!!selected.assignee&&!imageError;
  const coordinatePending=editable&&!!selectedBox&&['x','y','width','height'].some(key=>coordinates[key].trim()===''||Number(coordinates[key])!==selectedBox[key]);
  const selectedIndex=selected?filtered.findIndex(record=>record.id===selected.id):-1;
  const issues=selected?imageRecordIssues(selected,batch.specSnapshot):[];
  const canSubmit=editable&&!issues.length&&!coordinatePending;
  const pending=batch.records.filter(record=>['todo','rework'].includes(record.status));
  const scope={datasetId:batch.datasetId};

  useEffect(()=>{
    setFilter('all');setSelectedId(batch.records[0]?.id||null);setSelectedBoxId(null);setDialog(null);setError('');setWorkingBox(null);gestureRef.current=null;undoRef.current={};setUndoCount(0);setDefaultLabel(labelItems(batch.specSnapshot)[0]?.name||'');setDefaultSeverity('一般');setRejectedBoxIds([]);
  },[batch.datasetId]);
  useEffect(()=>{
    setSelectedBoxId(selected?.boxes?.[0]?.id||null);setMode(selected?.boxes?.length?'select':'draw');setZoom(100);setWorkingBox(null);gestureRef.current=null;setDialog(null);setReason('');setError('');setReviewNote(reviewNotesRef.current[batch.datasetId+':'+selected?.id]||'');setImageError(false);setSaveStatus('');setUndoCount(undoRef.current[selected?.id]?.length||0);
  },[batch.datasetId,selected?.id]);
  useEffect(()=>{
    setWorkingBox(null);gestureRef.current=null;setReviewNote(selected?.status==='review'?(reviewNotesRef.current[batch.datasetId+':'+selected?.id]||''):'');setError('');
    if(selected&&!['todo','rework'].includes(selected.status)){undoRef.current[selected.id]=[];setUndoCount(0)}
  },[batch.datasetId,selected?.status]);
  useEffect(()=>{
    setCoordinates(selectedBox?Object.fromEntries(['x','y','width','height'].map(key=>[key,String(selectedBox[key])])):{x:'',y:'',width:'',height:''});
  },[batch.datasetId,selected?.id,selectedBox?.id,selectedBox?.x,selectedBox?.y,selectedBox?.width,selectedBox?.height]);
  useEffect(()=>{if(!active){setDialog(null);gestureRef.current=null;setWorkingBox(null)}},[active]);

  const showError=message=>{setError(message||'当前操作没有保存，请检查图片和标注内容。');setSaveStatus('未保存')};
  const commit=(patch,{remember=true,notify=false}={})=>{
    const record=recordRef.current;
    if(!record||!['todo','rework'].includes(record.status)||!record.assignee){showError('请先分配标注人；只有待标注和返工图片可以修改。');return false}
    const annotation={...copyAnnotation(record),...patch};
    if(annotationEqual(record,annotation)){setError('');setSaveStatus('草稿已保存');if(notify)onToast?.('图片标注草稿已保存');return true}
    const result=onImageAction(batch.datasetId,{type:'saveDraft',recordId:record.id,...annotation});
    if(!result?.ok){showError(result?.error);return false}
    if(remember){const stack=undoRef.current[record.id]||[];undoRef.current[record.id]=[...stack,copyAnnotation(record)].slice(-20);setUndoCount(undoRef.current[record.id].length)}
    recordRef.current=result.record||result.batch?.records?.find(item=>item.id===record.id)||{...record,...annotation};
    setError('');setSaveStatus('草稿已保存');if(notify)onToast?.('图片标注草稿已保存');
    return true;
  };
  const patchBox=patch=>{
    const record=recordRef.current;
    if(!record||!selectedBoxId)return false;
    return commit({boxes:record.boxes.map(box=>box.id===selectedBoxId?{...box,...patch}:box)});
  };
  const undo=()=>{
    const record=recordRef.current,stack=undoRef.current[record?.id]||[];
    if(!editable||!stack.length)return;
    const previous=stack[stack.length-1];
    if(commit({...previous,note:record.note},{remember:false})){undoRef.current[record.id]=stack.slice(0,-1);setUndoCount(stack.length-1);setSelectedBoxId(previous.boxes.at(-1)?.id||null)}
  };
  const removeBox=()=>{
    if(!editable||!selectedBox)return;
    const next=selected.boxes.filter(box=>box.id!==selectedBox.id);
    if(commit({boxes:next}))setSelectedBoxId(next[0]?.id||null);
  };
  const canvasPoint=event=>{
    const svg=svgRef.current,ctm=svg?.getScreenCTM();
    if(!svg||!ctm||!selected)return null;
    const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
    const local=point.matrixTransform(ctm.inverse());
    return {x:clamp(local.x,0,selected.width),y:clamp(local.y,0,selected.height)};
  };
  const startGesture=(event,kind,box,corner)=>{
    if(!editable||event.button!==0||(kind==='draw'&&mode!=='draw'))return;
    if(coordinatePending&&!saveCoordinates())return;
    const point=canvasPoint(event);if(!point)return;
    event.preventDefault();
    if(kind==='draw'){
      const id=selected.id+'-BOX-'+Date.now().toString(36)+'-'+(++boxSequence.current);
      const next={id,x:point.x,y:point.y,width:0,height:0,label:defaultLabel,severity:defaultSeverity};
      gestureRef.current={kind,pointerId:event.pointerId,start:point,box:next,recordId:selected.id};setSelectedBoxId(id);setWorkingBox(next);
    }else{gestureRef.current={kind,pointerId:event.pointerId,start:point,original:{...box},corner,recordId:selected.id};setWorkingBox({...box});setSelectedBoxId(box.id)}
    try{svgRef.current.setPointerCapture(event.pointerId)}catch{}
  };
  const moveGesture=event=>{
    const gesture=gestureRef.current;if(!gesture||gesture.pointerId!==event.pointerId)return;
    const point=canvasPoint(event);if(!point)return;
    setWorkingBox(calculateGesture(gesture,point,selected.width,selected.height));
  };
  const cancelGesture=()=>{
    if(!gestureRef.current)return;
    gestureRef.current=null;setWorkingBox(null);
  };
  const finishGesture=event=>{
    const gesture=gestureRef.current;if(!gesture||gesture.pointerId!==event.pointerId)return;
    const point=canvasPoint(event);
    gestureRef.current=null;setWorkingBox(null);
    try{svgRef.current.releasePointerCapture(event.pointerId)}catch{}
    if(!point||!editable||gesture.recordId!==selected.id)return;
    const box=calculateGesture(gesture,point,selected.width,selected.height);
    if(box.width<2||box.height<2){setSelectedBoxId(selected.boxes[0]?.id||null);setError('标注框宽和高至少为 2 像素，请拖出一个完整区域。');return}
    const next=gesture.kind==='draw'?[...selected.boxes,box]:selected.boxes.map(item=>item.id===box.id?box:item);
    if(commit({boxes:next,noDefect:false})){setSelectedBoxId(box.id);setMode('select')}
  };
  const coordinateValues=draft=>Object.fromEntries(Object.entries(draft).map(([key,value])=>[key,value.trim()===''?NaN:round(Number(value))]));
  const coordinatesValid=values=>Object.values(values).every(Number.isFinite)&&values.x>=0&&values.y>=0&&values.width>=2&&values.height>=2&&values.x+values.width<=selected.width&&values.y+values.height<=selected.height;
  const saveCoordinates=()=>{
    if(!editable||!selectedBox)return true;
    const values=coordinateValues(coordinates);
    if(Object.values(values).some(value=>!Number.isFinite(value))){setError('请补全数字坐标，或还原已保存坐标，再切换图片。空值不会覆盖已保存的框。');return false}
    if(!coordinatesValid(values)){setError('坐标必须位于原图内，宽高至少 2 像素。请修正或还原坐标后继续。');return false}
    return patchBox(values);
  };
  const changeCoordinate=(key,value)=>{
    const next={...coordinates,[key]:value};setCoordinates(next);
    const values=coordinateValues(next);
    if(coordinatesValid(values))patchBox(values);
    else setSaveStatus('坐标尚未应用');
  };
  const restoreCoordinates=()=>{setCoordinates(Object.fromEntries(['x','y','width','height'].map(key=>[key,String(selectedBox[key])])));setError('');setSaveStatus('已还原保存的坐标')};
  const chooseBox=id=>{if(coordinatePending&&!saveCoordinates())return false;setSelectedBoxId(id);return true};
  const changeFilter=value=>{if(coordinatePending&&!saveCoordinates())return;cancelGesture();setFilter(value)};
  const navigate=(view,request)=>{if(coordinatePending&&!saveCoordinates())return;onNavigate(view,request)};
  const addNumericBox=()=>{
    if(!editable)return;
    if(coordinatePending&&!saveCoordinates())return;
    const box={id:selected.id+'-BOX-'+Date.now().toString(36)+'-'+(++boxSequence.current),x:round(selected.width*.35),y:round(selected.height*.35),width:round(selected.width*.3),height:round(selected.height*.3),label:defaultLabel,severity:defaultSeverity};
    if(commit({boxes:[...selected.boxes,box],noDefect:false})){setSelectedBoxId(box.id);setMode('select')}
  };
  const canvasKeyDown=event=>{
    if(event.key==='Escape'){cancelGesture();return}
    if(!editable)return;
    if(event.key.toLowerCase()==='r'){event.preventDefault();setMode('draw')}
    if(event.key.toLowerCase()==='v'){event.preventDefault();setMode('select')}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();undo();return}
    if((event.key==='Delete'||event.key==='Backspace')&&selectedBox){event.preventDefault();removeBox();return}
    if(selectedBox&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
      event.preventDefault();const step=event.shiftKey?10:1;
      patchBox({x:clamp(selectedBox.x+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),0,selected.width-selectedBox.width),y:clamp(selectedBox.y+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0),0,selected.height-selectedBox.height)});
    }
  };
  const changeTask=id=>{if(coordinatePending&&!saveCoordinates())return;cancelGesture();setSelectedId(id)};
  const act=(type,extra={})=>{
    if(coordinatePending&&!saveCoordinates())return;
    const record=recordRef.current;if(!record)return;
    const result=onImageAction(batch.datasetId,{type,recordId:record.id,...(type==='submit'?copyAnnotation(record):{}),...extra});
    if(!result?.ok){showError(result?.error);return}
    setDialog(null);setReason('');setError('');setReviewNote('');setSaveStatus('');delete reviewNotesRef.current[batch.datasetId+':'+record.id];
    undoRef.current[record.id]=[];setUndoCount(0);
    const nextRecords=result.batch?.records||batch.records;
    if(type==='submit'){
      if(record.status==='rework'){setFilter('review');setSelectedId(record.id)}
      else{const next=nextRecords.find(item=>item.id!==record.id&&item.status==='todo');setFilter(next?'todo':'review');setSelectedId(next?.id||record.id)}
    }
    if(type==='approve'){const next=nextRecords.find(item=>item.id!==record.id&&item.status==='review');setFilter(next?'review':'all');setSelectedId(next?.id||record.id)}
    if(type==='reject'){setFilter('rework');setSelectedId(record.id)}
    if(type==='reopen'){setFilter('todo');setSelectedId(record.id)}
    onToast?.({submit:record.status==='rework'?'返工结果已重新提交审核':'图片标注已提交审核',approve:'图片审核通过，标注已锁定',reject:'图片已退回，保留关联框与审核意见',reopen:'已返回待标注；历史发布版本保持不变'}[type]||'操作已完成');
  };
  const assign=()=>{
    const recordIds=assignScope==='selected'&&selected?[selected.id]:pending.filter(record=>assignScope!=='unassigned'||!record.assignee).map(record=>record.id);
    const result=onImageAction(batch.datasetId,{type:'assign',recordIds,assignee});
    if(!result?.ok){setError(result?.error||'分配失败，请重新选择范围。');return}
    setDialog(null);setError('');onToast?.('已将 '+recordIds.length+' 张图片分配给 '+assignee);
  };

  return <div className="iw-workspace">
    <PageHeader title="图片标注与审核" description={batch.name}>
      <Button icon={IconArrowLeft} onClick={()=>navigate('datasets',{...scope,tab:'overview'})}>返回本数据集</Button>
      <Button variant="primary" icon={IconShieldCheck} disabled={!counts.approved} onClick={()=>navigate('quality',scope)}>质量检查与发布</Button>
    </PageHeader>
    <StepBar steps={['图片接入','标注与审核','质量检查','版本发布']} current={1}/>
    <div className="iw-identity"><div><span>来源项目</span><strong>{batch.projectName}</strong><small>{batch.projectId}</small></div><div><span>当前工作批次</span><strong>{batch.batchId}</strong><small>{counts.total} 张实际图片 · {counts.boxes} 个标注框</small></div><div><span>冻结标注规范</span><strong>{batch.specSnapshot?.name||'图像目标检测'}</strong><small>{batch.specSnapshot?.version||batch.taskSpecVersionId}</small></div><button className="text-button" onClick={()=>setDialog('guide')}>查看规范 <IconChevronRight size={15}/></button></div>
    <div className="iw-stats">{[['todo','待标注'],['review','待审核'],['rework','需返工'],['approved','已通过']].map(([id,label])=><button key={id} className={filter===id?'selected':''} onClick={()=>changeFilter(id)}><span>{label}</span><strong>{counts[id]}</strong></button>)}<div className="iw-assignment"><div><IconUser size={17}/><span>{counts.unassigned?counts.unassigned+' 张待分配':'当前标注人已分配'}</span></div><Button icon={IconUsers} disabled={!pending.length} onClick={()=>{setAssignScope(counts.unassigned?'unassigned':'pending');setError('');setDialog('assign')}}>分配标注任务</Button></div></div>
    <div className="iw-main-grid">
      <aside className="panel iw-queue" aria-label="本批次图片队列">
        <div className="iw-queue-heading"><h3>图片队列</h3><span>{filtered.length} / {counts.total}</span></div>
        <label className="iw-filter"><span className="iw-sr-only">按图片状态筛选</span><select aria-label="按图片状态筛选" value={filter} onChange={event=>changeFilter(event.target.value)}><option value="all">全部图片</option>{Object.entries(statuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <div className="iw-queue-items">{filtered.length?filtered.map((record,index)=><button className={'iw-image-card '+(record.id===selected?.id?'selected':'')} key={record.id} onClick={()=>changeTask(record.id)} aria-label={'查看图片 '+record.name+' '+statuses[record.status]}>
          <div className="iw-thumbnail"><img src={record.src} alt="" draggable={false}/><span>{String(index+1).padStart(2,'0')}</span>{record.noDefect&&<em>无缺陷</em>}</div>
          <div className="iw-card-caption"><strong title={record.name}>{record.name}</strong><Badge tone={tones[record.status]}>{statuses[record.status]}</Badge></div>
          <small>{record.assignee||'待分配'} · {record.boxes?.length||0} 个框</small>
        </button>):<Empty title="队列为空" description="切换状态可查看本批次其他图片。"/>}</div>
      </aside>
      {selected?<><section className="panel iw-canvas-panel">
        <div className="iw-canvas-heading"><div><span>图片 {selectedIndex+1} / {filtered.length}</span><h2>{selected.name}</h2><p>{selected.width} × {selected.height} px · {selected.source==='built-in'?'内置合成示意图':'本地导入图片'} · {selected.id}</p></div><Badge tone={tones[selected.status]}>{statuses[selected.status]}</Badge></div>
        <div className="iw-tools"><div className="iw-tool-group">
          <button title="画框（R）" aria-label="画框工具" aria-pressed={mode==='draw'} disabled={!editable} className={mode==='draw'?'active':''} onClick={()=>setMode('draw')}><IconSquare size={18}/><span>画框</span></button>
          <button title="选择与移动（V）" aria-label="选择与移动工具" aria-pressed={mode==='select'} disabled={!editable} className={mode==='select'?'active':''} onClick={()=>setMode('select')}><IconHandMove size={18}/><span>选择</span></button>
          <button aria-label="撤销上次标注修改" title="撤销本图片上次修改" disabled={!editable||!undoCount} onClick={undo}><IconArrowBackUp size={18}/></button>
          <button aria-label="删除选中标注框" title="删除选中框，可撤销" disabled={!editable||!selectedBox} onClick={removeBox}><IconTrash size={18}/></button>
        </div><div className="iw-tool-group iw-zoom"><button aria-label="缩小画布" disabled={zoom<=100} onClick={()=>setZoom(value=>Math.max(100,value-25))}><IconZoomOut size={17}/></button><span>{zoom}%</span><button aria-label="放大画布" disabled={zoom>=250} onClick={()=>setZoom(value=>Math.min(250,value+25))}><IconZoomIn size={17}/></button><button aria-label="适应画布" title="适应画布" onClick={()=>setZoom(100)}><IconFocus2 size={17}/></button></div></div>
        <div className="iw-canvas-viewport"><div className="iw-canvas-surface" style={{width:zoom+'%'}}>
          <RegionPreview key={batch.datasetId+':'+selected.id} record={selected} labels={labels} selectedBoxId={selectedBoxId} workingBox={workingBox} mode={mode} editable={editable} onSelect={chooseBox} onGestureStart={startGesture} onGestureMove={moveGesture} onGestureEnd={finishGesture} onGestureCancel={cancelGesture} svgRef={svgRef} onImageError={()=>setImageError(true)} onImageLoad={()=>setImageError(false)} onCanvasKeyDown={canvasKeyDown}/>
        </div>{imageError&&<div className="iw-image-error"><IconPhoto size={34}/><strong>图片无法解码</strong><p>当前图片不能继续标注或提交，请返回数据集检查来源。</p></div>}</div>
        <div className="iw-canvas-caption"><span>{editable?(mode==='draw'?'在图上拖动创建标注框':'拖动选中框移动，拖动四角调整大小'):'当前标注只读；可点击框检查类别和坐标'}</span><span>{selected.boxes?.length||0} 个框{selected.noDefect?' · 已确认无缺陷':''}</span></div>
        {!selected.assignee&&['todo','rework'].includes(selected.status)&&<div className="iw-notice amber"><IconInfoCircle size={18}/><span>先分配标注人，再开始画框或确认无缺陷。</span></div>}
        {selected.rejection?.note&&['rework','review'].includes(selected.status)&&<div className={'iw-notice '+(selected.status==='rework'?'red':'amber')}><IconClipboardCheck size={18}/><div><strong>{selected.status==='rework'?'审核退回意见':'上次退回意见 · 已重新提交'}</strong><p>{selected.rejection.note}</p>{!!selected.rejection.boxIds?.length&&<small>退回时关联 {selected.rejection.boxIds.length} 个框。{selected.status==='rework'?'仍存在的关联框以红色虚线显示。':'请结合返工说明复核修改结果。'}</small>}</div></div>}
        {selected.status==='approved'&&<div className="iw-notice mint"><IconShieldCheck size={18}/><span>本图已通过审核，标注只读。需要修正时使用“重新标注”，已发布快照保持独立。</span></div>}
        <div className="iw-canvas-footer"><div className="iw-task-pager"><Button icon={IconChevronLeft} disabled={selectedIndex<=0} onClick={()=>changeTask(filtered[selectedIndex-1].id)}>上一张</Button><Button disabled={selectedIndex<0||selectedIndex>=filtered.length-1} onClick={()=>changeTask(filtered[selectedIndex+1].id)}>下一张<IconChevronRight size={16}/></Button></div><span className="iw-save-status" role="status">{editable?<><IconCheck size={15}/>{saveStatus||'修改即时保存为草稿'}</>:selected.assignee?'标注人：'+selected.assignee:'待分配标注人'}</span></div>
        {!!selected.history?.length&&<details className="iw-history"><summary><IconHistory size={16}/>流转记录 · {selected.history.length} 次操作</summary><ol>{selected.history.slice().reverse().map((event,index)=><li key={event.id||index}><div><strong>{historyNames[event.type]||historyNames[event.action]||event.action||event.type||'更新图片'}</strong><time>{formatTime(event.at)}</time></div><p>{event.actor||event.assignee||'演示操作'}{event.from&&event.to?' · '+(statuses[event.from]||event.from)+' → '+(statuses[event.to]||event.to):''}</p>{event.note&&<p>{event.note}</p>}{!!event.boxIds?.length&&<small>关联框：{event.boxIds.join('、')}</small>}</li>)}</ol></details>}
      </section>
      <aside className="panel iw-inspector">
        <div className="iw-inspector-heading"><div><span>{selected.status==='review'?'模拟审核员':'标注结果'}</span><h3>{selected.status==='review'?'复核图片与标注':'区域与属性'}</h3></div><Badge tone="neutral" dot={false}>{selected.boxes?.length||0} 个框</Badge></div>
        <div className="iw-inspector-body">
          <label className={'iw-normal '+(selected.noDefect?'selected':'')}><input type="checkbox" checked={!!selected.noDefect} disabled={!editable} onChange={event=>{if(event.target.checked&&selected.boxes.length){setDialog('normal');return}commit({noDefect:event.target.checked})}}/><span><strong>本图无缺陷</strong><small>正常图片需明确确认，不能用空标注代替。</small></span></label>
          <div className="iw-region-list" aria-label="标注区域列表">{selected.boxes?.length?selected.boxes.map((box,index)=><button key={box.id} className={selectedBoxId===box.id?'selected':''} aria-label={'选中标注框 '+(index+1)+' '+(box.label||'未选类别')} onClick={()=>{if(chooseBox(box.id))setMode('select')}}><i style={{background:labels.find(label=>label.name===box.label)?.color||'#f2b84c'}}/><span>{index+1}. {box.label||'未选类别'}</span><small>{box.severity||'未分级'}</small></button>):<div className="iw-no-regions"><IconSquare size={23}/><p>{selected.noDefect?'已保存为无缺陷样本':'还没有标注区域'}</p></div>}</div>
          {selectedBox?<div className="iw-box-properties"><div className="iw-section-title"><h4>选中框属性</h4><span>#{selected.boxes.findIndex(box=>box.id===selectedBox.id)+1}</span></div>
            <Field label="缺陷类别" required><select disabled={!editable} value={selectedBox.label||''} onChange={event=>{setDefaultLabel(event.target.value);patchBox({label:event.target.value})}}><option value="">请选择类别</option>{labels.map(label=><option key={label.name} value={label.name}>{label.name}</option>)}</select></Field>
            <Field label="严重程度" required><select disabled={!editable} value={selectedBox.severity||'一般'} onChange={event=>{setDefaultSeverity(event.target.value);patchBox({severity:event.target.value})}}>{severities.map(severity=><option key={severity}>{severity}</option>)}</select></Field>
            <div className="iw-section-title"><h4>原图像素坐标</h4><small>左上角 + 宽高</small></div>
            <div className="iw-coordinates">{[['x','X'],['y','Y'],['width','宽'],['height','高']].map(([key,label])=><label key={key}><span>{label}</span><input aria-label={label+' 原图像素'} type="number" step="0.01" min={key==='width'||key==='height'?2:0} disabled={!editable} value={coordinates[key]} onChange={event=>changeCoordinate(key,event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();saveCoordinates()}}}/></label>)}</div>
            {editable&&<Button className="iw-apply-coordinates" onClick={saveCoordinates}>应用坐标</Button>}{coordinatePending&&<div className="iw-coordinate-pending"><span>坐标不完整或越界，尚未应用。</span><button className="text-button" onClick={restoreCoordinates}>还原已保存坐标</button></div>}
            <small className="iw-coordinate-help">范围：{selected.width} × {selected.height} px。方向键移动 1 px，按住 Shift 移动 10 px。</small>
          </div>:editable&&!selected.noDefect?<div className="iw-new-box"><Field label="新框类别"><select value={defaultLabel} onChange={event=>setDefaultLabel(event.target.value)}><option value="">请选择类别</option>{labels.map(label=><option key={label.name}>{label.name}</option>)}</select></Field></div>:null}
          {editable&&<Button className="iw-add-box" icon={IconPlus} onClick={addNumericBox}>添加框并填写坐标</Button>}
          <Field label={selected.status==='rework'?'返工说明':'标注说明'} hint={editable?'说明与标注一起即时保存在当前批次。':undefined}><textarea rows={3} disabled={!editable} value={selected.note||''} onChange={event=>commit({note:event.target.value},{remember:false})} placeholder={selected.status==='rework'?'说明如何处理本次退回意见':'可填写本图判断依据'}/></Field>
          <AIAnnotationProvenance record={selected} datasetId={batch.datasetId} onNavigate={onNavigate}/>
          {selected.status==='review'&&<Field label="审核备注" hint="通过时保存；工作台内切换图片会保留待提交备注。"><textarea rows={3} value={reviewNote} onChange={event=>{setReviewNote(event.target.value);reviewNotesRef.current[batch.datasetId+':'+selected.id]=event.target.value}} placeholder="可记录通过或复核依据"/></Field>}
          {editable&&!!issues.length&&<div className="iw-validation"><IconInfoCircle size={16}/><ul>{issues.slice(0,4).map((issue,index)=><li key={index}>{issue}</li>)}</ul></div>}
          {error&&<p className="iw-error" role="alert">{error}</p>}
        </div>
        <div className="iw-actions">
          {['todo','rework'].includes(selected.status)&&<><Button disabled={!editable} onClick={()=>{if(coordinatePending&&!saveCoordinates())return;commit(copyAnnotation(recordRef.current),{notify:true})}}>保存草稿</Button><Button variant="primary" icon={selected.status==='rework'?IconRefresh:IconArrowRight} disabled={!canSubmit} onClick={()=>act('submit')}>{selected.status==='rework'?'重新提交审核':'提交审核'}</Button></>}
          {selected.status==='review'&&<><Button variant="danger" onClick={()=>{setReason('');setRejectedBoxIds(selectedBoxId?[selectedBoxId]:[]);setError('');setDialog('reject')}}>退回修改</Button><Button variant="primary" icon={IconCheck} disabled={!!issues.length||imageError} onClick={()=>act('approve',{note:reviewNote.trim()})}>通过并继续</Button></>}
          {selected.status==='approved'&&<Button onClick={()=>{setReason('');setError('');setDialog('reopen')}}>重新标注</Button>}
        </div>
        <div className="iw-local-note"><IconInfoCircle size={16}/><span>图片与标注自动保存在本浏览器，保存完成后刷新可继续。角色操作为本地演示。</span></div>
      </aside></>:<section className="panel iw-empty-editor"><Empty title="当前筛选下没有图片" description="本批次记录仍保留在各自队列中。"><Button onClick={()=>setFilter('all')}>查看全部图片</Button></Empty></section>}
    </div>
    {counts.total>0&&counts.approved===counts.total&&<div className="iw-completed"><IconShieldCheck size={24}/><div><h3>本批次图片已全部通过审核</h3><p>{counts.approved} 张图片与 {counts.boxes} 个框可以进入质量检查，发布独立版本。</p></div><Button variant="primary" onClick={()=>navigate('quality',scope)}>进入质量检查<IconArrowRight size={16}/></Button></div>}
    {active&&dialog==='assign'&&<Modal title="分配图片标注任务" description={batch.name+' · 模拟标注人'} onClose={()=>setDialog(null)} footer={<><Button onClick={()=>setDialog(null)}>取消</Button><Button variant="primary" disabled={assignScope==='unassigned'&&!counts.unassigned} onClick={assign}>确认分配</Button></>}><Field label="分配范围"><select value={assignScope} onChange={event=>setAssignScope(event.target.value)}><option value="unassigned">尚未分配的待办图片（{counts.unassigned} 张）</option><option value="pending">全部待标注与返工图片（{pending.length} 张）</option>{selected&&['todo','rework'].includes(selected.status)&&<option value="selected">当前图片（{selected.name}）</option>}</select></Field><Field label="模拟标注人"><select value={assignee} onChange={event=>setAssignee(event.target.value)}><option>李一</option><option>陈思</option><option>演示管理员</option></select></Field><p className="iw-dialog-help">本次分配只影响当前图片批次，不会更改已提交和已通过记录。</p>{error&&<p className="iw-error" role="alert">{error}</p>}</Modal>}
    {active&&(dialog==='reject'||dialog==='reopen')&&selected&&<Modal title={dialog==='reject'?'退回图片标注':'重新标注图片'} description={selected.name+' · '+selected.id} onClose={()=>setDialog(null)} footer={<><Button onClick={()=>setDialog(null)}>取消</Button><Button variant={dialog==='reject'?'danger':'primary'} disabled={!reason.trim()} onClick={()=>act(dialog,{note:reason.trim(),...(dialog==='reject'?{boxIds:rejectedBoxIds}:{})})}>{dialog==='reject'?'确认退回':'确认重新标注'}</Button></>}><Field label={dialog==='reject'?'退回原因':'重新标注原因'} required><textarea rows={4} value={reason} onChange={event=>setReason(event.target.value)} placeholder={dialog==='reject'?'说明具体区域、类别或边界需要如何修改':'说明需要重新检查这张图片的原因'}/></Field>{dialog==='reject'&&!!selected.boxes.length&&<div className="iw-reject-regions"><h4>关联需要修改的框</h4><p>不选择框时，意见针对整张图片。</p>{selected.boxes.map((box,index)=><label key={box.id}><input type="checkbox" checked={rejectedBoxIds.includes(box.id)} onChange={event=>setRejectedBoxIds(ids=>event.target.checked?[...ids,box.id]:ids.filter(id=>id!==box.id))}/><span>框 {index+1} · {box.label||'未选类别'} · {box.severity}</span></label>)}</div>}{dialog==='reopen'&&<div className="iw-notice amber"><IconInfoCircle size={18}/><span>本图将回到待标注，当前质检需要重新执行；已有发布版本保留原图和原标注。</span></div>}{error&&<p className="iw-error" role="alert">{error}</p>}</Modal>}
    {active&&dialog==='normal'&&selected&&<Modal title="确认本图无缺陷" description={selected.name} onClose={()=>setDialog(null)} footer={<><Button onClick={()=>setDialog(null)}>保留标注框</Button><Button variant="primary" onClick={()=>{if(commit({boxes:[],noDefect:true})){setSelectedBoxId(null);setDialog(null)}}}>清除框并标记无缺陷</Button></>}><p>当前图片有 {selected.boxes.length} 个标注框。确认无缺陷将清除这些框，并将图片保存为正常样本；提交审核前可以撤销本次修改。</p></Modal>}
    {active&&dialog==='guide'&&<Modal title={batch.specSnapshot?.name||'图片标注规范'} description={'冻结版本 '+(batch.specSnapshot?.version||'')+' · '+batch.taskSpecVersionId} wide onClose={()=>setDialog(null)} footer={<Button variant="primary" onClick={()=>setDialog(null)}>已了解</Button>}><div className="iw-guide"><h3>标注指南</h3><p>{batch.specSnapshot?.guide||'逐一圈定可见缺陷，标注框紧贴目标边界；正常图片明确标记为无缺陷。'}</p><h3>本批次执行方式</h3><p>每张图片提交后进入人工审核。审核员只读检查原图、框、类别和严重程度；有问题时关联具体框并填写退回原因，由标注员修改后重新提交。</p><h3>冻结标签</h3>{labels.map(label=><div key={label.name}><strong><i style={{background:label.color||'#42d8c1'}}/>{label.name}</strong><p>{label.description||'按本批次指南判断此缺陷类别。'}</p></div>)}<h3>坐标与草稿</h3><p>标注框使用原图像素坐标，与画布缩放比例无关。画框、移动、缩放、属性和说明即时保存为草稿；有效数字坐标同样即时保存，空值和越界值需修正或还原后继续。已提交与已通过记录只读。</p><p className="iw-dialog-help">当前模拟标注和审核角色；真实账号、权限和后台存储尚未接入。</p></div></Modal>}
  </div>;
}
