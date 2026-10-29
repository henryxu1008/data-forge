// Real Chromium UI flow with synthetic data in an isolated browser context.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {deliveryEligibility} from '../src/delivery-platform.js';
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {decodeSnapshot,encodeSnapshot} from '../src/persistence.js';
import {enableGovernance,applyGovernanceAction,sourceCatalog} from '../src/governance-state.js';
import {applyTextBatchAction} from '../src/text-production-state.js';
const p=enableGovernance(decodeSnapshot(await fs.readFile('examples/ai-completed-session.json','utf8')).platform);
let w=p.workspaces.demo;const at='2026-10-29T00:00:00Z';
const batch=Object.values(w.textBatches).find(b=>b.versions.length&&b.versions[0].qualitySnapshot?.status==='passed');assert.ok(batch);
const v1=batch.versions[0].id;
let b=batch;function data(type,extra={}){const r=applyTextBatchAction(b,{type,...extra,at});assert.equal(r.ok,true,r.error);b=r.batch;}
const row=b.records.find(r=>r.status==='approved');data('reopen',{taskId:row.id,note:'客户反馈纠错测试'});data('submit',{taskId:row.id,label:row.label,note:'重新核对'});data('approve',{taskId:row.id});data('checkQuality');data('publish',{note:'纠错补交版本'});w.textBatches[b.datasetId]=b;const v2=b.versions[0].id;
// Test-only assignment: give the reviewer this project, preserving the real role policy.
p.settings.members.find(m=>m.userId==='wangyue'&&m.spaceId==='demo').projectIds.push(b.projectId);
function gov(type,rest){const r=applyGovernanceAction(w,{type,...rest,at},{actorId:'henry',users:p.settings.users,canApproveUser:()=>true,isAdmin:true});assert.equal(r.ok,true,r.error);w=r.workspace;return r.entity;}
for(const project of w.production.projects){const c=gov('saveCharter',{projectId:project.id,goal:'合成验收',feasibility:'本地可复现',ownerId:'henry',approverId:'henry',qualityOwnerId:'wangyue',acceptanceText:'验证交付流程',exitConditions:'失败则退回'});gov('submitCharter',{charterId:c.id});gov('decideCharter',{charterId:c.id,decision:'approve',note:'测试批准'});}
for(const s of sourceCatalog(w)){const a=gov('saveAdmission',{sourceId:s.id,provider:'合成来源',licenseRef:'本地测试',purposeNote:'交付测试',purposes:['sharing'],validUntil:'2099-01-01T00:00:00Z',approverId:'henry'});gov('submitAdmission',{admissionId:a.id});gov('decideAdmission',{admissionId:a.id,decision:'approve',note:'测试批准'});}
p.workspaces.demo=w;assert.equal(deliveryEligibility(w,v1,b.projectId).ok,true,JSON.stringify(deliveryEligibility(w,v1,b.projectId)));const snapshot=encodeSnapshot(p);decodeSnapshot(snapshot);
const server=await createServer({server:{host:'127.0.0.1',port:0},optimizeDeps:{noDiscovery:true,include:[]}});await server.listen();
const address=server.httpServer.address(),url=`http://127.0.0.1:${address.port}`;
let browser;const errors=[];
try {
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});await page.getByLabel('模拟操作成员').waitFor();await page.getByRole('banner').getByText('已保存到本浏览器',{exact:true}).waitFor();
 await page.evaluate(async snapshot=>{const {decodeSnapshot,saveCurrent}=await import('/src/persistence.js');await saveCurrent(decodeSnapshot(snapshot).platform)},snapshot);await page.reload({waitUntil:'domcontentloaded',timeout:30000});
 const navigate=async name=>{await page.getByLabel('搜索功能或数据集').fill(name);await page.locator('.search-results').getByRole('button',{name,exact:true}).click();};
 const select=async id=>{await page.locator('.cl-list').getByRole('button').filter({hasText:`${id} ·`}).click()};
 const actor=async id=>{await page.getByLabel('模拟操作成员').selectOption(id);await navigate('交付与验收')};
 const note=page.getByLabel('操作说明 / 验收结论 / 退回原因');
 async function packageAndSubmit(){for(const [label,value] of [['校验和','sha256:test-evidence'],['质量报告引用','quality-test'],['许可说明引用','licence-test'],['文件清单（每行一个文件）','data.json\nlabels.json']])await page.getByLabel(label,{exact:true}).fill(value);await page.getByRole('button',{name:'保存交付证据',exact:true}).click();await page.getByRole('button',{name:'提交客户验收',exact:true}).click();}
 await navigate('交付与验收');await page.getByLabel('已通过质量与许可检查的发布版本').selectOption(v1);await page.getByLabel('客户验收成员').selectOption('wangyue');await page.getByRole('button',{name:'创建交付单',exact:true}).click();await packageAndSubmit();
 assert.equal(await page.getByRole('button',{name:'验收签收',exact:true}).count(),0,'producer must not accept');
 await actor('wangyue');await select('DLV-1');await note.fill('标签需重新核对');await page.getByRole('button',{name:'退回重做',exact:true}).click();
 await actor('henry');await select('DLV-1');await note.fill('重新核对并发布新版本');await page.getByLabel('修订后的发布版本').selectOption(v2);await page.getByRole('button',{name:'创建补交',exact:true}).click();await packageAndSubmit();
 await actor('wangyue');await select('DLV-2');await note.fill('补交验收通过');await page.getByRole('button',{name:'验收签收',exact:true}).click();
 await note.fill('补充售后核对');await page.getByRole('button',{name:'提交售后反馈',exact:true}).click();
 await actor('henry');await select('DLV-2');await note.fill('已核对，说明已补充');await page.getByRole('button',{name:'按处理说明关闭反馈',exact:true}).click();
 await page.getByRole('banner').getByText('已保存到本浏览器',{exact:true}).waitFor();await page.reload({waitUntil:'domcontentloaded',timeout:30000});await navigate('交付与验收');await select('DLV-2');assert.ok((await page.locator('.main-content').innerText()).includes('已关闭'));
 await page.getByLabel('当前业务空间').selectOption('quality');await navigate('交付与验收');await page.getByText('暂无交付单',{exact:true}).waitFor();
 await page.getByLabel('当前业务空间').selectOption('demo');await navigate('工作台');assert.equal(await page.locator('.cl-todo').filter({hasText:'DLV-'}).count(),0);
 await navigate('交付与验收');await select('DLV-2');await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1);
 for(const label of ['当前业务空间','模拟操作成员']){const box=await page.getByLabel(label).boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=390,`${label} must remain reachable`);}
 const panels=await page.locator('.main-content > div:not([hidden]) .cl-page .panel').evaluateAll(xs=>xs.map(x=>({width:x.getBoundingClientRect().width,right:x.getBoundingClientRect().right})));assert.ok(panels.every(p=>p.right<=391),JSON.stringify(panels));
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2);assert.equal(overflow,false,'mobile page must fit viewport');
 const output=process.env.DELIVERY_BROWSER_OUTPUT||'output/delivery-browser';await fs.mkdir(output,{recursive:true});await page.screenshot({path:`${output}/mobile.png`,fullPage:true,animations:'disabled'});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:`${output}/desktop.png`,fullPage:true,animations:'disabled'});assert.deepEqual(errors,[]);
 console.log('PASS: cross-role reject/revise/accept, feedback, refresh, workspace isolation, resolved todos and mobile layout');
} finally {await browser?.close();await server.close();}
