// Exercise the production artifact under the same repository path as GitHub Pages.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import {decodeSnapshot} from '../src/persistence.js';
import {DEFAULT_BRAND_LOGO} from '../src/product-brand.js';

const root=path.resolve('dist/client'),base='/data-forge/',out='output/pages-browser';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2'};
await fs.mkdir(out,{recursive:true});
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(!pathname.startsWith(base)){res.writeHead(404);res.end();return;}
  const file=path.resolve(root,pathname.slice(base.length)||'index.html');
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(bytes);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}${base}`;
let browser,page;const errors=[],failedAssets=[];
try{
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--disable-gpu']});
 page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});page.setDefaultTimeout(15000);
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(response.status()>=400&&['script','stylesheet','font','image'].includes(response.request().resourceType()))failedAssets.push(response.url());});
 const saved=()=>page.getByRole('banner').getByText('已保存到本浏览器',{exact:true}).waitFor();
 const nav=async name=>{await page.getByLabel('搜索功能或数据集').fill(name);await page.locator('.search-results').getByRole('button',{name,exact:true}).click();};
 const click=name=>page.getByRole('button',{name,exact:true}).click();
 const persist=async action=>{const saving=page.getByRole('banner').getByText('正在自动保存',{exact:true}).waitFor();await action();await saving;await saved();};
 const checkDefaultLogo=async()=>{await page.waitForFunction(()=>{const image=document.querySelector('.brand img');return image?.complete&&image.naturalWidth>0;});assert.equal(new URL(await page.locator('.brand img').getAttribute('src'),url).pathname,base+'assets/brand-mark.png');};
 await page.goto(url,{waitUntil:'domcontentloaded'});await saved();await checkDefaultLogo();
 // The tour must be a keyboard-modal dialog: opening moves focus in, Tab cycles
 // inside its controls, Escape restores launch focus, and no business controls run.
 const launchTour=page.getByRole('button',{name:'打开全流程导览'});
 await launchTour.focus();await launchTour.click();
 const tour=page.getByRole('dialog',{name:'平台业务流程导览'});
 await tour.waitFor();
 const waitForClearTarget=()=>page.waitForFunction(()=>{
  const panel=document.querySelector('.tour-panel'),target=document.querySelector('.tour-highlight');
  if(!panel||!target||!target.getClientRects().length)return false;
  const box=panel.getBoundingClientRect(),highlight=target.getBoundingClientRect();
  const separate=box.right<=highlight.left||box.left>=highlight.right||
   box.bottom<=highlight.top||box.top>=highlight.bottom;
  return separate&&box.left>=0&&box.top>=0&&box.right<=innerWidth&&box.bottom<=innerHeight;
 });
 // Full flow must inspect the actual page, not repeatedly highlight first-level navigation.
 await tour.getByText('模块目标',{exact:true}).waitFor();
 await page.locator('.tour-highlight').waitFor();
 await waitForClearTarget();
 await tour.getByRole('button',{name:/下一步/}).click();
 await tour.getByText('关键操作',{exact:true}).waitFor();
 await page.waitForFunction(()=>{const target=document.querySelector('.tour-highlight');return target?.dataset.withinMain==='true'&&/(page-actions|pv-list-toolbar|cl-toolbar)/.test(target.dataset.targetClass||'')});
 await tour.getByRole('button',{name:/下一步/}).click();
 await tour.getByText('结果与追溯',{exact:true}).waitFor();
 await tour.getByRole('button',{name:/下一步/}).click();
 await tour.getByRole('heading',{name:'场景与项目'}).waitFor();
 await tour.getByText('模块目标',{exact:true}).waitFor();
 const projectsBeforePreview=await page.locator('.pv-compact-stats:visible').first().innerText();
 await tour.getByRole('button',{name:/下一步/}).click();
 await tour.getByText('关键操作',{exact:true}).waitFor();
 await tour.getByRole('button',{name:'查看真实操作表单（只读）'}).click();
 await tour.getByText('真实表单字段',{exact:false}).waitFor();
 const realProjectForm=page.locator('.main-content .p1-form:visible').first();
 await realProjectForm.waitFor();
 await page.getByRole('heading',{name:'新建生产任务'}).waitFor();
 await tour.locator('.tour-field-info strong').getByText('任务名称（必填）').waitFor();
 await tour.getByRole('button',{name:'下一个字段'}).click();
 assert.ok((await realProjectForm.boundingBox())?.width>0,'tour must open actual routed task form');
 await tour.getByRole('button',{name:'关闭表单预览'}).click();
 await page.getByRole('heading',{name:'任务管理'}).waitFor();
 await page.getByRole('heading',{name:'新建生产任务'}).waitFor({state:'hidden'});
 assert.equal(await page.locator('.pv-compact-stats:visible').first().innerText(),projectsBeforePreview,'read-only Tour must not create business tasks');

 const previewButton=tour.getByRole('button',{name:'查看真实操作表单（只读）'});
 assert.equal(await previewButton.evaluate(el=>el===document.activeElement),true,'closing preview must restore its surviving opener');
 await previewButton.click();
 await tour.getByText('真实表单字段',{exact:false}).waitFor();
 assert.equal(await tour.evaluate(el=>el.contains(document.activeElement)),true,'opening preview must retain Tour focus');
 await page.keyboard.press('Escape');
 await page.getByRole('heading',{name:'任务管理'}).waitFor();
 assert.equal(await previewButton.evaluate(el=>el===document.activeElement),true,'Escape must close only preview and restore its opener');
 assert.equal(await page.locator('.pv-compact-stats:visible').first().innerText(),projectsBeforePreview,'Escape preview must not create tasks');
 assert.equal(await tour.evaluate(el=>el.contains(document.activeElement)),true,'preview transitions must retain Tour focus');
 await tour.locator('.tour-small-actions button').last().focus();
 await page.keyboard.press('Tab');
 assert.equal(await tour.getByRole('button',{name:'关闭导览'}).evaluate(el=>el===document.activeElement),true,'Tab must wrap to first tour control');
 await page.keyboard.press('Shift+Tab');
 assert.equal(await tour.locator('.tour-small-actions button').last().evaluate(el=>el===document.activeElement),true,'Shift+Tab must wrap to last tour control');
 await page.keyboard.press('Escape');await tour.waitFor({state:'hidden'});
 assert.equal(await launchTour.evaluate(el=>el===document.activeElement),true,'closing tour must restore launch focus');

 // Routed preview cleanup must preserve destinations selected by Tour controls.
 await launchTour.click();
 const openTaskPreview=async()=>{
  await tour.locator('#tour-track').selectOption('data');
  await tour.getByRole('button',{name:'从头开始',exact:true}).click();
  await tour.getByRole('button',{name:/下一步/}).click();
  await tour.getByRole('button',{name:'查看真实操作表单（只读）'}).click();
  await tour.getByText('真实表单字段',{exact:false}).waitFor();
 };
 const assertCurrentTarget=async()=>{
  await page.waitForFunction(()=>{
   const mark=document.querySelector('.tour-highlight');
   return mark?.dataset.withinMain==='true'&&Number.parseFloat(mark.style.width)>10&&Number.parseFloat(mark.style.height)>10;
  });
 };
 await openTaskPreview();
 await tour.getByRole('button',{name:'跳到下一模块',exact:true}).click();
 await tour.getByRole('heading',{name:'定义任务',exact:true}).waitFor();
 await page.locator('.main-content .p1-form:visible').waitFor({state:'hidden'});
 await assertCurrentTarget();
 await openTaskPreview();
 await tour.locator('#tour-track').selectOption('knowledge');
 await tour.getByRole('heading',{name:'知识生产',exact:true}).waitFor();
 await assertCurrentTarget();
 await openTaskPreview();
 await tour.locator('#tour-track').selectOption('overview');
 await tour.getByRole('heading',{name:'全局工作台',exact:true}).waitFor();
 await assertCurrentTarget();
 // Visit work orders first so its cached hidden panel precedes deliveries.
 await tour.locator('#tour-track').selectOption('data');
 const assertNonemptyAction=async()=>{
  await page.waitForFunction(()=>{
   const mark=document.querySelector('.tour-highlight');
   return mark?.dataset.withinMain==='true'&&Number.parseFloat(mark.style.width)>10&&
    Number.parseFloat(mark.style.height)>10&&!/page-actions/.test(mark.dataset.targetClass||'');
  });
 };
 for(let module=0;module<11;module++){
  if(module===6){
   await tour.getByRole('button',{name:/下一步/}).click();
   await tour.getByText('关键操作',{exact:true}).waitFor();
   await assertNonemptyAction();
  }
  await tour.getByRole('button',{name:'跳到下一模块',exact:true}).click();
 }
 await tour.getByRole('heading',{name:'客户交付与售后',exact:true}).waitFor();
 await tour.getByRole('button',{name:/下一步/}).click();
 await assertNonemptyAction();
 await tour.getByRole('button',{name:'查看真实操作表单（只读）'}).click();
 await tour.getByText(/真实表单字段 1\//).waitFor();
 await assertCurrentTarget();
 await tour.getByRole('button',{name:'关闭导览',exact:true}).click();
 await tour.waitFor({state:'hidden'});

 // A real modal preview must not cover Tour controls or the field highlight.
 await launchTour.click();
 await tour.locator('#tour-track').selectOption('knowledge');
 await tour.getByRole('button',{name:/下一步/}).click();
 await tour.getByRole('button',{name:'查看真实操作表单（只读）'}).click();
 await page.locator('.modal-backdrop .modal:visible').waitFor();
 await tour.getByText(/真实表单字段 1\//).waitFor();
 assert.equal(await tour.evaluate(el=>el.parentElement===document.body),true,'Tour must escape the topbar stacking context');
 await page.waitForFunction(()=>{
  const root=document.querySelector('.tour-root'),modal=document.querySelector('.modal-backdrop');
  return root&&modal&&Number(getComputedStyle(root).zIndex)>Number(getComputedStyle(modal).zIndex);
 });
 const previewClose=tour.getByRole('button',{name:'关闭表单预览'});
 assert.equal(await previewClose.evaluate(el=>{
  const rect=el.getBoundingClientRect();
  return el.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
 }),true,'Tour preview controls must be topmost above the real modal');
 await waitForClearTarget();
 await tour.getByRole('button',{name:'下一个字段'}).click();
 await tour.getByText(/真实表单字段 2\//).waitFor();
 await waitForClearTarget();
 await page.setViewportSize({width:390,height:844});
 await waitForClearTarget();
 await previewClose.click();
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('.modal-backdrop .modal:visible').waitFor({state:'hidden'});
 await tour.getByRole('button',{name:'关闭导览',exact:true}).click();
 await tour.waitFor({state:'hidden'});

 await page.evaluate(()=>document.fonts.ready);
 await nav('基本设置');await page.getByRole('img',{name:'平台图标预览'}).waitFor();
 assert.equal(new URL(await page.getByRole('img',{name:'平台图标预览'}).getAttribute('src'),url).pathname,base+'assets/brand-mark.png');
 await page.getByLabel('平台说明').fill('Pages 子路径设置保存验证');await persist(()=>click('保存设置'));
 await nav('运营与恢复');const canonicalDownload=page.waitForEvent('download');await click('导出完整会话快照');await (await canonicalDownload).saveAs(`${out}/canonical-session.json`);
 assert.equal(decodeSnapshot(await fs.readFile(`${out}/canonical-session.json`,'utf8')).platform.settings.platform.logo,DEFAULT_BRAND_LOGO,'editing another setting must preserve the portable default logo marker');await nav('基本设置');
 await page.getByLabel('上传平台图标').setInputFiles(path.resolve('public/assets/brand-mark.png'));
 await page.waitForFunction(()=>document.querySelector('.sb-logo-preview img')?.getAttribute('src')?.startsWith('data:image/png'));
 await persist(()=>click('保存设置'));await page.waitForFunction(()=>document.querySelector('.brand img')?.getAttribute('src')?.startsWith('data:image/png'));
 await page.reload({waitUntil:'domcontentloaded'});await saved();assert.ok((await page.locator('.brand img').getAttribute('src')).startsWith('data:image/png'));
 await click('恢复默认图标');await persist(()=>click('保存设置'));await checkDefaultLogo();
 await nav('运营与恢复');const pending=page.waitForEvent('download');await click('导出完整会话快照');const download=await pending;await download.saveAs(`${out}/accepted-session.json`);
 const exported=decodeSnapshot(await fs.readFile(`${out}/accepted-session.json`,'utf8'));assert.equal(exported.platform.settings.platform.logo,DEFAULT_BRAND_LOGO,'default marker must stay compatible with old snapshots');
 const chooser=page.waitForEvent('filechooser');await click('选择完整快照恢复');await (await chooser).setFiles(`${out}/accepted-session.json`);await persist(()=>click('恢复此快照'));
 await page.reload({waitUntil:'domcontentloaded'});await saved();await checkDefaultLogo();
 await page.goto(url+'#settings/general',{waitUntil:'domcontentloaded'});await page.reload({waitUntil:'domcontentloaded'});await saved();await page.getByRole('img',{name:'平台图标预览'}).waitFor();await checkDefaultLogo();
 await page.screenshot({path:`${out}/desktop.png`,fullPage:true});await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>document.querySelector('.sidebar')?.getBoundingClientRect().right<=1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'mobile layout must fit');
 await page.screenshot({path:`${out}/mobile.png`,fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(failedAssets,[]);
 console.log('PASS: Pages subpath assets/fonts, settings hash refresh, custom/default logo, snapshot restore and mobile layout');
}catch(error){if(page){await page.screenshot({path:`${out}/failure.png`,fullPage:true}).catch(()=>{});await fs.writeFile(`${out}/failure.txt`,await page.locator('body').innerText().catch(()=>''));}throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
