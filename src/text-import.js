// Actual browser-local CSV/JSON decoding. Nothing is uploaded.
export function parseTextFile(content, filename) {
  if (typeof content !== 'string' || content.length > 20*1024*1024) throw new Error('文件内容超过 20 MB。');
  content=content.replace(/^\uFEFF/,'');
  let rows;
  if (/\.json$/i.test(filename)) {
    const data=JSON.parse(content); rows=Array.isArray(data)?data:data?.records;
    if(!Array.isArray(rows)) throw new Error('JSON 须为对象数组，或包含 records 数组。');
    if(rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('每条 JSON 记录须为对象。');
  } else {
    const table=[];let row=[],cell='',quoted=false,closed=false;
    for(let i=0;i<content.length;i++){
      const c=content[i];
      if(quoted){if(c==='"'){if(content[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=c;continue}
      if(c==='"'){if(cell||closed)throw new Error('CSV 引号位置不正确。');quoted=true;continue}
      if(closed&&c!==','&&c!=='\r'&&c!=='\n')throw new Error('CSV 闭合引号后存在多余字符。');
      if(c===','){row.push(cell);cell='';closed=false}else if(c==='\r'||c==='\n'){if(c==='\r'&&content[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x!==''))table.push(row);row=[];cell='';closed=false}else cell+=c;
    }
    if(quoted)throw new Error('CSV 引号未闭合。');
    if(cell||row.length){row.push(cell);table.push(row)}
    const headers=table.shift()?.map(x=>x.trim())||[];
    if(!headers.length||headers.some(x=>!x)||new Set(headers).size!==headers.length)throw new Error('CSV 表头不能为空或重复。');
    rows=table.map((values,index)=>({...Object.fromEntries(headers.map((key,i)=>[key,values[i]??''])),...(values.length!==headers.length?{__rowError:`第 ${index+2} 行列数与表头不一致`}:{})}));
  }
  if(!rows.length||rows.length>10000)throw new Error('支持 1–10000 条记录。');
  const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))].filter(key=>key!=='__rowError');
  const guess=(keys)=>keys.find(key=>columns.includes(key))||'';
  return {rows,columns,mapping:{text:guess(['text','content','文本','内容']),id:guess(['id','编号']),channel:guess(['channel','渠道']),label:guess(['label','referenceLabel','标签'])}};
}
export function mapTextRows(parsed,mapping,prefix='IMPORT'){
  if(!mapping.text||!parsed.columns.includes(mapping.text))return {records:[],errors:[{row:0,error:'请选择文本内容字段。'}]};
  const records=[],errors=[],ids=new Set();
  parsed.rows.forEach((row,index)=>{
    const value=row[mapping.text],id=mapping.id?String(row[mapping.id]??'').trim():`${prefix}-${index+1}`;
    const error=row.__rowError||(!id?'编号为空':ids.has(id)?'编号重复':typeof value!=='string'||!value.trim()?'文本为空或不是字符串':value.length>100000?'文本超过 100000 字符':'');
    if(id)ids.add(id);
    if(error)errors.push({row:index+1,id,error});
    else records.push({id,text:value,channel:mapping.channel?String(row[mapping.channel]??''):'本地文件',referenceLabel:mapping.label?String(row[mapping.label]??''):''});
  });
  return {records,errors};
}
