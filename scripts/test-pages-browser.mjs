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
 const checkDefaultLogo=async()=>{await page.waitForFunction(()=>{const image=document.querySelector('.brand img');return image?.complete&&image.naturalWidth>0;});assert.equal(new URL(await page.locator('.brand img').getAttribute('src'),url).pathname,base+'assets/brand-mark.png');};
 await page.goto(url,{waitUntil:'domcontentloaded'});await saved();await checkDefaultLogo();
 await page.evaluate(()=>document.fonts.ready);
 await nav('基本设置');await page.getByRole('img',{name:'平台图标预览'}).waitFor();
 assert.equal(new URL(await page.getByRole('img',{name:'平台图标预览'}).getAttribute('src'),url).pathname,base+'assets/brand-mark.png');
 await page.getByLabel('平台说明').fill('Pages 子路径设置保存验证');await click('保存设置');await saved();
 await nav('运营与恢复');const canonicalDownload=page.waitForEvent('download');await click('导出完整会话快照');await (await canonicalDownload).saveAs(`${out}/canonical-session.json`);
 assert.equal(decodeSnapshot(await fs.readFile(`${out}/canonical-session.json`,'utf8')).platform.settings.platform.logo,DEFAULT_BRAND_LOGO,'editing another setting must preserve the portable default logo marker');await nav('基本设置');
 await page.getByLabel('上传平台图标').setInputFiles(path.resolve('public/assets/brand-mark.png'));
 await page.waitForFunction(()=>document.querySelector('.sb-logo-preview img')?.getAttribute('src')?.startsWith('data:image/png'));
 await click('保存设置');await page.waitForFunction(()=>document.querySelector('.brand img')?.getAttribute('src')?.startsWith('data:image/png'));await saved();
 await page.reload({waitUntil:'domcontentloaded'});await saved();assert.ok((await page.locator('.brand img').getAttribute('src')).startsWith('data:image/png'));
 await click('恢复默认图标');await click('保存设置');await saved();await checkDefaultLogo();
 await nav('运营与恢复');const pending=page.waitForEvent('download');await click('导出完整会话快照');const download=await pending;await download.saveAs(`${out}/accepted-session.json`);
 const exported=decodeSnapshot(await fs.readFile(`${out}/accepted-session.json`,'utf8'));assert.equal(exported.platform.settings.platform.logo,DEFAULT_BRAND_LOGO,'default marker must stay compatible with old snapshots');
 const chooser=page.waitForEvent('filechooser');await click('选择完整快照恢复');await (await chooser).setFiles(`${out}/accepted-session.json`);await click('恢复此快照');await saved();
 await page.reload({waitUntil:'domcontentloaded'});await saved();await checkDefaultLogo();
 await page.goto(url+'#settings/general',{waitUntil:'domcontentloaded'});await page.reload({waitUntil:'domcontentloaded'});await saved();await page.getByRole('img',{name:'平台图标预览'}).waitFor();await checkDefaultLogo();
 await page.screenshot({path:`${out}/desktop.png`,fullPage:true});await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>document.querySelector('.sidebar')?.getBoundingClientRect().right<=1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'mobile layout must fit');
 await page.screenshot({path:`${out}/mobile.png`,fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(failedAssets,[]);
 console.log('PASS: Pages subpath assets/fonts, settings hash refresh, custom/default logo, snapshot restore and mobile layout');
}catch(error){if(page){await page.screenshot({path:`${out}/failure.png`,fullPage:true}).catch(()=>{});await fs.writeFile(`${out}/failure.txt`,await page.locator('body').innerText().catch(()=>''));}throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
