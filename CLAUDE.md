# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

错题王国（Math Kingdom）是一个面向 9 岁小学生的错题集闯关游戏。小孩答题解锁王国地块，收集建筑。零框架前端 + Node.js 单文件后端 + JSON 存储。

## 常用命令

```bash
npm install          # 安装依赖
npm start            # 启动服务器 (node server.js)，监听 http://localhost:3000

# 进程管理 (Windows)
taskkill -f -im node.exe   # 杀掉残留 node 进程（更换端口前）
```

## 技术架构

```
浏览器 (纯 HTML/CSS/JS)  ←→  server.js (Express, 单文件 ~600行)  ←→  JSON 文件存储
                               ├── tesseract.js (OCR 图片识别)
                               ├── multer (文件上传)
                               └── pdf-parse (PDF 文字提取)
```

- **后端**：`server.js` — 包含路由、鉴权、评分引擎、OCR 全部逻辑
- **前端**：`public/` — 4 个独立 HTML 页面 + 1 个共享 CSS，零 JS 框架
- **数据**：`data/problems.json`（题库）、`data/progress.json`（进度）、`config.json`（配置）
- **端口**：3000

## 页面与路由

| 路径 | 文件 | 用户 |
|------|------|------|
| `/` | `public/index.html` | 首页入口 |
| `/play` | `public/play.html` | 小孩答题 |
| `/admin` | `public/admin.html` | 家长管理（需登录） |

`/play` 和 `/admin` 通过 Express 路由 `res.sendFile()` 返回（不是静态文件直接托管，因为路径不含 `.html`）。

## 鉴权机制

- 默认密码存在 `config.json` 的 `adminPassword` 字段
- `POST /api/auth/login` → 返回 `{ token }`，服务端存入 `authTokens` Set
- 管理端需 `Authorization: Bearer <token>` 的写 API 走 `authMiddleware` 校验
- 公开 API（`GET /api/problems`、`GET /api/progress`、`POST /api/grade`）不走鉴权，供游戏页使用
- 前端 `admin.html` 用 `sessionStorage` 存 token，401 时自动弹出登录遮罩

## 评分引擎（`server.js` 后半段）

入口函数 `isAnswerCorrect(subject, answer, input)` → 按学科分发：

| 学科 | 函数 | 核心逻辑 |
|------|------|---------|
| math | `gradeMath(c, u)` | 6 层容错：全角→半角、去量词、数值近似、分数比对、中文数字→阿拉伯 |
| chinese | `gradeChinese(c, u)` | 标点标准化（中→英标点）后精确匹配，去首尾标点 |
| english | `gradeEnglish(c, u)` | 大小写不敏感 + `stemWord()` 词形还原（50+ 不规则词、复数 -s/-es、时态 -ed/-ing、be 动词归一） |

三个学科都支持 `|` 多答案分隔（教师端答案栏填入 `book|books|a book`，任一匹配即正确）。

中文数字支持：零~九、十~亿万，含混合（`3千`→3000）和零占位（`一百零一`→101）。

## 间隔复习

记录在 `progress.json` 的 `problemStats` 中：
- 答错 → 第二天再出现，多次错误间隔递增（1→2→3→4→5天）
- 连续答对 3 次 → `mastered: true`，不再出现
- 答对但未满 3 次 → 1 天后复习确认

## 王国地块

固定 20 块地（5×4 网格），`progress.json` 中 `tiles` 数组管理：
- 小孩点击发光地块 → 前端随机选题 → 弹窗答题
- 答对 → 前端将 `tileIndex` 发到 `POST /api/grade` → 服务端解锁**指定地块**并随机分配建筑 emoji
- 答错不解锁，同一道题可重试

## 数据模型

`problems.json` 中每道题：
```json
{
  "id": "p001",
  "title": "糖果问题",
  "content": "小明有12颗糖，吃了3颗，还剩几颗？",
  "answer": "9|9颗",
  "hint": "用减法",
  "tags": ["二年级"],
  "subject": "math",
  "difficulty": 1,
  "createdAt": "2026-04-01"
}
```

`subject` 字段必填，有效值：`math` | `chinese` | `english`。
