# data-forge · 创平数智工场

源码仓库：[qq550723504/data-forge](https://github.com/qq550723504/data-forge)。用户已确认公开上传源码；本次未新增开源许可证。

**前端交互原型，尚未连接真实后端。** 模拟预标注、训练、评测、推理、部署、权限、API 授权和资源调度不是实际模型效果或服务器能力；无需配置模型密钥。package.json 的 private:true 只防止误发布到 npm，与 GitHub 可见性无关。

## 运行与构建

已验证 Node.js 24.18.1 / npm 11.16.0。

```bash
npm ci
npm run dev -- --host 127.0.0.1
```

开发地址以终端输出为准，通常为 http://127.0.0.1:5173/。

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

构建后预览地址为 http://127.0.0.1:4173/。本仓库没有部署步骤；.openai/hosting.json 仅保留原构建入口需要的空 d1/r2 配置。

## 本次上传范围

包含 src/ 实际应用源码、必要品牌图片和字体、第三方许可、构建/导出脚本、锁文件和测试源码。应用运行依赖的初始状态与示意图绘制模块仍保留在源码中，都是明确标识的演示；可启动空白/初始流程并自行导入 CSV/JSON、正文和图片。

**不附合成数据文件、演示会话快照、CSV 样例、压缩快照、ZIP、历史报告、核验日志、构建产物、缓存或 node_modules。** 原本机文件保留，本仓库不会自动下载、恢复或生成它们。没有已有会话的预置完整验收场景可直接导入。

## 验证及限制

先构建，再运行不依赖外部快照的源码回归：

```bash
npm run build
npm run test:source
npm run test:static
```

原项目 151 项完整回归和构建曾通过；本次不将其冒充不带合成数据的全量结果。按本仓库 94 文件清单建立的无快照副本已通过构建、test:source 的 104 项回归（0 失败/跳过）和 6 组 P1 静态渲染检查。test:source 保留自包含的文本、图片、模型、权限、原闭环、P1 状态和 4 项构建入口检查。静态渲染不等于浏览器交互验收，新 P1/AI/治理 UI 未新增浏览器实测。

以下完整验证源码仍保留，但需要本次明确排除的输入，源码版直接运行会缺少文件：

- tests/p1-integration.test.mjs：examples/completed-session.json，以及一项历史审查报告证据。
- tests/ai-annotation-flow.test.mjs、scripts/check-ai-static.mjs：examples/p1-completed-session.json。
- tests/governance-flow.test.mjs：examples/ai-completed-session.json。
- scripts/check-governance-static.mjs：examples/governance-completed-session.json 和 examples/ai-completed-session.json。
- npm run test:all / test:p1 / test:ai / test:governance / test:ai-static / test:governance-static 包含这些依赖，不能作为不带快照版本的一键全量验收。
- scripts/make-*-example.mjs 是原项目生成器源码，依次依赖被排除的上游会话，不能凭空重建缺失的初始会话。

## 功能范围

需求/指标版本、多源汇聚与冲突、独立增强、版本化质量规则、文本/图片标注审核发布；模型版本绑定和批量模拟 AI 标注；模拟训练评测与服务；文档问答/知识索引/智能体反馈闭环；立项责任、许可审批撤回、样本防污染和效果/成本证据。

IndexedDB 保存当前浏览器会话，跨电脑需用户自行导出/导入。存储 key 和内部演示 ID 保持兼容，example.com 邮箱与演示占位凭据均不是真实账号。当前没有 OCR、真实模型调用、训练权重、GPU 调度、服务器鉴权或外部服务接入。

离线单 HTML 导出需要先构建，然后运行 Python 3 标准库脚本 python scripts/make-portable.py。字体重新子集化另需 fontTools；普通启动和构建不需要 Python。

### 交付与验收原型（PR #9）

数模服务中心新增“交付与验收”。先发布通过质检的数据版本，并完成共享用途准入，再选择另一位具有该项目审核权限的成员作为客户验收人。登记外部交付包证据后提交，由指定成员签收或退回；退回后选择修订版本补交，原单与版本快照保留。已签收订单支持反馈、关联补交和处理关闭。工作台汇总交付待办，完整会话保存/恢复包含交付状态。

这是本地模拟流程：不传输文件、不发送客户通知、不提供服务器鉴权或真实客户签名。校验和与外部材料引用为人工登记，未验证文件内容。运行 `npm run build` 后执行 `npm run test:source`；专项测试为 `npm run test:delivery`。`npm run test:all` 会先从应用初始数据生成合成会话、运行 P1/AI 场景并构建，再执行全量测试；生成数据不是恢复的历史用户会话。单独生成示例可运行 `npm run test:fixtures`。浏览器验收使用 `npm run test:delivery-browser`，首次需 `npx playwright install chromium`；已有兼容 Chromium 时可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`。测试使用独立浏览器上下文，覆盖退回、补交、跨角色签收、反馈关闭、刷新恢复、空间隔离和移动端宽度。

### 生产工单与售后纠错（Issue #1，依赖 PR #9）

数据生产中心新增“生产工单”。负责人为整个未发布批次指定不同的标注人、审核人和期限；标注员领取后沿用现有文本/图片工作台操作，全部样本提交后进入批次审核。审核人逐条复核并运行质检，再通过工单验收，之后才允许发布。退回可提起争议，由第三位具备项目审核权限的成员决定继续返工或重新审核；仲裁不会自动通过样本。超时转派为负责人手工操作，保留历史。

交付页面的未关闭售后反馈可生成独立纠错批次及工单。纠错覆盖原冻结版本的全部记录，通过来源版本/记录 ID 保留关系，不继承原批次的 AI 预测接受状态。关联后必须以该工单验收后发布的版本补交，客户签收后才能关闭反馈。

验证命令：`npm run test:work-orders`、`npm run test:work-orders-browser`（Chromium 配置同交付浏览器测试）。旧批次未纳入工单时维持原流程。当前支持全量复核后的随机批次抽检；多级审批、自动调度/通知和真实后端仍待建设，Issue #1 尚未全部完成。

### 批次抽检与复检（Issue #1，依赖 PR #10）

创建工单时可启用抽检，配置比例、最低样本数和合格率阈值，分派后策略不可变更。先完成逐条审核及规则质检，再由指定审核人冻结随机抽检名单、样本内容与修订。样本数取比例向上取整与最低数量的较大值，上限为批次总数；使用 Web Crypto 随机洗牌，无放回抽取。每项结论需填写依据且不可覆盖，完成全部判定后计算合格率，不做四舍五入后比较。

不合格或数据变更后不能验收，也不能重新抽名单碰运气；必须退回返工、完成审核和质量检查，再启动新修订复检。历史轮次、失败依据及退回原因保留，刷新恢复会校验名单、判定和验收关联。旧工单不自动启用抽检。

验证：`npm run test:all`、`npm run test:sampling-browser`。这是本地原型的批次验收抽检，不宣称符合 AQL 或其他统计验收标准；仍要求先完成全部逐条审核，抽检由现有指定审核人执行，独立多级质检角色及服务端防篡改尚未实现。
