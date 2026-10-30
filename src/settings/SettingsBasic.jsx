import React, {useEffect, useMemo, useRef, useState} from 'react';
import {IconBuilding, IconUsers, IconUser, IconUserPlus, IconCrown, IconShieldCheck, IconEye, IconCube, IconChevronRight, IconChevronDown, IconPlus, IconLock, IconHistory, IconCheck, IconUpload, IconDots, IconAlertCircle, IconSettings, IconMail, IconClock, IconInfoCircle} from '@tabler/icons-react';
import {Button, Badge, Field, Modal, Search, Empty, Tabs} from '../ui.jsx';
import {useSettings} from './context.jsx';
import {DEFAULT_BRAND_LOGO,brandLogoUrl} from '../product-brand.js';
import './basic.css';

const permissions = [
  ['edit','编辑生产'], ['train','训练与评测'], ['run','业务调用'], ['view', '查看样本'], ['export', '批量导出'], ['approve', '审核通过'],
  ['publish', '发布版本'], ['reject', '退回修改'], ['members', '管理成员']
];
const projectScopeLabel = value => ({authorized:'已授权项目',owned:'本人负责且已授权的项目'}[value]||'未设置');
const sampleScopeLabel = value => ({assigned:'分配给本人的待审样本',project:'已授权项目内的样本'}[value]||'未设置');
const newId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const copy = value => JSON.parse(JSON.stringify(value));
const stamp = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Singapore', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'}).format(new Date());
const makeRole = (id,name,description,granted,extra={}) => ({id,name,description,builtIn:false,scope:'space',permissions:granted,projectScope:'authorized',sampleScope:'assigned',preventSelfReview:true,requireRejectReason:true,...extra});

export const initialBasicState = {
  platform:{name:'创平数智工场',organization:'示例企业',description:'企业数据准备、模型开发与智能应用平台。',language:'zh-CN',timezone:'Asia/Singapore',logo:DEFAULT_BRAND_LOGO},
  organizations:[
    {id:'org-root',name:'示例企业',parentId:null},
    {id:'org-data',name:'数据运营部',parentId:'org-root'},
    {id:'org-algo',name:'算法研发部',parentId:'org-root'},
    {id:'org-app',name:'应用服务部',parentId:'org-root'}
  ],
  spaces:[
    {id:'demo',name:'演示空间',organizationId:'org-data',ownerId:'henry',purpose:'数据准备与应用验证',visibility:'members',status:'active'},
    {id:'quality',name:'质量审核空间',organizationId:'org-data',ownerId:'wangyue',purpose:'标注复核与质量检查',visibility:'members',status:'active'}
  ],
  users:[
    {id:'henry',name:'演示管理员',email:'henry@example.com',status:'active'},
    {id:'zhangmin',name:'张敏',email:'zhangmin@example.com',status:'active'},
    {id:'wangyue',name:'王越',email:'wangyue@example.com',status:'active'},
    {id:'liyi',name:'李一',email:'liyi@example.com',status:'active'},
    {id:'chensi',name:'陈思',email:'chensi@example.com',status:'active'},
    {id:'linyue',name:'林悦',email:'linyue@example.com',status:'active'}
  ],
  projects:[
    {id:'industrial',name:'工业质检项目',spaceId:'demo'},
    {id:'customer',name:'客服语料项目',spaceId:'demo'},
    {id:'knowledge',name:'知识助手项目',spaceId:'demo'},
    {id:'quality-industrial',name:'工业质检复核',spaceId:'quality'},
    {id:'quality-customer',name:'客服语料复核',spaceId:'quality'}
  ],
  members:[
    {id:'m-demo-henry',userId:'henry',spaceId:'demo',roleId:'space-admin',projectIds:['industrial','customer','knowledge'],status:'active'},
    {id:'m-demo-zhangmin',userId:'zhangmin',spaceId:'demo',roleId:'project-manager',projectIds:['industrial','customer'],status:'active'},
    {id:'m-demo-wangyue',userId:'wangyue',spaceId:'demo',roleId:'reviewer',projectIds:['industrial'],status:'active'},
    {id:'m-demo-liyi',userId:'liyi',spaceId:'demo',roleId:'annotator',projectIds:['customer'],status:'active'},
    {id:'m-quality-henry',userId:'henry',spaceId:'quality',roleId:'space-admin',projectIds:[],status:'active'},
    {id:'m-quality-zhangmin',userId:'zhangmin',spaceId:'quality',roleId:'project-manager',projectIds:['quality-industrial','quality-customer'],status:'active'},
    {id:'m-quality-wangyue',userId:'wangyue',spaceId:'quality',roleId:'space-admin',projectIds:['quality-industrial','quality-customer'],status:'active'},
    {id:'m-quality-liyi',userId:'liyi',spaceId:'quality',roleId:'annotator',projectIds:['quality-customer'],status:'active'},
    {id:'m-quality-chensi',userId:'chensi',spaceId:'quality',roleId:'reviewer',projectIds:['quality-industrial'],status:'active'},
    {id:'m-quality-linyue',userId:'linyue',spaceId:'quality',roleId:'viewer',projectIds:['quality-industrial'],status:'active'}
  ],
  invitations:[],
  roles:[
    makeRole('platform-admin','平台管理员','管理平台与全局资源，业务数据仍按授权范围访问。',['view','edit','train','run','export','approve','publish','reject','members'],{builtIn:true,scope:'platform',sampleScope:'project'}),
    makeRole('space-admin','空间管理员','管理空间成员与协作资源。',['view','edit','train','run','export','approve','reject','publish','members'],{builtIn:true,sampleScope:'project'}),
    makeRole('project-manager','项目负责人','组织项目生产、管理任务与交付。',['view','edit','train','run','export','publish'],{sampleScope:'project'}),
    makeRole('reviewer','审核专家','负责检查标注结果并通过或退回样本。',['view','run','approve','reject']),
    makeRole('annotator','标注员','完成分配的标注任务，提交专家审核。',['view','edit','run']),
    makeRole('viewer','只读成员','查看已获授权的项目样本与结果。',['view'],{sampleScope:'project'})
  ],
  currentSpaceId:'demo',
  pendingMemberInviteSpaceId:null
};

function Title({title,description,actions,inlineActions=false}) {
  return <header className="sb-heading"><div className="sb-heading-copy"><div className="sb-title-line"><h2>{title}</h2>{inlineActions&&actions&&<div className="sb-heading-actions">{actions}</div>}</div>{description&&<p>{description}</p>}</div>{!inlineActions&&actions&&<div className="sb-heading-actions">{actions}</div>}</header>;
}
function Section({title,children}) {return <section className="sb-section"><h3><span>{title}</span></h3>{children}</section>}
function Notice({children,tone=''}) {return <div className={`sb-notice ${tone}`}><IconShieldCheck size={20} stroke={1.5}/><span>{children}</span></div>}
function Drawer({children,...props}) {return <div className="sb-drawer-host"><Modal {...props}>{children}</Modal></div>}
function Toggle({label,description,value,onChange,disabled}) {return <label className={`sb-toggle-row ${disabled?'disabled':''}`}><span><strong>{label}</strong>{description&&<small>{description}</small>}</span><input role="switch" type="checkbox" checked={value} disabled={disabled} onChange={e=>onChange(e.target.checked)}/><span className="sb-toggle-visual" aria-hidden="true"/></label>}
function Person({user,isMe=false}) {return <div className="sb-person"><span className="sb-avatar">{(user.name.match(/[A-Za-z]/)?.[0]||user.name.slice(0,1)).toUpperCase()}</span><span><strong>{user.name}{isMe&&<em>我</em>}</strong><small>{user.email}</small></span></div>}
function roleIcon(id){return id==='platform-admin'?IconCrown:id==='space-admin'?IconUsers:id==='reviewer'?IconShieldCheck:id==='viewer'?IconEye:IconUser}
function orgPath(orgs,id){const node=orgs.find(x=>x.id===id);if(!node)return '';return node.parentId?`${orgPath(orgs,node.parentId)} / ${node.name}`:node.name}
function projectNames(state,ids){return ids.map(id=>state.projects.find(p=>p.id===id)?.name||id).join('、')||'未授权项目'}
function roleName(state,id){return state.roles.find(r=>r.id===id)?.name||'未分配'}

export default function SettingsBasic({page='general',active=true}) {
  return <>
    <div hidden={page!=='general'}><GeneralPage active={active&&page==='general'}/></div>
    <div hidden={page!=='organizations'}><OrganizationsPage active={active&&page==='organizations'}/></div>
    <div hidden={page!=='members'}><MembersPage active={active&&page==='members'}/></div>
    <div hidden={page!=='roles'}><RolesPage active={active&&page==='roles'}/></div>
  </>;
}

function GeneralPage() {
  const {state,setState,logEvent,notify}=useSettings();
  const [form,setForm]=useState(()=>copy(state.platform));
  const fileRef=useRef(null);
  useEffect(()=>setForm(copy(state.platform)),[state.platform]);
  const dirty=JSON.stringify(form)!==JSON.stringify(state.platform);
  const change=(key,value)=>setForm(p=>({...p,[key]:value}));
  const save=()=>{
    if(!form.name.trim())return;
    const next={...form,name:form.name.trim(),organization:form.organization.trim()||'示例企业'};
    const before={平台名称:state.platform.name,组织名称:state.platform.organization,平台说明:state.platform.description||'未填写',平台图标:state.platform.logo===DEFAULT_BRAND_LOGO?'默认图标':'自定义图标',默认语言:state.platform.language,时区:state.platform.timezone};
    setState(prev=>({...prev,platform:next,organizations:prev.organizations.map(o=>o.id==='org-root'?{...o,name:next.organization}:o)}));
    logEvent({action:'修改平台设置',object:next.name,space:'平台范围',before,after:{平台名称:next.name,组织名称:next.organization,平台说明:next.description||'未填写',平台图标:next.logo===DEFAULT_BRAND_LOGO?'默认图标':next.logo!==state.platform.logo?'自定义图标（已更新）':'自定义图标',默认语言:next.language,时区:next.timezone},details:'平台设置已在本次演示中保存。'});
    notify('平台设置已保存，顶栏品牌已同步');
  };
  const chooseLogo=e=>{
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    if(file.type!=='image/png'||file.size>2*1024*1024){notify('请选择不超过 2 MB 的 PNG 图片','warning');return}
    const reader=new FileReader();reader.onerror=()=>notify('图片读取失败，请重新选择','warning');
    reader.onload=()=>{const img=new Image();img.onerror=()=>notify('无法读取这张 PNG 图片','warning');img.onload=()=>{change('logo',reader.result);notify('图标已预览，保存设置后生效')};img.src=reader.result};reader.readAsDataURL(file);
  };
  return <section className="panel sb-page sb-general">
    <Title title="基本设置" description="设置平台信息与默认使用偏好。" inlineActions actions={<Badge tone="amber" dot={false}><IconLock size={13}/>仅管理员可修改</Badge>}/>
    <div className="sb-form-body">
      <Section title="平台信息">
        <div className="sb-logo-setting"><span className="sb-label">平台图标</span><div className="sb-logo-preview"><img src={brandLogoUrl(form.logo)} alt="平台图标预览"/></div><div><Button variant="outline" onClick={()=>fileRef.current?.click()}>更换图标</Button><p>建议使用正方形 PNG 图片，不超过 2 MB。</p>{form.logo!==DEFAULT_BRAND_LOGO&&<button className="text-button sb-small-link" onClick={()=>change('logo',DEFAULT_BRAND_LOGO)}>恢复默认图标</button>}</div><input ref={fileRef} className="sb-file-input" type="file" accept="image/png" aria-label="上传平台图标" onChange={chooseLogo}/></div>
        <div className="sb-form-grid"><Field label="平台名称" required><input value={form.name} maxLength={20} onChange={e=>change('name',e.target.value)}/></Field><Field label="组织名称"><input value={form.organization} maxLength={30} onChange={e=>change('organization',e.target.value)}/></Field></div>
        <Field label="平台说明"><textarea rows={3} value={form.description} maxLength={300} onChange={e=>change('description',e.target.value)}/></Field>
      </Section>
      <Section title="区域与显示"><div className="sb-form-grid"><Field label="默认语言"><select value={form.language} onChange={e=>change('language',e.target.value)}><option value="zh-CN">简体中文</option><option value="en-US">English（配置示例）</option></select></Field><Field label="时区"><select value={form.timezone} onChange={e=>change('timezone',e.target.value)}><option value="Asia/Singapore">UTC+08:00 北京 / 新加坡</option><option value="UTC">UTC+00:00 协调世界时</option><option value="Asia/Tokyo">UTC+09:00 东京</option></select></Field></div><p className="sb-help">语言与时区作为平台偏好保存；本原型的界面文案仍为中文。</p></Section>
    </div>
    <footer className="sb-footer"><span>{dirty?'有未保存的修改':'此处修改平台默认设置，项目配置在对应业务页面管理。'}</span><div><Button disabled={!dirty} onClick={()=>setForm(copy(state.platform))}>取消修改</Button><Button variant="primary" disabled={!dirty||!form.name.trim()} onClick={save}>保存设置</Button></div></footer>
  </section>;
}

function OrganizationsPage({active}) {
  const {state,setState,update,logEvent,notify,navigate}=useSettings();
  const [selectedOrg,setSelectedOrg]=useState('org-data'),[expanded,setExpanded]=useState(['org-root']),[query,setQuery]=useState('');
  const [orgModal,setOrgModal]=useState(false),[orgForm,setOrgForm]=useState({name:'',parentId:'org-root'});
  const [spaceForm,setSpaceForm]=useState(null),[addMembers,setAddMembers]=useState(true);
  useEffect(()=>{if(!active){setOrgModal(false);setSpaceForm(null)}},[active]);
  const orgIds=useMemo(()=>{const result=[selectedOrg];let changed=true;while(changed){changed=false;state.organizations.forEach(o=>{if(result.includes(o.parentId)&&!result.includes(o.id)){result.push(o.id);changed=true}})}return result},[state.organizations,selectedOrg]);
  const visibleSpaces=state.spaces.filter(s=>orgIds.includes(s.organizationId)&&s.name.toLowerCase().includes(query.toLowerCase()));
  const organization=state.organizations.find(o=>o.id===selectedOrg);
  const orgDuplicate=state.organizations.some(o=>o.parentId===orgForm.parentId&&o.name===orgForm.name.trim());
  const spaceDuplicate=!!spaceForm&&state.spaces.some(s=>s.id!==spaceForm.id&&s.organizationId===spaceForm.organizationId&&s.name===spaceForm.name.trim());
  const createOrg=()=>{if(!orgForm.name.trim()||orgDuplicate)return;const record={id:newId('org'),name:orgForm.name.trim(),parentId:orgForm.parentId};update('organizations',list=>[...list,record]);setExpanded(list=>[...new Set([...list,record.parentId])]);setSelectedOrg(record.id);setOrgModal(false);logEvent({action:'新增组织',object:record.name,after:{上级组织:orgPath(state.organizations,record.parentId)}});notify('组织已创建')};
  const openSpace=(space=null)=>{setSpaceForm(space?{...space}:{name:'',organizationId:selectedOrg,ownerId:'zhangmin',purpose:'',visibility:'members',status:'active'});setAddMembers(!space)};
  const saveSpace=()=>{
    if(!spaceForm?.name.trim()||!spaceForm.ownerId||spaceDuplicate)return;
    const isNew=!spaceForm.id,record={...spaceForm,id:spaceForm.id||newId('space'),name:spaceForm.name.trim()};
    const original=state.spaces.find(s=>s.id===record.id);
    setState(prev=>{
      const ownerMembership=prev.members.find(m=>m.spaceId===record.id&&m.userId===record.ownerId);
      const members=ownerMembership?prev.members.map(m=>m.id===ownerMembership.id?{...m,roleId:'space-admin',status:'active'}:m):[...prev.members,{id:newId('member'),userId:record.ownerId,spaceId:record.id,roleId:'space-admin',projectIds:[],status:'active'}];
      return {...prev,spaces:isNew?[...prev.spaces,record]:prev.spaces.map(s=>s.id===record.id?record:s),members,currentSpaceId:isNew&&addMembers?record.id:prev.currentSpaceId,pendingMemberInviteSpaceId:isNew&&addMembers?record.id:prev.pendingMemberInviteSpaceId};
    });
    logEvent({action:isNew?'创建工作空间':'修改工作空间',object:record.name,space:record.name,before:original?{名称:original.name,所属组织:orgPath(state.organizations,original.organizationId),负责人:state.users.find(u=>u.id===original.ownerId)?.name||'未分配',空间用途:original.purpose||'未填写'}: {},after:{名称:record.name,所属组织:orgPath(state.organizations,record.organizationId),负责人:state.users.find(u=>u.id===record.ownerId)?.name||'未分配',空间用途:record.purpose||'未填写'},details:'空间负责人以空间管理员身份加入，项目数据单独授权。'});
    setSpaceForm(null);notify(isNew?'工作空间已创建':'工作空间已更新');if(isNew&&addMembers)navigate('members');
  };
  const tree=(parentId=null,depth=0)=>state.organizations.filter(o=>o.parentId===parentId).map(o=>{
    const hasChildren=state.organizations.some(n=>n.parentId===o.id),isExpanded=expanded.includes(o.id);
    return <React.Fragment key={o.id}><div className={`sb-org-row ${selectedOrg===o.id?'selected':''}`} style={{paddingLeft:`${12+depth*13}px`}}><button className="sb-tree-expander" aria-label={`${isExpanded?'收起':'展开'}${o.name}`} disabled={!hasChildren} onClick={()=>setExpanded(old=>isExpanded?old.filter(id=>id!==o.id):[...old,o.id])}>{hasChildren?(isExpanded?<IconChevronDown size={15}/>:<IconChevronRight size={15}/>):<IconBuilding size={16}/>}</button><button className="sb-org-select" onClick={()=>setSelectedOrg(o.id)}><IconUsers size={19}/><span>{o.name}</span></button></div>{hasChildren&&isExpanded&&tree(o.id,depth+1)}</React.Fragment>;
  });
  return <section className="panel sb-page">
    <Title title="组织与空间" description="管理组织归属、协作空间与负责人。"/>
    <div className="sb-org-layout"><aside className="sb-org-tree"><div className="sb-subheading"><h3>组织结构</h3><Button className="button-sm" icon={IconPlus} onClick={()=>{setOrgForm({name:'',parentId:selectedOrg});setOrgModal(true)}}>新增</Button></div><p className="sb-help">按组织查看所属空间。</p><div role="navigation" aria-label="组织结构">{tree()}</div></aside>
      <div className="sb-org-content"><div className="sb-space-toolbar"><div><h3>{organization?.name||'全部空间'}</h3><span>共 {visibleSpaces.length} 个空间</span></div><Search placeholder="搜索空间名称" value={query} onChange={setQuery}/><Button variant="outline" icon={IconPlus} onClick={()=>openSpace()}>新建空间</Button></div>
      {visibleSpaces.length?<div className="sb-table-scroll"><table className="sb-space-table"><thead><tr><th>空间名称</th><th>负责人</th><th>成员</th><th>状态</th><th>操作</th></tr></thead><tbody>{visibleSpaces.map(space=><tr key={space.id}><td><div className="sb-space-name"><IconCube size={22}/><span><strong>{space.name}</strong><small>{space.purpose||'尚未填写空间用途'}</small></span></div></td><td>{state.users.find(u=>u.id===space.ownerId)?.name||'未分配'}</td><td>{state.members.filter(m=>m.spaceId===space.id&&m.status==='active'&&state.users.find(u=>u.id===m.userId)?.status==='active').length} 人</td><td><span className="sb-status">正常</span></td><td><div className="sb-row-actions"><button className="text-button" onClick={()=>{update('currentSpaceId',space.id);navigate('members')}}>管理成员</button><button className="icon-button" aria-label={`编辑${space.name}`} onClick={()=>openSpace(space)}><IconDots size={18}/></button></div></td></tr>)}</tbody></table></div>:<Empty title={query?'未找到匹配空间':'此组织还没有空间'} description={query?'调整搜索词，或查看其他组织。':'创建一个工作空间，让成员开始协作。'}><Button variant="outline" onClick={()=>query?setQuery(''):openSpace()}>{query?'清除搜索':'新建空间'}</Button></Empty>}
      <Notice>空间成员与项目访问权限分别授权。</Notice></div></div>
    {orgModal&&<Modal title="新增组织" description="在当前组织下添加部门或团队。" onClose={()=>setOrgModal(false)} footer={<><Button onClick={()=>setOrgModal(false)}>取消</Button><Button variant="primary" disabled={!orgForm.name.trim()||orgDuplicate} onClick={createOrg}>创建组织</Button></>}><Field label="组织名称" required><input placeholder="例如：数据交付组" maxLength={30} value={orgForm.name} onChange={e=>setOrgForm(p=>({...p,name:e.target.value}))}/></Field><Field label="上级组织"><select value={orgForm.parentId} onChange={e=>setOrgForm(p=>({...p,parentId:e.target.value}))}>{state.organizations.map(o=><option key={o.id} value={o.id}>{orgPath(state.organizations,o.id)}</option>)}</select></Field>{orgDuplicate&&<p className="sb-error" role="alert">上级组织下已有同名组织。</p>}</Modal>}
    {spaceForm&&<Drawer title={spaceForm.id?'编辑空间':'新建空间'} description="为团队创建独立的协作空间。" onClose={()=>setSpaceForm(null)} footer={<><Button onClick={()=>setSpaceForm(null)}>取消</Button><Button variant="primary" disabled={!spaceForm.name.trim()||spaceDuplicate||!spaceForm.ownerId} onClick={saveSpace}>{spaceForm.id?'保存空间':'创建空间'}</Button></>}><Field label="空间名称" required><input maxLength={30} value={spaceForm.name} placeholder="工业质检空间" onChange={e=>setSpaceForm(p=>({...p,name:e.target.value}))}/></Field>{spaceDuplicate&&<p className="sb-error" role="alert">该组织下已有同名空间。</p>}<Field label="所属组织" required><select value={spaceForm.organizationId} onChange={e=>setSpaceForm(p=>({...p,organizationId:e.target.value}))}>{state.organizations.map(o=><option key={o.id} value={o.id}>{orgPath(state.organizations,o.id)}</option>)}</select></Field><Field label="空间负责人" required hint="负责人作为空间管理员加入，项目权限另行配置。"><select value={spaceForm.ownerId} onChange={e=>setSpaceForm(p=>({...p,ownerId:e.target.value}))}>{state.users.filter(u=>u.status==='active').map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></Field><Field label="空间用途"><textarea rows={3} maxLength={200} value={spaceForm.purpose} placeholder="工业图片标注、专家复核与数据交付。" onChange={e=>setSpaceForm(p=>({...p,purpose:e.target.value}))}/></Field><Field label="可见范围" hint="其他成员需受邀加入。"><select value={spaceForm.visibility} onChange={e=>setSpaceForm(p=>({...p,visibility:e.target.value}))}><option value="members">仅空间成员可见</option></select></Field>{!spaceForm.id&&<label className="sb-check-line"><input type="checkbox" checked={addMembers} onChange={e=>setAddMembers(e.target.checked)}/>创建后添加成员</label>}</Drawer>}
  </section>;
}

function MembersPage({active}) {
  const {state,setState,update,logEvent,notify}=useSettings();
  const [tab,setTab]=useState('members'),[query,setQuery]=useState(''),[roleFilter,setRoleFilter]=useState('all');
  const [inviting,setInviting]=useState(false),[inviteForm,setInviteForm]=useState({email:'',roleId:'reviewer',projectIds:['industrial']});
  const [edit,setEdit]=useState(null),[menu,setMenu]=useState(null),[remove,setRemove]=useState(null);
  const currentSpace=state.spaces.find(s=>s.id===state.currentSpaceId)||state.spaces[0];
  const spaceId=currentSpace?.id||'demo';
  const spaceProjects=state.projects.filter(p=>p.spaceId===spaceId);
  const spaceRoles=state.roles.filter(r=>r.scope!=='platform');
  const matchingUser=user=>`${user.name} ${user.email}`.toLowerCase().includes(query.trim().toLowerCase());
  const rows=state.members.filter(m=>m.spaceId===spaceId&&(roleFilter==='all'||m.roleId===roleFilter)).filter(m=>{const user=state.users.find(u=>u.id===m.userId);return user&&matchingUser(user)});
  const users=state.users.filter(matchingUser);
  const invitations=state.invitations.filter(i=>i.spaceId===spaceId&&i.email.toLowerCase().includes(query.toLowerCase()));
  const openInvite=()=>{setInviteForm({email:'',roleId:'reviewer',projectIds:spaceProjects[0]?[spaceProjects[0].id]:[]});setInviting(true);setMenu(null)};
  useEffect(()=>{if(!active){setInviting(false);setEdit(null);setMenu(null);setRemove(null)}},[active]);
  useEffect(()=>{if(active&&state.pendingMemberInviteSpaceId===spaceId){setTab('members');setInviteForm({email:'',roleId:'reviewer',projectIds:spaceProjects[0]?[spaceProjects[0].id]:[]});setInviting(true);update('pendingMemberInviteSpaceId',null)}},[active,state.pendingMemberInviteSpaceId,spaceId]);
  useEffect(()=>{setQuery('');setRoleFilter('all');setMenu(null)},[spaceId]);
  const isLastAdmin=member=>member.roleId==='space-admin'&&state.members.filter(m=>m.spaceId===member.spaceId&&m.roleId==='space-admin'&&m.status==='active'&&state.users.find(u=>u.id===m.userId)?.status==='active').length<=1;
  const protectedReason=member=>member.userId==='henry'?'当前账号不能停用或移除。':state.spaces.find(s=>s.id===member.spaceId)?.ownerId===member.userId?'请先在组织与空间中转交空间负责人。':isLastAdmin(member)?'空间至少保留一位可用的管理员。':'';
  const userProtected=user=>user.id==='henry'?'当前账号不能停用。':state.spaces.some(s=>s.ownerId===user.id)?'请先转交该账号负责的空间。':state.members.some(m=>m.userId===user.id&&isLastAdmin(m))?'该账号是某个空间的最后一位管理员。':'';
  const toggleMember=member=>{const blocked=member.status==='active'?protectedReason(member):'';if(blocked){notify(blocked,'warning');return}const status=member.status==='active'?'suspended':'active';update('members',list=>list.map(m=>m.id===member.id?{...m,status}:m));const user=state.users.find(u=>u.id===member.userId);logEvent({action:status==='active'?'启用空间成员':'停用空间成员',object:user.name,space:currentSpace.name,before:{状态:member.status},after:{状态:status}});notify(status==='active'?'成员已启用':'成员已停用');setMenu(null)};
  const toggleUser=user=>{const blocked=user.status==='active'?userProtected(user):'';if(blocked){notify(blocked,'warning');return}const status=user.status==='active'?'suspended':'active';update('users',list=>list.map(u=>u.id===user.id?{...u,status}:u));logEvent({action:status==='active'?'启用平台账号':'停用平台账号',object:user.name,before:{状态:user.status},after:{状态:status}});notify(status==='active'?'账号已启用':'账号已停用')};
  const email=inviteForm.email.trim().toLowerCase(),validEmail=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const existingUser=state.users.find(u=>u.email.toLowerCase()===email);
  const alreadyMember=!!existingUser&&state.members.some(m=>m.spaceId===spaceId&&m.userId===existingUser.id);
  const alreadyPending=state.invitations.some(i=>i.spaceId===spaceId&&i.email===email&&i.status==='pending');
  const sendInvite=()=>{if(!validEmail||alreadyMember||alreadyPending)return;const record={id:newId('invite'),email,spaceId,roleId:inviteForm.roleId,projectIds:inviteForm.projectIds.filter(id=>spaceProjects.some(p=>p.id===id)),status:'pending',createdAt:stamp()};update('invitations',list=>[record,...list]);logEvent({action:'创建成员邀请',object:email,space:currentSpace.name,after:{角色:roleName(state,record.roleId),项目:projectNames(state,record.projectIds)},details:'仅创建本地演示邀请，未发送邮件。'});setInviting(false);setTab('invitations');notify('本地邀请已创建，可在邀请记录中模拟接受')};
  const acceptInvite=invitation=>{
    const user=state.users.find(u=>u.email.toLowerCase()===invitation.email);
    if(user?.status==='suspended'){notify('该平台账号已停用，请先启用账号','warning');return}
    if(state.members.some(m=>m.spaceId===invitation.spaceId&&m.userId===user?.id)){notify('该账号已经是空间成员','warning');return}
    const newUser=user||{id:newId('user'),name:invitation.email.split('@')[0],email:invitation.email,status:'active'};
    const member={id:newId('member'),userId:newUser.id,spaceId:invitation.spaceId,roleId:invitation.roleId,projectIds:[...invitation.projectIds],status:'active'};
    setState(prev=>({...prev,users:user?prev.users:[...prev.users,newUser],members:[...prev.members,member],invitations:prev.invitations.map(i=>i.id===invitation.id?{...i,status:'accepted',acceptedAt:stamp()}:i)}));
    logEvent({action:'接受成员邀请',object:newUser.name,space:currentSpace.name,after:{角色:roleName(state,member.roleId),项目:projectNames(state,member.projectIds)},details:'受邀人接受流程由本地模拟。'});notify('已模拟接受邀请，成员列表已更新');setTab('members');setQuery('');setRoleFilter('all');
  };
  const revokeInvite=invitation=>{update('invitations',list=>list.map(i=>i.id===invitation.id?{...i,status:'cancelled'}:i));logEvent({action:'撤销成员邀请',object:invitation.email,space:currentSpace.name});notify('本地邀请已撤销')};
  const saveGrant=()=>{
    if(!edit)return;const current=state.members.find(m=>m.id===edit.id),user=state.users.find(u=>u.id===edit.userId);
    if(current.roleId==='space-admin'&&edit.roleId!=='space-admin'&&(isLastAdmin(current)||current.userId==='henry'||currentSpace.ownerId===current.userId)){notify('当前成员的管理员角色需要保留','warning');return}
    const value={...edit,projectIds:edit.projectIds.filter(id=>spaceProjects.some(p=>p.id===id))};
    update('members',list=>list.map(m=>m.id===value.id?value:m));logEvent({action:'调整项目授权',object:user.name,space:currentSpace.name,before:{空间角色:roleName(state,current.roleId),授权项目:projectNames(state,current.projectIds)},after:{空间角色:roleName(state,value.roleId),授权项目:projectNames(state,value.projectIds)},details:'角色与项目授权共同限定当前空间内的数据访问。'});setEdit(null);notify('成员角色与项目授权已更新');
  };
  const confirmRemove=()=>{if(!remove)return;const blocked=protectedReason(remove);if(blocked){notify(blocked,'warning');setRemove(null);return}const user=state.users.find(u=>u.id===remove.userId);update('members',list=>list.filter(m=>m.id!==remove.id));logEvent({action:'移除空间成员',object:user.name,space:currentSpace.name,before:{角色:roleName(state,remove.roleId),项目:projectNames(state,remove.projectIds)},after:{成员状态:'已移除'}});setRemove(null);notify('成员已从当前空间移除')};
  const projectChecks=(ids,onChange)=> <div className="sb-project-checks">{spaceProjects.length?spaceProjects.map(p=><label key={p.id}><input type="checkbox" checked={ids.includes(p.id)} onChange={e=>onChange(e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/><span>{p.name}</span></label>):<p className="sb-help">此空间暂无项目，可先邀请成员，后续再分配项目访问权限。</p>}</div>;
  const roleSummary=state.roles.find(r=>r.id===inviteForm.roleId);
  return <section className="panel sb-page sb-members">
    <Title title="用户与成员" description="管理成员身份、空间角色与项目授权。"/>
    <Tabs items={[{id:'users',label:'平台用户'},{id:'members',label:'空间成员'},{id:'invitations',label:'邀请记录',count:state.invitations.filter(i=>i.spaceId===spaceId&&i.status==='pending').length||undefined}]} value={tab} onChange={value=>{setTab(value);setMenu(null)}}/>
    <div className="sb-member-toolbar">{tab!=='users'&&<label className="sb-inline-field"><span>当前空间：</span><select aria-label="成员管理空间" value={spaceId} onChange={e=>update('currentSpaceId',e.target.value)}>{state.spaces.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}<Search value={query} onChange={setQuery} placeholder="搜索姓名或邮箱"/>{tab==='members'&&<select aria-label="筛选成员角色" value={roleFilter} onChange={e=>setRoleFilter(e.target.value)}><option value="all">全部角色</option>{spaceRoles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>}{tab!=='users'&&<Button variant="outline" icon={IconUserPlus} onClick={openInvite}>邀请成员</Button>}</div>
    {tab==='members'&&(rows.length?<div className="sb-table-scroll"><table className="sb-member-table"><thead><tr><th>成员</th><th>空间角色</th><th>已授权项目</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.map(member=>{const user=state.users.find(u=>u.id===member.userId),reason=protectedReason(member),enabled=member.status==='active'&&user.status==='active';return <tr key={member.id}><td><Person user={user} isMe={user.id==='henry'}/></td><td>{roleName(state,member.roleId)}</td><td title={projectNames(state,member.projectIds)}>{member.projectIds.length>1?`${member.projectIds.length} 个项目`:projectNames(state,member.projectIds)}</td><td><span className={`sb-status ${enabled?'':'muted'}`}>{enabled?'已加入':user.status!=='active'?'账号停用':'已停用'}</span></td><td><div className="sb-row-actions"><button className="text-button" onClick={()=>{setEdit(copy(member));setMenu(null)}}>编辑授权</button><div className="sb-more-wrap"><button className="icon-button" aria-label={`${user.name}的更多操作`} aria-expanded={menu===member.id} onClick={()=>setMenu(menu===member.id?null:member.id)}><IconDots size={18}/></button>{menu===member.id&&<div className="sb-action-menu"><button disabled={member.status==='active'&&!!reason} title={reason} onClick={()=>toggleMember(member)}>{member.status==='active'?'停用成员':'启用成员'}</button><button disabled={!!reason} title={reason} onClick={()=>{setRemove(member);setMenu(null)}}>移除空间</button>{reason&&<small>{reason}</small>}</div>}</div></div></td></tr>})}</tbody></table></div>:<Empty title="没有匹配的空间成员" description="调整搜索或角色筛选，也可以邀请新成员。"><Button onClick={()=>{setQuery('');setRoleFilter('all')}}>清除筛选</Button></Empty>)}
    {tab==='users'&&(users.length?<div className="sb-table-scroll"><table><thead><tr><th>平台用户</th><th>平台角色</th><th>已加入空间</th><th>状态</th><th>操作</th></tr></thead><tbody>{users.map(user=><tr key={user.id}><td><Person user={user} isMe={user.id==='henry'}/></td><td>{user.id==='henry'?'平台管理员':'普通用户'}</td><td>{state.members.filter(m=>m.userId===user.id).length} 个空间</td><td><span className={`sb-status ${user.status==='active'?'':'muted'}`}>{user.status==='active'?'已启用':'已停用'}</span></td><td><button className="text-button" disabled={user.status==='active'&&!!userProtected(user)} title={userProtected(user)} onClick={()=>toggleUser(user)}>{user.status==='active'?'停用账号':'启用账号'}</button></td></tr>)}</tbody></table></div>:<Empty title="没有匹配的账号"/>)}
    {tab==='invitations'&&(invitations.length?<div className="sb-table-scroll"><table><thead><tr><th>邀请邮箱</th><th>角色与项目</th><th>创建时间</th><th>状态</th><th>操作</th></tr></thead><tbody>{invitations.map(invitation=><tr key={invitation.id}><td>{invitation.email}</td><td><strong className="sb-cell-title">{roleName(state,invitation.roleId)}</strong><small className="sb-cell-note">{projectNames(state,invitation.projectIds)}</small></td><td>{invitation.createdAt}</td><td><Badge tone={invitation.status==='pending'?'amber':invitation.status==='accepted'?'mint':'gray'}>{invitation.status==='pending'?'待接受':invitation.status==='accepted'?'已接受':'已撤销'}</Badge></td><td>{invitation.status==='pending'?<div className="sb-row-actions sb-wrap"><button className="text-button" onClick={()=>acceptInvite(invitation)}>模拟接受</button><button className="text-button" onClick={()=>revokeInvite(invitation)}>撤销</button></div>:<span className="muted">已处理</span>}</td></tr>)}</tbody></table></div>:<Empty title="暂无邀请记录" description="邀请会保存在本次演示中，不发送真实邮件。"><Button variant="outline" onClick={openInvite}>邀请成员</Button></Empty>)}
    <div className="sb-table-foot"><span>{tab==='members'?`共 ${rows.length} 位空间成员`:tab==='users'?`共 ${users.length} 位平台用户`:`共 ${invitations.length} 条邀请记录`}</span><span className="sb-page-number">1</span></div>
    <Notice>{tab==='invitations'?'邀请仅在本地模拟，可通过“模拟接受”体验完整流程。':'角色决定可执行操作，项目授权决定可访问范围。'}</Notice>
    {inviting&&<Drawer title="邀请成员" description="邀请加入当前工作空间。" onClose={()=>setInviting(false)} footer={<><Button onClick={()=>setInviting(false)}>取消</Button><Button variant="primary" disabled={!validEmail||alreadyMember||alreadyPending} onClick={sendInvite}>发送邀请</Button></>}><Field label="邮箱" required><input type="email" value={inviteForm.email} placeholder="chenyu@example.com" onChange={e=>setInviteForm(p=>({...p,email:e.target.value}))}/></Field>{(alreadyMember||alreadyPending)&&<p className="sb-error" role="alert">{alreadyMember?'该账号已在当前空间，请使用编辑授权。':'此邮箱已有待接受邀请。'}</p>}<Field label="加入空间"><input value={currentSpace.name} readOnly/></Field><Field label="空间角色" required hint={roleSummary?.description}><select value={inviteForm.roleId} onChange={e=>setInviteForm(p=>({...p,roleId:e.target.value}))}>{spaceRoles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field><h3 className="sb-small-title">授权项目</h3>{projectChecks(inviteForm.projectIds,ids=>setInviteForm(p=>({...p,projectIds:ids})))}<p className="sb-help">已选 {inviteForm.projectIds.length} 个项目{!inviteForm.projectIds.length?'，暂不授予项目数据访问。':'。'}</p><Section title="授权摘要"><div className="sb-summary"><strong>{roleName(state,inviteForm.roleId)} · {inviteForm.projectIds.length?projectNames(state,inviteForm.projectIds):'未授权项目'}</strong><p>范围：{!inviteForm.projectIds.length?'暂无项目数据访问':roleSummary?.sampleScope==='assigned'?'分配给本人的样本':'已授权项目的样本'}。</p></div><p className="sb-help sb-with-icon"><IconInfoCircle size={17}/>受邀人接受后加入空间。本次只模拟邀请。</p></Section></Drawer>}
    {edit&&<Drawer title="编辑成员授权" description={`${state.users.find(u=>u.id===edit.userId)?.name} · ${currentSpace.name}`} onClose={()=>setEdit(null)} footer={<><Button onClick={()=>setEdit(null)}>取消</Button><Button variant="primary" onClick={saveGrant}>保存授权</Button></>}><Field label="空间角色" required><select value={edit.roleId} disabled={currentSpace.ownerId===edit.userId||edit.userId==='henry'} onChange={e=>setEdit(p=>({...p,roleId:e.target.value}))}>{spaceRoles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></Field><h3 className="sb-small-title">授权项目</h3>{projectChecks(edit.projectIds,ids=>setEdit(p=>({...p,projectIds:ids})))}<p className="sb-help">已选 {edit.projectIds.length} 个项目。未勾选的项目不授予数据访问。</p><Notice>保存后更新当前空间内的成员权限，并记录到审计日志。</Notice></Drawer>}
    {remove&&<Modal title="移除空间成员" description={`将 ${state.users.find(u=>u.id===remove.userId)?.name} 从“${currentSpace.name}”移除。`} onClose={()=>setRemove(null)} footer={<><Button onClick={()=>setRemove(null)}>取消</Button><Button variant="danger" onClick={confirmRemove}>确认移除</Button></>}><p>移除后，该成员在当前空间的角色和项目授权将被撤销。其平台账号及其他空间成员关系保留。</p></Modal>}
  </section>;
}

function RolesPage({active}) {
  const {state,update,logEvent,notify}=useSettings();
  const [selectedId,setSelectedId]=useState('reviewer'),[form,setForm]=useState(()=>copy(state.roles.find(r=>r.id==='reviewer'))),[tab,setTab]=useState('permissions');
  const [creating,setCreating]=useState(false),[newRole,setNewRole]=useState({name:'',description:''});
  const selected=state.roles.find(r=>r.id===selectedId)||state.roles[0];
  useEffect(()=>{if(selected)setForm(copy(selected))},[selected]);
  useEffect(()=>{if(!active)setCreating(false)},[active]);
  const dirty=JSON.stringify(form)!==JSON.stringify(selected),locked=selected.builtIn;
  const choose=id=>{setSelectedId(id);setTab('permissions')};
  const setPermission=(id,checked)=>{setForm(prev=>{let list=checked?[...prev.permissions,id]:prev.permissions.filter(p=>p!==id);if(checked&&['approve','reject','export'].includes(id)&&!list.includes('view'))list.push('view');if(id==='view'&&!checked)list=list.filter(p=>!['approve','reject','export'].includes(p));return {...prev,permissions:[...new Set(list)]}})};
  const save=()=>{if(locked||!dirty)return;update('roles',list=>list.map(r=>r.id===form.id?copy(form):r));logEvent({action:'修改角色权限',object:form.name,space:'平台范围',before:{功能权限:permissions.filter(([id])=>selected.permissions.includes(id)).map(([,name])=>name).join('、'),项目范围:projectScopeLabel(selected.projectScope),样本范围:sampleScopeLabel(selected.sampleScope),禁止本人审核:selected.preventSelfReview,退回必须说明:selected.requireRejectReason},after:{功能权限:permissions.filter(([id])=>form.permissions.includes(id)).map(([,name])=>name).join('、'),项目范围:projectScopeLabel(form.projectScope),样本范围:sampleScopeLabel(form.sampleScope),禁止本人审核:form.preventSelfReview,退回必须说明:form.requireRejectReason},details:'角色配置已在平台范围更新，适用于使用此角色的空间成员；各空间的项目授权范围独立保留。'});notify('角色权限已保存')};
  const duplicate=state.roles.some(r=>r.name===newRole.name.trim());
  const createRole=()=>{if(!newRole.name.trim()||duplicate)return;const role=makeRole(newId('role'),newRole.name.trim(),newRole.description.trim()||'自定义空间角色。',['view']);update('roles',list=>[...list,role]);setSelectedId(role.id);setCreating(false);setTab('permissions');logEvent({action:'创建角色',object:role.name,after:{角色范围:'空间',初始权限:'查看样本'}});notify('自定义角色已创建，可继续配置权限')};
  const roleMembers=state.members.filter(m=>m.roleId===selected.id);
  const audit=(state.audit||[]).filter(e=>e.object===selected.name&&/角色|权限/.test(e.action||''));
  return <section className="panel sb-page sb-role-layout">
    <aside className="sb-role-list"><div className="sb-subheading"><h3>角色 ({state.roles.length})</h3><Button variant="outline" className="button-sm" icon={IconPlus} onClick={()=>{setNewRole({name:'',description:''});setCreating(true)}}>新建角色</Button></div><div aria-label="角色列表">{state.roles.map(role=>{const Icon=roleIcon(role.id);return <button key={role.id} className={`sb-role-item ${selected.id===role.id?'selected':''}`} onClick={()=>choose(role.id)}><Icon size={23} stroke={1.5}/><span>{role.name}</span>{role.builtIn&&<IconLock size={16}/>}</button>})}</div><p className="sb-role-caption">按职责分配角色。</p></aside>
    <div className="sb-role-content"><Title title={selected.name} description={selected.description} inlineActions actions={<Badge tone={locked?'gray':'amber'} dot={false}>{locked?'内置角色':'自定义角色'}</Badge>}/><Tabs items={[{id:'permissions',label:'权限配置'},{id:'members',label:'角色成员'},{id:'history',label:'变更记录'}]} value={tab} onChange={setTab}/>
      {tab==='permissions'&&<><div className="sb-role-form">{locked&&<div className="sb-inline-notice"><IconLock size={17}/><span>内置管理员角色仅可查看，可新建自定义角色后配置权限。</span></div>}<Section title="功能权限"><p className="sb-help">标注审核相关操作。</p><div className="sb-permission-grid">{permissions.map(([id,name])=><label key={id}><input type="checkbox" checked={form.permissions.includes(id)} disabled={locked} onChange={e=>setPermission(id,e.target.checked)}/><span>{name}</span></label>)}</div></Section><Section title="数据范围"><div className="sb-form-grid"><Field label="项目范围"><select value={form.projectScope} disabled={locked} onChange={e=>setForm(p=>({...p,projectScope:e.target.value}))}><option value="authorized">已授权项目</option><option value="owned">本人负责且已授权的项目</option></select></Field><Field label="样本范围"><select value={form.sampleScope} disabled={locked} onChange={e=>setForm(p=>({...p,sampleScope:e.target.value}))}><option value="assigned">分配给本人的待审样本</option><option value="project">已授权项目内的样本</option></select></Field></div><p className="sb-help">实际数据范围由角色权限与成员的项目授权共同确定。</p></Section><Section title="审核规则"><Toggle label="禁止审核本人提交的标注" description="保持标注与审核相互独立。" value={form.preventSelfReview} disabled={locked} onChange={value=>setForm(p=>({...p,preventSelfReview:value}))}/><Toggle label="退回时必须填写原因" description="便于标注人员准确修改。" value={form.requireRejectReason} disabled={locked} onChange={value=>setForm(p=>({...p,requireRejectReason:value}))}/></Section></div><footer className="sb-footer"><span className="sb-with-icon"><IconHistory size={18}/>{dirty?'有未保存的权限修改':'权限变更将记录到审计日志'}</span><div><Button disabled={!dirty||locked} onClick={()=>setForm(copy(selected))}>取消修改</Button><Button variant="primary" disabled={!dirty||locked} onClick={save}>保存权限</Button></div></footer></>}
      {tab==='members'&&(roleMembers.length?<div className="sb-tab-body sb-table-scroll"><table><thead><tr><th>成员</th><th>所属空间</th><th>授权项目</th><th>状态</th></tr></thead><tbody>{roleMembers.map(m=>{const user=state.users.find(u=>u.id===m.userId);return <tr key={m.id}><td>{user?.name}</td><td>{state.spaces.find(s=>s.id===m.spaceId)?.name}</td><td>{projectNames(state,m.projectIds)}</td><td>{m.status==='active'&&user?.status==='active'?'已启用':'已停用'}</td></tr>})}</tbody></table></div>:<Empty title="此角色暂无空间成员" description="可以在用户与成员页面为成员分配该角色。"/>)}
      {tab==='history'&&(audit.length?<div className="sb-tab-body"><div className="sb-history-list">{audit.map(event=><div key={event.id}><IconHistory size={20}/><div><strong>{event.action}</strong><p>{event.actor||'演示管理员'} · {event.at||event.time||'本次演示'}</p><small>{event.details||'角色权限配置已更新。'}</small></div><Badge tone="mint">{event.result||'成功'}</Badge></div>)}</div></div>:<Empty title="暂无角色变更记录" description="保存角色配置后，可在这里查看操作记录。"/>)}
    </div>
    {creating&&<Modal title="新建角色" description="创建可用于空间成员分配的业务角色。" onClose={()=>setCreating(false)} footer={<><Button onClick={()=>setCreating(false)}>取消</Button><Button variant="primary" disabled={!newRole.name.trim()||duplicate} onClick={createRole}>创建角色</Button></>}><Field label="角色名称" required><input value={newRole.name} maxLength={20} placeholder="例如：质量复核员" onChange={e=>setNewRole(p=>({...p,name:e.target.value}))}/></Field><Field label="角色说明"><textarea rows={3} maxLength={150} value={newRole.description} placeholder="说明职责与适用场景。" onChange={e=>setNewRole(p=>({...p,description:e.target.value}))}/></Field>{duplicate&&<p className="sb-error" role="alert">角色名称已存在。</p>}<Notice>新角色初始仅允许查看已授权样本，可创建后继续配置。</Notice></Modal>}
  </section>;
}
