import React from 'react';
import {Button,Badge} from './ui.jsx';
export default function AIAnnotationProvenance({record,datasetId,onNavigate}){
 const a=record?.aiAnnotation;if(!a)return null;
 return <div className="ai-provenance"><div><Badge tone="amber">AI 模拟建议来源</Badge><strong>{a.modelVersionId} · 模拟置信度 {Math.round(a.confidence*100)}%</strong></div><p>{a.method}。已接受为草稿，当前标签或框以人工校正结果为准。</p><small>任务 {a.jobId} · 预测 {a.predictionId} · 输入修订 R{a.inputRevision}</small><Button variant="ghost" onClick={()=>onNavigate('ai-annotation',{datasetId,jobId:a.jobId})}>查看预标注来源</Button></div>;
}
