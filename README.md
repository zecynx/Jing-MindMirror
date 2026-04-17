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
├── server.js          # Express 后端（LLM 代理 + 数据 API）
├── db.js              # JSON 文件数据库模块
├── index.html         # 前端单页应用
├── Dockerfile         # Cloud Run 容器配置
├── .dockerignore      # Docker 忽略文件
├── .env.example       # 环境变量模板
├── .env               # 环境变量（不提交）
├── .gitignore         # Git 忽略文件
├── package.json       # Node.js 依赖
└── data/              # 数据存储（不提交）
    ├── users.json
    ├── conversations.json
    └── events.json
```

## 更新部署

### 更新后端

修改代码后，重新部署 Cloud Run 服务：

1. 在 CloudBase 控制台 → 云托管 → prism-backend → 版本管理
2. 点击「新建版本」→ 上传代码包
3. 或使用 CLI: `tcb fn deploy prism-backend`

### 更新前端

修改 `index.html` 后，重新上传到静态托管：

1. 在 CloudBase 控制台 → 静态托管
2. 上传覆盖 `index.html`

## 安全说明

- API Key 只存在于服务端环境变量，前端无法访问
- `.env` 文件已在 `.gitignore` 中排除
- `data/` 目录已在 `.gitignore` 中排除
- 前端通过服务端代理调用 LLM，不直接暴露 API Key
