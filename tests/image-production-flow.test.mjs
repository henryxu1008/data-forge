import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyImageBatchAction,createDemoImageRecords,createImageBatch,defaultImageSpec,
  imageBatchCounts,imageCocoPayload,imageExportPayload,imageRecordIssues,
} from '../src/image-production-state.js';

const at='2026-10-27T16:00:00.000Z';
const copy=value=>JSON.parse(JSON.stringify(value));
const make=(id='images-A',extra={})=>createImageBatch({
  datasetId:id,name:`图片集 ${id}`,projectId:`project-${id}`,projectName:`图片项目 ${id}`,
  batchId:`batch-${id}`,specSnapshot:copy(defaultImageSpec),records:createDemoImageRecords(id),at,...extra,
});
const act=(batch,type,rest={})=>applyImageBatchAction(batch,{type,...rest,at});
function must(batch,type,rest={}){
  const result=act(batch,type,rest);
  assert.equal(result.ok,true,result.error);
  return result.batch;
}
function rejected(batch,type,payload={}){
  const before=JSON.stringify(batch);
  const result=act(batch,type,payload);
  assert.equal(result.ok,false,`${type} should reject`);
  assert.equal(result.batch,batch);
  assert.ok(result.error);
  assert.equal(JSON.stringify(batch),before);
  return result;
}
const assigned=(id='images-A')=>must(make(id),'assign',{assignee:'李一'});
const box=(patch={})=>({id:'box-1',x:320,y:210,width:270,height:190,label:'划痕',severity:'一般',...patch});
function approveOne(batch,index=0,boxes=[box()],noDefect=false){
  const recordId=batch.records[index].id;
  batch=must(batch,'submit',{recordId,boxes,noDefect,note:'已核对原图及标注规范'});
  return must(batch,'approve',{recordId,note:'符合冻结规范'});
}
function publish(batch,note='审核通过图片首版'){
  return must(must(batch,'checkQuality'),'publish',{note});
}

test('three offline synthetic sources create an independent, unannotated batch with frozen specification',()=>{
  const input=createDemoImageRecords('source');
  assert.equal(input.length,3);
  assert.equal(new Set(input.map(record=>record.src)).size,3);
  for(const record of input){
    const svg=decodeURIComponent(record.src.slice(record.src.indexOf(',')+1));
    assert.match(svg,/<svg[^>]+width="1024"[^>]+height="640"/);
    assert.match(svg,/SYNTHETIC SAMPLE/);
    assert.doesNotMatch(svg,/(?:href|src)=["']https?:/);
    assert.equal(record.source,'built-in');
    assert.equal(record.mimeType,'image/svg+xml');
    assert.equal('boxes' in record,false);
  }
  const spec=copy(defaultImageSpec);
  input[0].boxes=[box()];input[0].status='approved';
  const batch=make('frozen',{records:input,specSnapshot:spec});
  input[0].src='data:modified';input[0].name='外部修改';spec.labels[0].name='外部类别';
  assert.notEqual(batch.records[0].src,input[0].src);
  assert.notEqual(batch.records[0].name,input[0].name);
  assert.equal(batch.specSnapshot.labels[0].name,'划痕');
  assert.match(batch.specSnapshot.review,/每张图片均需人工审核/);
  assert.equal(batch.taskSpecVersionId,defaultImageSpec.versionId);
  assert.equal(batch.revision,0);
  assert.equal(batch.quality,null);
  assert.deepEqual(batch.versions,[]);
  assert.ok(batch.records.every(record=>record.status==='todo'&&!record.assignee&&!record.noDefect&&!record.boxes.length&&!record.history.length));
  assert.deepEqual(imageBatchCounts(batch),{total:3,todo:3,review:0,rework:0,approved:0,unassigned:3,boxes:0});
});

test('ingestion rejects unusable identity, source, dimensions, duplicate IDs and empty specifications',()=>{
  for(const extra of [{datasetId:''},{name:' '},{projectId:''},{projectName:''},{records:[]},{specSnapshot:{versionId:'bad',labels:[]}},{specSnapshot:{labels:['划痕']}},{specSnapshot:{versionId:'bad',labels:['划痕',' 划痕 ']}}]){
    assert.throws(()=>make('invalid',extra),Error);
  }
  for(const patch of [
    {src:'https://example.com/image.png'},{src:'blob:temporary'},{src:''},
    {source:'upload'},{mimeType:'image/gif'},{width:0},{height:Infinity},
    {width:8193},{height:8193},{width:6000,height:6000},{width:1.5},
    {mimeType:'image/png',src:'data:image/jpeg;base64,AAAA'},
    {mimeType:'image/png',source:'upload',src:'data:image/png;base64,'},
  ]){
    assert.throws(()=>make('invalid',{records:[{...createDemoImageRecords()[0],...patch}]}),Error);
  }
  const records=createDemoImageRecords();records[1].id=records[0].id;
  assert.throws(()=>make('duplicate',{records}),/编号重复/);
  const tinyPng={id:'upload-1',name:'pixel.png',width:1,height:1,mimeType:'image/png',source:'upload',src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx1kAAAAASUVORK5CYII='};
  assert.equal(make('uploaded',{records:[tinyPng]}).records[0].source,'upload');
});

test('assignment is scoped to editable images and is required before annotation',()=>{
  let batch=make();const recordId=batch.records[0].id;
  rejected(batch,'saveDraft',{recordId,boxes:[box()]});
  rejected(batch,'submit',{recordId,boxes:[box()]});
  rejected(batch,'assign',{assignee:' '});
  rejected(batch,'assign',{assignee:'李一',recordIds:['foreign-record']});
  rejected(batch,'assign',{assignee:'李一',recordIds:[recordId,recordId]});
  rejected(batch,'assign',{assignee:'李一',recordIds:[]});
  batch=must(batch,'assign',{assignee:'李一',recordIds:[recordId]});
  assert.equal(batch.records[0].assignee,'李一');
  assert.equal(batch.records[1].assignee,'');
  assert.equal(imageBatchCounts(batch).unassigned,2);
  const same=act(batch,'assign',{assignee:'李一',recordIds:[recordId]});
  assert.equal(same.batch,batch);assert.equal(same.unchanged,true);
  batch=must(batch,'submit',{recordId,boxes:[box()]});
  rejected(batch,'assign',{assignee:'王二',recordIds:[recordId]});
  rejected(batch,'saveDraft',{recordId,boxes:[box({x:340})]});
  rejected(batch,'submit',{recordId,boxes:[box()]});
});

test('drafts allow missing categories without approving incomplete annotations or changing source fields',()=>{
  let batch=assigned();const original=batch.records[0];const recordId=original.id;
  batch=must(batch,'saveDraft',{recordId,boxes:[box({label:''})],note:'待确认类别',src:'data:replacement',width:5});
  assert.equal(batch.records[0].status,'todo');
  assert.equal(batch.records[0].boxes[0].label,'');
  assert.equal(batch.records[0].note,'待确认类别');
  assert.equal(batch.records[0].src,original.src);
  assert.equal(batch.records[0].width,1024);
  rejected(batch,'submit',{recordId});
  rejected(batch,'saveDraft',{recordId,boxes:[box({label:'未知类别'})]});
  rejected(batch,'saveDraft',{recordId,boxes:[box({severity:''})]});
  const before=batch.revision;
  const same=act(batch,'saveDraft',{recordId,boxes:[box({label:''})],note:'待确认类别'});
  assert.equal(same.batch,batch);assert.equal(same.unchanged,true);
  batch=must(batch,'submit',{recordId,boxes:[box()],note:'已确认划痕'});
  assert.equal(batch.revision,before+1);
  assert.equal(batch.records[0].status,'review');
  assert.deepEqual(imageRecordIssues(batch.records[0],batch.specSnapshot),[]);
});

test('invalid or duplicate boxes are rejected atomically; original-pixel geometry supports decimals and image edges',()=>{
  let batch=assigned();const recordId=batch.records[0].id;
  for(const patch of [{x:-1},{y:-1},{width:0},{height:-2},{x:1000,width:25},{y:630,height:11},{x:NaN},{y:Infinity},{width:'20'},{id:''}]){
    rejected(batch,'saveDraft',{recordId,boxes:[box(patch)]});
    rejected(batch,'submit',{recordId,boxes:[box(patch)]});
  }
  rejected(batch,'saveDraft',{recordId,boxes:[box(),box({x:80})]});
  rejected(batch,'saveDraft',{recordId,boxes:[box(),box({id:' box-1 '})]});
  rejected(batch,'saveDraft',{recordId,boxes:null});
  rejected(batch,'submit',{recordId,boxes:[box()],noDefect:true});
  const boxes=[box({x:12.25,y:20.5,width:31.125,height:40.75}),box({id:'edge',x:1000,y:600,width:24,height:40,label:'裂纹'})];
  batch=must(batch,'submit',{recordId,boxes});
  assert.deepEqual(batch.records[0].boxes,boxes);
  boxes[0].x=9;
  assert.equal(batch.records[0].boxes[0].x,12.25);
});

test('a normal image needs explicit no-defect confirmation and then follows the same human review path',()=>{
  let batch=assigned();const recordId=batch.records[2].id;
  rejected(batch,'submit',{recordId,boxes:[],noDefect:false});
  rejected(batch,'submit',{recordId,boxes:[],noDefect:'true'});
  rejected(batch,'approve',{recordId});
  batch=must(batch,'submit',{recordId,boxes:[],noDefect:true,note:'确认整幅板面无缺陷'});
  assert.equal(batch.records[2].status,'review');
  batch=must(batch,'approve',{recordId});
  assert.equal(batch.records[2].status,'approved');
  assert.equal(batch.records[2].noDefect,true);
  assert.deepEqual(batch.records[2].boxes,[]);
  assert.equal(imageBatchCounts(batch).approved,1);
  assert.equal(imageBatchCounts(batch).boxes,0);
});

test('region-specific rejection, rework and resubmission preserve reasons, geometry evidence and count conservation',()=>{
  let batch=assigned();const recordId=batch.records[0].id;
  const boxes=[box(),box({id:'box-2',x:70,y:80,width:50,height:40,label:'凹陷'})];
  batch=must(batch,'submit',{recordId,boxes});
  rejected(batch,'reject',{recordId,note:' '});
  rejected(batch,'reject',{recordId,note:'框选不准',boxIds:['other-image-box']});
  rejected(batch,'reject',{recordId,note:'框选不准',boxIds:['box-1','box-1']});
  batch=must(batch,'reject',{recordId,note:'划痕框需贴紧边缘',boxIds:['box-1']});
  assert.equal(batch.records[0].status,'rework');
  assert.deepEqual(batch.records[0].rejection.boxIds,['box-1']);
  assert.deepEqual(batch.records[0].rejection.boxes,[boxes[0]]);
  rejected(batch,'approve',{recordId});
  batch=must(batch,'saveDraft',{recordId,boxes:[box({x:330,width:250}),boxes[1]],note:'已收紧划痕范围'});
  assert.equal(batch.records[0].status,'rework');
  batch=must(batch,'submit',{recordId});
  batch=must(batch,'approve',{recordId,note:'修改符合规范'});
  const record=batch.records[0];
  assert.equal(record.resubmissions,1);
  assert.equal(record.rejection.note,'划痕框需贴紧边缘');
  assert.equal(record.rejection.boxes[0].x,320);
  assert.equal(record.boxes[0].x,330);
  assert.deepEqual(record.history.map(event=>event.type),['assign','submit','reject','saveDraft','submit','approve']);
  const event=record.history.find(item=>item.type==='reject');
  assert.deepEqual(event.boxIds,['box-1']);assert.equal(event.boxes[0].x,320);
  const counts=imageBatchCounts(batch);
  assert.equal(counts.total,counts.todo+counts.review+counts.rework+counts.approved);
  assert.equal(counts.approved,1);assert.equal(counts.boxes,2);
});

test('approved images are read-only until reopened with a reason; reopening retains annotations',()=>{
  let batch=approveOne(assigned());const recordId=batch.records[0].id;
  for(const type of ['saveDraft','submit','approve','reject'])rejected(batch,type,{recordId,boxes:[box({label:'凹陷'})],note:'不能直接更改已通过记录'});
  rejected(batch,'reopen',{recordId,note:' '});
  const previous=copy(batch.records[0].boxes);
  batch=must(batch,'reopen',{recordId,note:'补充第二轮复查'});
  assert.equal(batch.records[0].status,'todo');
  assert.deepEqual(batch.records[0].boxes,previous);
  assert.equal(batch.records[0].reopenReason,'补充第二轮复查');
  assert.equal(batch.records[0].assignee,'李一');
  assert.equal(imageBatchCounts(batch).approved,0);
});

test('quality returns failed results for no approved scope and revalidates corrupt geometry, sources and labels',()=>{
  const empty=must(make(),'checkQuality');
  assert.equal(empty.quality.status,'failed');
  assert.equal(empty.quality.count,0);
  assert.equal(empty.quality.rules.find(rule=>rule.id==='scope').passed,false);
  rejected(empty,'publish',{note:'不能发布空版本'});
  const good=approveOne(assigned());
  for(const transform of [
    batch=>{batch.records[0].boxes[0].width=0;},
    batch=>{batch.records[0].boxes=null;},
    batch=>{batch.records[0].boxes[0].label='已移除类别';},
    batch=>{batch.records[0].src='https://example.com/remote.png';},
    batch=>{batch.specSnapshot.labels=null;},
    batch=>{batch.taskSpecVersionId='wrong-version';},
  ]){
    const corrupt=copy(good);transform(corrupt);
    const checked=must(corrupt,'checkQuality');
    assert.equal(checked.quality.status,'failed');
    assert.ok(checked.quality.rules.some(rule=>!rule.passed));
    rejected(checked,'publish',{note:'无效数据不得发布'});
  }
  const checked=must(good,'checkQuality');
  assert.equal(checked.quality.status,'passed');
  assert.equal(checked.quality.sourceRevision,good.revision);
  assert.deepEqual(checked.quality.eligibleIds,[good.records[0].id]);
  assert.ok(checked.quality.rules.every(rule=>typeof rule.name==='string'&&typeof rule.passed==='boolean'&&typeof rule.detail==='string'));
});

test('partial publication freezes only the actual approved images and leaves review/rework records in place',()=>{
  let batch=approveOne(assigned());
  batch=must(batch,'submit',{recordId:batch.records[1].id,boxes:[box({label:'凹陷'})]});
  batch=must(batch,'submit',{recordId:batch.records[2].id,boxes:[],noDefect:true});
  batch=must(batch,'reject',{recordId:batch.records[2].id,note:'请复查整幅图像'});
  batch=must(batch,'checkQuality');
  assert.equal(batch.quality.count,1);assert.equal(batch.quality.boxCount,1);
  rejected(batch,'publish',{note:'   '});
  const before=batch;
  const result=act(batch,'publish',{note:'先发布首张通过图片',owner:'审核员'});
  assert.equal(result.ok,true,result.error);batch=result.batch;
  const version=result.version;
  assert.equal(version.count,1);assert.equal(version.boxCount,1);
  assert.equal(version.records.length,version.count);
  assert.deepEqual(version.records.map(record=>record.id),[batch.records[0].id]);
  assert.deepEqual(batch.records.map(record=>record.status),['approved','review','rework']);
  assert.equal(version.datasetId,batch.datasetId);assert.equal(version.projectId,batch.projectId);
  assert.equal(version.batchId,batch.batchId);assert.equal(version.taskSpecVersionId,batch.taskSpecVersionId);
  assert.equal(version.sourceRevision,batch.revision);assert.equal(version.type,'image');
  assert.equal(version.owner,'审核员');assert.equal(version.version,'v0.1');
  assert.equal(before.versions.length,0);assert.equal(batch.versions[0],version);
  assert.notEqual(version.records[0],batch.records[0]);
  assert.notEqual(version.records[0].boxes,batch.records[0].boxes);
  assert.notEqual(version.records[0].history,batch.records[0].history);
  assert.notEqual(version.specSnapshot.labels,batch.specSnapshot.labels);
});

test('every effective working change invalidates quality, including a same-count correction and reassignment',()=>{
  let batch=must(approveOne(assigned()),'checkQuality');
  const oldQuality=copy(batch.quality);const recordId=batch.records[0].id;
  batch=must(batch,'reopen',{recordId,note:'修正类别'});
  assert.equal(batch.quality.status,'stale');
  batch=must(batch,'submit',{recordId,boxes:[box({label:'凹陷'})]});
  batch=must(batch,'approve',{recordId});
  assert.equal(imageBatchCounts(batch).approved,oldQuality.count);
  assert.notEqual(batch.revision,oldQuality.sourceRevision);
  rejected(batch,'publish',{note:'不能复用旧质检'});
  rejected({...batch,quality:oldQuality},'publish',{note:'相同数量也不能绕过修订号'});
  batch=must(batch,'checkQuality');
  batch=must(batch,'assign',{recordIds:[batch.records[1].id],assignee:'王二'});
  assert.equal(batch.quality.status,'stale');
  rejected(batch,'publish',{note:'重新分配后需重检'});
  batch=must(batch,'checkQuality');
  batch=must(batch,'saveDraft',{recordId:batch.records[1].id,boxes:[box({label:''})]});
  assert.equal(batch.quality.status,'stale');
  rejected(batch,'publish',{note:'保存草稿后需重检'});
});

test('published versions remain isolated after edits and new publication; duplicate publication at one revision is blocked',()=>{
  let batch=publish(approveOne(assigned()));
  const first=batch.versions[0],snapshot=JSON.stringify(first),oldRevision=batch.revision;
  rejected(batch,'publish',{note:'重复发布'});
  batch=must(batch,'checkQuality');
  rejected(batch,'publish',{note:'重新质检不构成新修订'});
  const recordId=batch.records[0].id;
  batch=must(batch,'reopen',{recordId,note:'调整框位置与标签'});
  batch=must(batch,'submit',{recordId,boxes:[box({x:330,label:'凹陷'})]});
  batch=must(batch,'approve',{recordId});
  batch=publish(batch,'修订框及类别');
  assert.equal(batch.versions.length,2);
  assert.equal(batch.versions[0].version,'v0.2');
  assert.notEqual(batch.versions[0].id,first.id);
  assert.ok(batch.revision>oldRevision);
  assert.equal(JSON.stringify(batch.versions[1]),snapshot);
  assert.equal(batch.versions[0].records[0].boxes[0].label,'凹陷');
  assert.equal(first.records[0].boxes[0].label,'划痕');
  batch.records[0].boxes[0].label='外部修改';
  batch.records[0].history[0].note='外部修改';
  batch.specSnapshot.labels[0].name='外部规范';
  assert.equal(JSON.stringify(first),snapshot);
  assert.equal(batch.versions[0].records[0].boxes[0].label,'凹陷');
  assert.equal(batch.versions[0].specSnapshot.labels[0].name,'划痕');
});

test('separate batches preserve counts, work, version IDs and reject foreign record or version references',()=>{
  const originalB=assigned('images-B');const snapshotB=JSON.stringify(originalB);
  let batchA=publish(approveOne(assigned('images-A')));
  rejected(batchA,'submit',{recordId:originalB.records[0].id,boxes:[box()]});
  rejected(originalB,'assign',{assignee:'李一',recordIds:[batchA.records[0].id]});
  assert.equal(JSON.stringify(originalB),snapshotB);
  assert.equal(imageBatchCounts(originalB).approved,0);
  assert.equal(originalB.versions.length,0);
  const batchB=publish(approveOne(originalB));
  assert.notEqual(batchA.versions[0].id,batchB.versions[0].id);
  assert.throws(()=>imageExportPayload(batchA,batchB.versions[0]),/不属于当前图片批次/);
  assert.throws(()=>imageCocoPayload(batchA,batchB.versions[0]),/不属于当前图片批次/);
  assert.throws(()=>imageExportPayload(batchA,{...batchA.versions[0],batchId:batchB.batchId}),/不属于当前图片批次/);
  assert.equal(imageBatchCounts(batchA).approved,1);
});

test('full JSON export includes image bytes, provenance and pixel convention without aliasing live or historical state',()=>{
  let batch=publish(approveOne(assigned()));const first=batch.versions[0];
  const current=imageExportPayload(batch);
  assert.equal(current.exportType,'working-batch');assert.equal(current.count,3);
  assert.equal(current.version,null);
  assert.equal(current.dataset.batchId,batch.batchId);
  assert.equal(current.dataset.projectId,batch.projectId);
  assert.equal(current.dataset.taskSpecVersionId,batch.taskSpecVersionId);
  assert.deepEqual(current.coordinateSystem,{unit:'pixel',origin:'top-left',bbox:['x','y','width','height'],reference:'original-image'});
  assert.ok(current.records.every(record=>record.src.startsWith('data:')));
  current.records[0].boxes[0].x=0;current.specSnapshot.labels[0].name='篡改导出副本';
  assert.equal(batch.records[0].boxes[0].x,320);
  assert.equal(batch.specSnapshot.labels[0].name,'划痕');
  const recordId=batch.records[0].id;
  batch=must(batch,'reopen',{recordId,note:'下一轮修订'});
  batch=must(batch,'saveDraft',{recordId,boxes:[box({x:350})]});
  const frozen=imageExportPayload(batch,first);
  assert.equal(frozen.exportType,'published-version');assert.equal(frozen.count,1);
  assert.equal(frozen.version.id,first.id);assert.equal(frozen.revision,first.sourceRevision);
  assert.equal(frozen.records[0].boxes[0].x,320);
  assert.equal(frozen.records[0].width,1024);assert.equal(frozen.records[0].height,640);
  assert.match(frozen.records[0].src,/^data:image\/svg\+xml/);
  const tampered={...first,records:[]};
  assert.equal(imageExportPayload(batch,tampered).count,1);
  assert.throws(()=>imageExportPayload(batch,{id:'missing-version'}),/不属于当前图片批次/);
  assert.deepEqual(JSON.parse(JSON.stringify(frozen)),frozen);
});

test('COCO export preserves original-pixel boxes, category mappings, area, unique IDs and normal images',()=>{
  let batch=assigned();
  batch=approveOne(batch,0,[box({x:12.25,y:20.5,width:31.125,height:40.75}),box({id:'crack',x:700,y:300,width:100,height:50,label:'裂纹',severity:'严重'})]);
  batch=approveOne(batch,1,[box({x:415,y:230,width:250,height:195,label:'凹陷',severity:'轻微'})]);
  batch=approveOne(batch,2,[],true);
  batch=publish(batch);
  const version=batch.versions[0];const coco=imageCocoPayload(batch,version);
  assert.equal(coco.images.length,3);assert.equal(coco.annotations.length,3);
  assert.deepEqual(coco.categories.map(category=>category.name),['划痕','凹陷','裂纹']);
  assert.equal(coco.info.source_version_id,version.id);
  assert.equal(coco.info.source_batch_id,batch.batchId);
  assert.equal(coco.info.task_spec_version_id,batch.taskSpecVersionId);
  assert.equal(coco.info.image_bytes_included,false);
  assert.equal(new Set(coco.images.map(image=>image.id)).size,3);
  assert.equal(new Set(coco.annotations.map(annotation=>annotation.id)).size,3);
  const categoryName=id=>coco.categories.find(category=>category.id===id)?.name;
  for(const image of coco.images){
    const source=version.records.find(record=>record.id===image.source_record_id);
    assert.equal(image.width,source.width);assert.equal(image.height,source.height);
    assert.equal(image.file_name,source.name);
    const annotations=coco.annotations.filter(annotation=>annotation.image_id===image.id);
    assert.equal(annotations.length,source.boxes.length);
    annotations.forEach((annotation,index)=>{
      const original=source.boxes[index];
      assert.deepEqual(annotation.bbox,[original.x,original.y,original.width,original.height]);
      assert.equal(annotation.area,original.width*original.height);
      assert.equal(categoryName(annotation.category_id),original.label);
      assert.equal(annotation.attributes.severity,original.severity);
      assert.equal(annotation.attributes.source_box_id,original.id);
      assert.equal(annotation.iscrowd,0);
    });
  }
  const normal=coco.images.find(image=>image.no_defect);
  assert.ok(normal);assert.equal(coco.annotations.filter(annotation=>annotation.image_id===normal.id).length,0);
  assert.equal(JSON.stringify(coco).includes('data:image'),false);
  coco.annotations[0].bbox[0]=0;
  assert.equal(version.records[0].boxes[0].x,12.25);
  assert.throws(()=>imageCocoPayload(batch),/已发布/);
  assert.throws(()=>imageCocoPayload(batch,{id:'missing-version'}),/不属于当前图片批次/);
});

test('approvals and publication revalidate saved data instead of trusting an old UI result',()=>{
  let batch=assigned();const recordId=batch.records[0].id;
  batch=must(batch,'submit',{recordId,boxes:[box()]});
  const corruptReview=copy(batch);corruptReview.records[0].boxes[0].height=0;
  rejected(corruptReview,'approve',{recordId});
  batch=must(batch,'approve',{recordId});batch=must(batch,'checkQuality');
  const corruptPassed=copy(batch);corruptPassed.records[0].boxes[0].label='未知';
  rejected(corruptPassed,'publish',{note:'质检之后数据不合法'});
  const changedScope=copy(batch);changedScope.quality.eligibleIds=['foreign-record'];
  rejected(changedScope,'publish',{note:'错配审核范围'});
});

test('unsupported or malformed actions never mutate the current batch',()=>{
  const batch=assigned();const recordId=batch.records[0].id;
  rejected(batch,'unknown',{recordId});
  rejected(batch,'submit',{recordId:'missing'});
  const before=JSON.stringify(batch);
  const invalid=applyImageBatchAction(batch,null);
  assert.equal(invalid.ok,false);assert.equal(invalid.batch,batch);
  assert.equal(JSON.stringify(batch),before);
  assert.equal(applyImageBatchAction(null,{type:'checkQuality'}).ok,false);
});
