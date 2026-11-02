# ONCE

ONCE 前端现使用 React 19、TypeScript、Vite、React Router、Zustand、TanStack Query 和 Motion。后端继续使用 NestJS、Prisma 和 PostgreSQL。

## 前端开发

在项目根目录执行：

```sh
npm install
npm run dev
```

开发地址为 `http://127.0.0.1:5174/`。5173 已被其他本地项目使用；ONCE 使用固定的 5174，端口冲突时直接提示，不自动漂移。

开发服务器把 `/api` 代理到 `http://127.0.0.1:3000`，因此需要本地 API 和数据库处于运行状态。代理仅为已知本地开发来源改写 Origin，后端的跨站请求检查保留。

## 构建与检查

```sh
npm run build
```

`build` 先进行 TypeScript 严格类型检查，再生成 `dist/`。

NestJS 的静态资源入口已支持优先读取根目录 `dist/`，保留 `http://127.0.0.1:3000/` 访问方式。更新前端源文件后，需要重新构建才能更新 3000 上的页面。

## 源码结构

```text
src/
  main.tsx                    React 挂载、全局样式和 Query Provider
  app/
    App.tsx                   路由表、登录守卫、错误边界
    AppProvider.tsx           账户会话与通知、主题的挂载入口
    WorkspaceProvider.tsx     租约查询、按号码缓存、刷新和现有业务操作
  stores/
    ui-store.ts               主题、通知、选号草稿；组件按字段订阅
    workspace-store.ts        每个工作台独立的弹窗与租期选项
  pages/
    PublicPages.tsx           首页、帮助、登录和注册
    WizardPage.tsx            地区、租期、号码选择与现有确认流程
    OverviewPage.tsx          总览
    NumbersPage.tsx           号码列表与详情
    MessagesPages.tsx         收件箱和独立发送页面
    AccountPages.tsx          套餐、账单、设置和语音占位
  components/                 页面壳、号码选择器、复制、租期环、弹层
  lib/
    api.ts                    请求封装、QueryClient、会话失效和幂等请求
    queries.ts                查询键、查询配置、详情缓存复用及已读缓存更新
    models.ts                 数据类型、状态计算和账户隔离的存储键
  react.css                   React 状态边界的少量适配样式
```

原有 `styles.css`、`assets/ux/workspace.css` 和 `assets/ux/product-ui.css` 继续提供现有视觉体系。正式页面由 React 渲染；`assets/ux/` 下的 `workspace.js`、`events.js` 只供本地演示页使用。

保留 Hash URL，例如 `/#/app/inbox?leaseId=...` 和 `/#/app/send?leaseId=...&compose=mms`。旧收件箱 `compose` 链接会转入发送页面。

## 管理后台

`/#/admin` 是运营人员使用的管理后台，代码在 `src/admin/`，以懒加载方式载入，不计入 C 端首屏。页面包括概览、用户、号码库存、租约、订单、短信记录、Webhook 事件和操作日志。所有写操作都要填写原因、带幂等键，并记入审计日志。布局参考 LinePool 管理后台。

后端接口契约见 [docs/ONCE-ADMIN-API.md](docs/ONCE-ADMIN-API.md)。后端接入前，用 `npm run dev:admin-mock` 加载 `src/admin/mock.ts` 中的演示数据（仅开发环境，不会打进生产包）。用户的 `role` 为 `ADMIN` 时，用户工作台账户菜单中会出现「管理后台」入口。

## 状态管理与缓存

- Zustand 负责共享界面状态；主题沿用原存储格式。通知、弹窗和选号草稿保留在内存中，不存储账号凭据或接口数据。退出、会话过期及更换已有账号会清理草稿；未登录选号后登录继续保留当前流程。
- TanStack Query 是账号、号码详情和库存的唯一接口缓存。号码键按数据来源、账号、号码隔离；切号取消旧请求，首次默认详情可直接复用到对应号码 URL。
- 详情沿用 60 秒新鲜期和原 5 秒轮询，打开弹窗或执行操作时暂停轮询；只有工具栏订阅后台请求进度。库存使用 30 秒新鲜期，并保留手动刷新和售罄冲突后的重新读取。
- 标记已读仍使用原本地保存机制，成功后只更新对应账号、号码的缓存，不重新读取详情。写入失败时显示原错误提示；没有增加跨设备同步。
- 网络、超时及 5xx 读取错误最多自动重试一次；鉴权、业务校验错误、中止和写操作不自动重试。

## 预览和业务边界

`http://127.0.0.1:3000/assets/ux/demo.html?scenario=common#/app/inbox` 为原有浏览器演示入口。它与真实 API 数据源分开，用于界面检查；演示数据不能证明真实号码开通、付款或短信接收已经接入。

SMS 发送、发送记录、状态查询与签名发送回执已实现。账户模式下可进行明确标注的演示发送；真实发送需配置 PingCode 账号、API Key、API 基地址和发送回调密钥，并绑定有效的上游号码。MMS、语音和真实支付仍未接通。浏览器独立预览不调用发送接口。

## 同一 Wi-Fi / 局域网访问

本机作为服务器运行时，同事使用本机的 Wi-Fi IPv4 地址访问，例如 `http://192.168.0.107:3000/`。`127.0.0.1` 始终指访问者自己的电脑。

在项目目录运行局域网启动脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-lan.ps1
```

脚本默认从 `WLAN` 获取 IPv4，输出实际访问地址；也可以传入 `-Address 192.168.0.107 -InterfaceAlias WLAN`。它启动已有本地 PostgreSQL（如已停止），将当前 `backend/dist/main.js` API 监听地址设为 `0.0.0.0:3000`，并把 `APP_ORIGIN` 设置成相同局域网地址，保留登录等写请求的来源校验。环境覆盖仅作用于该服务进程，不修改 `.env` 或执行数据库迁移。脚本只会停止 ONCE 当前 API 或旧兼容 API 的 3000 进程，不会终止占用该端口的其他程序。

首次访问或 Wi-Fi IP 变更后，在**管理员 PowerShell**运行（地址替换为启动脚本输出值）：

```powershell
powershell -ExecutionPolicy Bypass -File D:\once\scripts\allow-lan-firewall.ps1 -Address 192.168.0.107 -InterfaceAlias WLAN
```

防火墙规则 `ONCE-LAN-3000` 仅允许本地子网通过该 Wi-Fi 接口、本机指定 IP 和 TCP 3000 访问 Node；不关闭防火墙、不开放数据库端口、不改变 Windows 网络类别。IP 变更后重新执行这两个命令。

自己和同事都应使用同一个局域网地址；从 `127.0.0.1` 切换地址后需重新登录。保持本机开机、不休眠且服务运行。客户端需位于可互通的同一局域网，访客 Wi-Fi 或路由器的客户端隔离可能阻止连接。当前仍为本地演示模式；后端和数据库版本见下节。

## 当前本地后端运行说明

3000 已切换到当前 `backend/dist/main.js`。本地 `once` 数据库已执行 `202610190001_lifecycle_history_fulfillment` 和 `202610190002_pc_resource_inbox`，与 `backend/prisma/schema.prisma` 对齐。

新增 PC 账号/号码映射、上游状态和资源期限；短信与回调按账号去重；数据库约束阻止号码租期重叠和跨账号短信归属。旧数据保留，原始字段逐表数量与内容摘要核对一致。

后端在 `backend/` 执行 `npm run db:generate`、`npm run build`。PC 正式同步、Webhook 接口和真实支付仍待接入。
