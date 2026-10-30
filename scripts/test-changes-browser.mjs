// Real Chromium UI flow with synthetic data in an isolated browser context.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';
import {decodeSnapshot,encodeSnapshot} from '../src/persistence.js';
import {enableGovernance,applyGovernanceAction,sourceCatalog} from '../src/governance-state.js';
const p=enableGovernance(decodeSnapshot(await fs.readFile('examples/ai-completed-session.json','utf8')).platform);
let w=p.workspaces.demo;const at='2026-10-29T00:00:00Z';
function gov(type,rest){const r=applyGovernanceAction(w,{type,...rest,at},{actorId:'henry',users:p.settings.users,canApproveUser:()=>true,isAdmin:true});assert.equal(r.ok,true,r.error);w=r.workspace;return r.entity;}
for(const project of w.production.projects){const c=gov('saveCharter',{projectId:project.id,goal:'合成验收',feasibility:'本地可复现',ownerId:'henry',approverId:'henry',qualityOwnerId:'wangyue',acceptanceText:'验证交付流程',exitConditions:'失败则退回'});gov('submitCharter',{charterId:c.id});gov('decideCharter',{charterId:c.id,decision:'approve',note:'测试批准'});}
for(const s of sourceCatalog(w)){const a=gov('saveAdmission',{sourceId:s.id,provider:'合成来源',licenseRef:'本地测试',purposeNote:'交付测试',purposes:['sharing','annotation','serving'],validUntil:'2099-01-01T00:00:00Z',approverId:'henry'});gov('submitAdmission',{admissionId:a.id});gov('decideAdmission',{admissionId:a.id,decision:'approve',note:'测试批准'});}
p.settings.members.find(m=>m.userId==='wangyue'&&m.spaceId==='demo').projectIds=w.production.projects.map(p=>p.id);
p.workspaces.demo=w;const snapshot=encodeSnapshot(p);decodeSnapshot(snapshot);
const server=await createServer({server:{host:'127.0.0.1',port:0},optimizeDeps:{noDiscovery:true,include:[]}});await server.listen();
let browser;const errors=[];
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`,{waitUntil:'domcontentloaded',timeout:30000});await page.getByRole('banner').getByText('已保存到本浏览器',{exact:true}).waitFor();
 await page.evaluate(async snapshot=>{const {decodeSnapshot,saveCurrent}=await import('/src/persistence.js');await saveCurrent(decodeSnapshot(snapshot).platform)},snapshot);await page.reload({waitUntil:'domcontentloaded',timeout:30000});
 const navigate=async name=>{await page.getByLabel('搜索功能或数据集').fill(name);await page.locator('.search-results').getByRole('button',{name,exact:true}).click();};
 const changes=async()=>{await navigate('立项与验收治理');await page.getByLabel('治理关联项目').selectOption('PRJ-001');await page.getByRole('tab',{name:'变更与重验',exact:true}).click();};
 await changes();await page.getByLabel('变更数据来源').selectOption('data:customer');await page.getByLabel('变更类型').selectOption('spec');await page.getByLabel('事件唯一键').fill('browser-spec-v2');await page.getByLabel('变更版本引用').fill('分类规范-v2');await page.getByLabel('变更原因').fill('明确售后与商品标签边界');
 await page.getByRole('button',{name:'登记变更并生成重验待办',exact:true}).click();await page.getByRole('button',{name:'登记变更并生成重验待办',exact:true}).click();
 assert.equal(await page.getByLabel(/^重验说明 GOV-CHANGE-/).count(),1);
 await page.getByLabel(/^重验说明 GOV-CHANGE-/).fill('核对所有影响资产');await page.getByLabel(/^证据引用 GOV-CHANGE-/).fill('review-record-v2');await page.getByRole('button',{name:'记录重验通过',exact:true}).click();await page.getByRole('alert').filter({hasText:'质量负责人'}).waitFor();
 await navigate('工作台');await page.getByRole('button').filter({hasText:'资产变更待重验'}).click();await page.getByRole('button',{name:'登记变更并生成重验待办',exact:true}).waitFor();
 await page.getByLabel('模拟操作成员').selectOption('wangyue');await changes();await page.getByLabel(/^重验说明 GOV-CHANGE-/).fill('存在边界不清样本');await page.getByRole('button',{name:'记录重验失败',exact:true}).click();await page.getByRole('button',{name:'重试重验',exact:true}).waitFor();
 await page.getByRole('banner').getByText('已保存到本浏览器',{exact:true}).waitFor();await page.reload({waitUntil:'domcontentloaded',timeout:30000});await changes();await page.getByLabel(/^重验说明 GOV-CHANGE-/).fill('完成重新核对，重试');await page.getByRole('button',{name:'重试重验',exact:true}).click();
 await page.getByLabel(/^重验说明 GOV-CHANGE-/).fill('逐项核对冻结影响清单，无需修改历史版本');await page.getByLabel(/^证据引用 GOV-CHANGE-/).fill('review-record-v2:完整影响清单逐项人工复核');await page.getByRole('button',{name:'记录重验通过',exact:true}).click();await page.getByText('重验通过（人工复核）',{exact:true}).waitFor();
 await page.getByRole('banner').getByText('已保存到本浏览器',{exact:true}).waitFor();await page.reload({waitUntil:'domcontentloaded',timeout:30000});await changes();await page.getByText('重验通过（人工复核）',{exact:true}).waitFor();
 await fs.mkdir('output/changes-browser',{recursive:true});await page.screenshot({path:'output/changes-browser/desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector('.sidebar')?.getBoundingClientRect().right<=0&&document.documentElement.scrollWidth<=innerWidth+1);await page.screenshot({path:'output/changes-browser/mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'mobile horizontal overflow');
 await page.setViewportSize({width:1440,height:1000});await navigate('工作台');assert.equal(await page.getByRole('button').filter({hasText:'资产变更待重验'}).count(),0);
 assert.deepEqual(errors,[]);console.log('PASS change UI: duplicate, permission denial, todo navigation, failure, retry, evidence review, refresh, desktop/mobile');
}finally{await browser?.close();await server.close();}
