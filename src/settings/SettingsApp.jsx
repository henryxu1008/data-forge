import React,{useState,useEffect,useMemo,useCallback} from 'react';
import {IconSettings,IconBuildingCommunity,IconUsers,IconShieldCheck,IconCube,IconDatabase,IconChartLine,IconLink,IconLock,IconBell,IconFileText,IconHistory,IconChevronDown} from '@tabler/icons-react';
import {Badge} from '../ui.jsx';
import {SettingsContext} from './context.jsx';
import SettingsBasic,{initialBasicState} from './SettingsBasic.jsx';
import SettingsResources,{initialResourceState} from './SettingsResources.jsx';
import SettingsSecurity,{initialSecurityState} from './SettingsSecurity.jsx';
import './shared.css';

export const settingsMenu=[
  {label:'基础管理',group:'basic',items:[{id:'general',title:'基本设置',icon:IconSettings},{id:'organizations',title:'组织与空间',icon:IconBuildingCommunity},{id:'members',title:'用户与成员',icon:IconUsers},{id:'roles',title:'角色与权限',icon:IconShieldCheck}]},
  {label:'资源与集成',group:'resources',items:[{id:'model-services',title:'模型服务',icon:IconCube},{id:'connections',title:'数据连接与存储',icon:IconDatabase},{id:'quotas',title:'算力与配额',icon:IconChartLine},{id:'api',title:'API 与集成',icon:IconLink}]},
  {label:'安全与运维',group:'security',items:[{id:'security',title:'登录与安全',icon:IconLock},{id:'notifications',title:'通知与告警',icon:IconBell},{id:'audit',title:'审计日志',icon:IconFileText},{id:'backups',title:'备份与恢复',icon:IconHistory}]}
];
export const settingsPages=settingsMenu.flatMap(group=>group.items.map(item=>({...item,group:group.group})));

const seedAudit=[
  {id:'EV-20261026-001',at:'2026-10-26T08:20:00.000Z',actor:'演示管理员',action:'调整项目授权',object:'王越',result:'成功',space:'演示空间',before:{'授权项目':'无','样本范围':'无'},after:{'授权项目':'工业质检项目','样本范围':'本人待审样本'},details:'适用角色：审核专家。示例审计事件。'},
  {id:'EV-20261026-002',at:'2026-10-26T08:05:00.000Z',actor:'张敏',action:'发布数据版本',object:'客户反馈 v0.2',result:'成功',space:'演示空间',before:{},after:{'版本':'v0.2','样本数':880},details:'演示版本发布记录。'},
  {id:'EV-20261026-003',at:'2026-10-26T07:42:00.000Z',actor:'王越',action:'退回标注样本',object:'IMG_0148',result:'成功',space:'演示空间',before:{'状态':'待审核'},after:{'状态':'需返工'},details:'示例：请调整缺陷区域边界。'},
  {id:'EV-20261026-004',at:'2026-10-26T07:10:00.000Z',actor:'李一',action:'调用模型服务',object:'内部对话服务',result:'拒绝',space:'演示空间',before:{},after:{},details:'示例：请求超出已授权范围。'}
];
function clone(value){return JSON.parse(JSON.stringify(value))}
function safeAudit(value,key=''){
  if(/password|secret|token|credential|access.?key|private.?key|凭据|密码|密钥/i.test(key))return '已隐藏';
  if(Array.isArray(value))return value.map(v=>safeAudit(v));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,safeAudit(v,k)]));
  if(typeof value==='string'&&/^data:image\//i.test(value))return '已更新图片';
  return value;
}

export default function SettingsApp({controlledState,onStateChange,onOpenOperations,sessionControls,active=true,page='general',onNavigate,onToast,onPlatformChange,onWorkspaceChange,datasets,versions,businessEvents=[],managedServices=[]}){
  const [localState,setLocalState]=useState(()=>({...clone(initialBasicState),...clone(initialResourceState),...clone(initialSecurityState),audit:clone(seedAudit)}));
  const state=controlledState||localState;const setState=onStateChange||setLocalState;
  const current=settingsPages.find(item=>item.id===page)||settingsPages[0];
  const [lastPages,setLastPages]=useState({basic:'general',resources:'model-services',security:'security'});
  const [menuOpen,setMenuOpen]=useState(false);
  useEffect(()=>{setLastPages(previous=>previous[current.group]===current.id?previous:{...previous,[current.group]:current.id});setMenuOpen(false)},[current.group,current.id]);
  useEffect(()=>{onPlatformChange?.(state.platform)},[state.platform,onPlatformChange]);
  useEffect(()=>{const demo=state.spaces?.find(space=>space.id==='demo');if(demo)onWorkspaceChange?.(demo)},[state.spaces,onWorkspaceChange]);
  const update=useCallback((key,value)=>setState(previous=>({...previous,[key]:typeof value==='function'?value(previous[key],previous):value})),[setState]);
  const logEvent=useCallback((event)=>{
    const record={id:`EV-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,at:new Date().toISOString(),actor:state.users.find(u=>u.id===state.currentActorId)?.name||'演示管理员',result:'成功',space:'演示空间',before:{},after:{},details:'',...safeAudit(event)};
    setState(previous=>({...previous,audit:[record,...previous.audit]}));
    return record;
  },[setState,state.currentActorId]);
  const navigate=useCallback((target)=>{if(settingsPages.some(item=>item.id===target))onNavigate(`settings-${target}`)},[onNavigate]);
  const visibleState=useMemo(()=>({...state,audit:[...businessEvents.map(event=>safeAudit(event)),...state.audit].sort((a,b)=>b.at.localeCompare(a.at))}),[state,businessEvents]);
  const value=useMemo(()=>({state:visibleState,setState,update,logEvent,notify:onToast,navigate,datasets,versions,managedServices,openBusiness:onNavigate,onOpenOperations,sessionControls}),[visibleState,update,logEvent,onToast,navigate,datasets,versions,managedServices,onNavigate,sessionControls]);
  return <SettingsContext.Provider value={value}><section className="st-shell" aria-label="系统设置">
    <div className="st-heading"><div><div className="st-heading-title"><h1>系统设置</h1><Badge dot={false}><IconShieldCheck size={13}/>平台范围</Badge></div><p>统一管理平台、资源与安全策略。</p></div></div>
    <button className="st-mobile-menu-button" aria-label="切换设置页面" aria-expanded={menuOpen} onClick={()=>setMenuOpen(!menuOpen)}><span>{current.title}</span><IconChevronDown size={17}/></button>
    <div className="st-layout"><aside className={`st-settings-nav ${menuOpen?'st-nav-open':''}`} aria-label="系统设置导航">
      <nav>{settingsMenu.map(group=><div className="st-nav-group" key={group.group}><h2>{group.label}</h2>{group.items.map(item=>{const Icon=item.icon;return <button type="button" className={`st-nav-item ${current.id===item.id?'active':''}`} aria-current={current.id===item.id?'page':undefined} key={item.id} onClick={()=>navigate(item.id)}><Icon size={22} stroke={1.6}/><span>{item.title}</span></button>})}</div>)}</nav>
      <div className="st-admin-caption"><IconLock size={17}/><span>当前角色：{state.roles.find(r=>r.id===state.members.find(m=>m.userId===state.currentActorId&&m.spaceId===state.currentSpaceId)?.roleId)?.name||'未授权'}</span></div>
    </aside>
    <div className="st-workarea">{['api','quotas','notifications','backups'].includes(current.id)&&<div className="cl-hint"><span>当前业务的授权、队列、告警和完整会话恢复已贯通。</span><button className="text-button" onClick={()=>onNavigate(current.id==='api'?'marketplace':'operations')}>打开业务控制台 →</button></div>}
      <div className="st-module" hidden={current.group!=='basic'}><SettingsBasic active={active&&current.group==='basic'} page={current.group==='basic'?current.id:lastPages.basic}/></div>
      <div className="st-module" hidden={current.group!=='resources'}><SettingsResources active={active&&current.group==='resources'} page={current.group==='resources'?current.id:lastPages.resources}/></div>
      <div className="st-module" hidden={current.group!=='security'}><SettingsSecurity active={active&&current.group==='security'} page={current.group==='security'?current.id:lastPages.security}/></div>
    </div></div>
  </section></SettingsContext.Provider>;
}
