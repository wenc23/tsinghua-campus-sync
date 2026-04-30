# 🏫 tsinghua-campus-sync

> 清华校园数据同步 — 从清华大学网络学堂 (learn.tsinghua.edu.cn) 拉取课表、作业、通知、文件到本地的 **MCP Server** + **CLI 工具集**。

---

## ✨ 功能

| 功能 | 说明 |
|------|------|
| 📅 **课表查询** | 每日课表、每周课表、课程信息 |
| 📝 **作业管理** | 全部作业列表、逾期/未提交筛选、即将截止提醒 |
| 📢 **通知同步** | 各课程通知拉取，未读标记 |
| 📁 **文件管理** | 课件/资料下载链接汇总 |
| 🔄 **自动同步** | 全量抓取 → 本地 JSON 缓存 → 结构化日历索引 |
| 🤖 **MCP 集成** | 通过 Model Context Protocol 暴露为 AI Agent 工具 |

## 🎯 适用场景

- 清华在校生需要快速查询课表、作业、通知
- AI Agent / MCP Client 集成校园数据
- 不想每次打开浏览器看网络学堂的通知和作业
- 本地自动化：配合 cron 定时同步，数据始终新鲜

## 📦 安装

```bash
# 克隆仓库
git clone https://github.com/suzu-dev/tsinghua-campus-sync.git
cd tsinghua-campus-sync

# 安装依赖
npm install
```

## 🔧 配置

### 1. 填写学号和密码

```bash
cp config.example.json config.json
# 编辑 config.json 填写学号和密码
```

### 2. 首次登录（获取 Cookie + 指纹）

```bash
node scripts/login.js
```

- 自动打开浏览器到清华 SSO 登录页面
- 自动填写学号密码并提交
- 需在手机上完成二次认证（微信「清华校园卡」或短信验证码）
- 登录成功后自动保存 Cookie 和设备指纹

> **提示**：Cookie 过期后需要重新运行 `login.js`。

### 3. 同步数据

```bash
node scripts/fetch.js           # 全量同步
node scripts/fetch.js --verbose  # 调试输出
```

## 🚀 使用

### CLI 查询工具

```bash
# 查看今天课表
npm run today

# 查看本周安排
npm run week

# 查看未提交作业
npm run homework

# 查看全部作业
node scripts/query.js homework --all

# 查看即将截止的作业（14天内）
node scripts/query.js upcoming

# 查看通知
node scripts/query.js notifications

# 查看课程详情
node scripts/query.js course "数字集成电路"

# 查看数据概览
node scripts/query.js stats
```

### MCP Server

作为 MCP Server 运行时，通过标准输入/输出与 MCP Client 通信。

#### 配置 MCP Client

在你的 MCP Client 配置文件（如 `~/.hermes/config.yaml`）中添加：

```yaml
mcp_servers:
  campus:
    command: "node"
    args: ["/path/to/tsinghua-campus-sync/scripts/mcp-server.js"]
```

#### 可用工具

| 工具 | 参数 | 返回 |
|------|------|------|
| `today` | date? (YYYY-MM-DD) | 当日课程 + 作业截止 |
| `week` | — | 本周每日课表 + 作业 |
| `homework` | all? (boolean) | 作业列表（含逾期标记） |
| `upcoming` | days? (默认 14) | 未来 N 天截止的作业 |
| `course` | keyword (必填) | 课程详情 + 通知 + 文件 |
| `notifications` | limit? (默认 20) | 通知列表 |
| `files` | limit? (默认 20) | 文件列表 |
| `stats` | — | 同步概览 |
| `sync` | verbose? | 触发全量同步 |

## 📁 数据存储结构

```
~/.campus-data/                      # 运行时数据目录（可配置）
├── config.json                      # 认证信息（学号密码）
├── _cookies.json                    # Session Cookie
├── _sync.json                       # 同步状态
├── courses/
│   ├── index.json                   # 课程列表
│   └── {courseId}/
│       ├── info.json                # 课程信息
│       ├── assignments.json         # 作业
│       ├── notifications.json       # 通知
│       └── files.json               # 文件
├── calendar/
│   ├── daily/{date}.json            # 每日日历
│   └── monthly/{month}.json         # 月度概览
└── merged/
    ├── assignments.json             # 全课程作业汇总
    ├── notifications.json           # 全课程通知汇总
    ├── files.json                   # 全课程文件汇总
    └── calendar.json                # 完整日历索引
```

> 数据目录默认在 `CAMPUS_DIR = path.resolve(__dirname, '..')`（即仓库根目录下方一级目录）。
> 可通过修改 `scripts/mcp-server.js` 和 `scripts/fetch.js` 中的 `CAMPUS_DIR` 常量自定义。

## ⏰ 定时同步（Cron）

推荐搭配 cron 实现每日自动同步：

```bash
# 每天早上 6 点同步
0 6 * * * cd /path/to/tsinghua-campus-sync && node scripts/fetch.js --quiet
```

## 🧱 技术栈

- **运行时**：Node.js
- **核心库**：[thu-learn-lib](https://github.com/SummonHIM/thu-learn-lib) — 清华网络学堂 API 封装
- **认证**：Puppeteer — 浏览器交互 + Cookie 桥接
- **MCP**：`@modelcontextprotocol/sdk` — Model Context Protocol
- **日期处理**：dayjs

## 📄 数据模型

详见 [`_schema.md`](./_schema.md)

## ⚠️ 已知问题

1. **Cookie 过期**：长时间不登录会导致 Cookie 失效，需重新运行 `login.js`
2. **二次认证**：首次登录需手机二次认证，无法完全自动化
3. **GFW**：仅限中国大陆网络环境下的清华大学校内服务使用

## 📜 License

MIT

---

<p align="center">🏫 Made with ❤️ for Tsinghua students</p>
