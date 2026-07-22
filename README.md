# Flux · RSS 信息聚合

可部署到 **Cloudflare Pages** 的 RSS / Atom 信息聚合阅读器。前端采用 Emil Kowalski 设计工程风格 + **液态玻璃（Liquid Glass）** 材质：半透明表面、高光边缘、饱和模糊与克制的交互动效。

## 功能

- 添加 / 管理多个 RSS · Atom 订阅源
- Cloudflare Pages Function 服务端代理解析（绕过浏览器 CORS）
- 文章列表、正文阅读、未读 / 收藏筛选、本地搜索
- 订阅与阅读状态保存在 `localStorage`（隐私友好，无需账号）
- 预设热门源一键添加
- 响应式布局（桌面双栏阅读 / 移动侧栏）

## 架构

```
浏览器
  ├─ 静态页  index.html + css/ + js/
  └─ 拉取源  →  GET /api/rss?url=…  (Pages Function 代理并解析 XML)
```

## 目录

```
rss-agg/
├── index.html
├── css/style.css
├── js/app.js
├── functions/api/rss.js
├── _headers
├── package.json
├── wrangler.toml
└── README.md
```

## 本地开发

需要 Node.js 18+：

```bash
cd rss-agg
npm install
npm run dev
```

浏览器打开终端提示的地址（通常是 `http://127.0.0.1:8788`）。

> Pages Functions 需要在 `wrangler pages dev` 下运行；直接用静态服务器打开时 API 会 404。

## 部署到 Cloudflare Pages

### 方式 A：Git 连接（推荐）

1. 将 `rss-agg` 目录推到 GitHub / GitLab
2. [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Pages** → 连接仓库
3. 构建设置：
   - **Build command**：留空（纯静态 + Functions）
   - **Build output directory**：`/` 或 `.`
4. 部署完成后即可访问

### 方式 B：Wrangler CLI

```bash
cd rss-agg
npm install
npx wrangler login
npm run deploy
```

## 设计说明（Emil + 液态玻璃）

| 原则 | 落地 |
| --- | --- |
| 按钮反馈 | `:active { transform: scale(0.97) }`，时长 ~140–160ms |
| 缓动 | `cubic-bezier(0.23, 1, 0.32, 1)` ease-out，不用 ease-in |
| 入场 | 从 `scale(0.96)` + opacity，而非 `scale(0)` |
| 高频操作 | 键盘 `/` 聚焦搜索无动画 |
| 列表 | 短 stagger（30–60ms），不阻塞交互 |
| 液态玻璃 | `backdrop-filter: blur + saturate`、内高光、半透明渐变、环境光球 |
| 无障碍 | `prefers-reduced-motion` 降级动画 |

## 隐私与限制

- 订阅列表与已读/收藏仅存浏览器本地
- 服务端 Function 仅代理用户请求的 feed URL，不做持久化
- 部分源可能屏蔽数据中心 IP，导致拉取失败
- 正文依赖 feed 自带 content；无正文时请点「打开原文」

## License

MIT
