# 思维棱镜 (Prism) — 帮你想完整

一个苏格拉底式决策思维伙伴，通过5阶段结构化对话帮你把决策想完整，而不是帮你做决定。

## 部署信息

### CloudBase 环境

| 项目 | 值 |
|------|------|
| 环境ID | `prism-mvp-d7grhmf61a0b12522` |
| 地域 | 上海 (ap-shanghai) |
| 套餐 | 体验版 |

### 后端服务 (Cloud Run)

| 项目 | 值 |
|------|------|
| 服务名 | `prism-backend` |
| 类型 | 容器型 |
| 访问地址 | `https://prism-backend-247309-5-1259376615.sh.run.tcloudbase.com` |
| 端口 | 3000 |
| CPU/内存 | 0.5核 / 1GB |
| 实例数 | 1~5 (CPU 60% 自动扩缩) |
| 镜像 | Node.js Alpine |

### 前端 (静态托管)

| 项目 | 值 |
|------|------|
| 访问地址 | `https://prism-mvp-d7grhmf61a0b12522-1259376615.tcloudbaseapp.com/index.html` |

### API 端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/chat` | POST | LLM 对话代理 |
| `/api/snapshot` | POST | 决策快照生成 |
| `/api/conversations` | POST/GET | 对话 CRUD |
| `/api/conversations/:id` | GET/DELETE | 单条对话 |
| `/api/events` | POST | 埋点事件 |
| `/api/user` | GET | 用户信息 |
| `/api/stats` | GET | 管理统计 |

### 环境变量

后端服务需要配置以下环境变量（Cloud Run 控制台设置）：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_BASE_URL` | LLM API 地址 | `https://api.deepseek.com` |
| `LLM_API_KEY` | LLM API 密钥 | **必填** |
| `LLM_MODEL` | 模型名称 | `deepseek-chat` |
| `NODE_ENV` | 运行环境 | `production` |

> ⚠️ `LLM_API_KEY` 必须在 Cloud Run 控制台中配置，不要硬编码在代码中。

## CloudBase 控制台

- 环境概览: https://tcb.cloud.tencent.com/dev?envId=prism-mvp-d7grhmf61a0b12522#/overview
- 云托管服务: https://tcb.cloud.tencent.com/dev?envId=prism-mvp-d7grhmf61a0b12522#/platform-run
- 静态托管: https://tcb.cloud.tencent.com/dev?envId=prism-mvp-d7grhmf61a0b12522#/static-hosting
- 环境设置: https://tcb.cloud.tencent.com/dev?envId=prism-mvp-d7grhmf61a0b12522#/env

## 本地开发

```bash
cd prototype

# 1. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 LLM_API_KEY

# 2. 安装依赖
npm install

# 3. 启动服务
npm start

# 4. 打开浏览器
# http://localhost:3000
```

## 项目结构

```
prototype/
├── server.js              # Express 启动器(挂路由 + 静态托管)
├── llm-config.js          # LLM 配置(从 .env 读取)
├── db.js                  # JSON 文件数据库
│
├── prompts/               # Prompt 工程层
│   ├── phases.js          # 5 阶段 angle/temperature/scaffolding 表
│   ├── deep-prompt.js     # 深度模式 system prompt 构建 + 上下文富化
│   └── quality-gate.js    # LLM 回复质量守门(8 条规则 + 重试)
│
├── routes/                # API 路由
│   ├── chat.js            # /api/chat /api/snapshot
│   ├── conversations.js   # /api/conversations CRUD
│   └── system.js          # /api/health /api/stats /api/user /api/events
│
├── middleware/
│   └── require-user.js    # x-user-id 中间件
│
├── public/                # 静态前端(Express static 根)
│   ├── index.html         # HTML 骨架(~110 行)
│   ├── styles.css         # 全局样式
│   └── app.js             # 主前端逻辑
│
├── Dockerfile             # Cloud Run 容器配置
├── .dockerignore          # Docker 忽略文件
├── .env.example           # 环境变量模板
├── .env                   # 环境变量(不提交)
├── .gitignore             # Git 忽略文件
├── package.json           # Node.js 依赖
└── data/                  # 数据存储(不提交)
    ├── users.json
    ├── conversations.json
    └── events.json
```

> 模块化拆分原则:
> - **prompts/** 是产品护城河,需要反复调试 → 每个文件 < 300 行
> - **routes/** 按职责切分,新增 API 时只动一个文件
> - **public/** 为后续上 Vue/Vite 做准备(届时改为 `dist/`)

## 更新部署

### 更新后端

修改代码后，重新部署 Cloud Run 服务：

1. 在 CloudBase 控制台 → 云托管 → prism-backend → 版本管理
2. 点击「新建版本」→ 上传代码包
3. 或使用 CLI: `tcb fn deploy prism-backend`

### 更新前端

修改 `public/index.html` / `public/styles.css` / `public/app.js` 后,重新上传到静态托管:

1. 在 CloudBase 控制台 → 静态托管
2. 上传覆盖 `public/` 下的对应文件

## 安全说明

- API Key 只存在于服务端环境变量，前端无法访问
- `.env` 文件已在 `.gitignore` 中排除
- `data/` 目录已在 `.gitignore` 中排除
- 前端通过服务端代理调用 LLM，不直接暴露 API Key
