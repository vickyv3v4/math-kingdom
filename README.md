# 🏰 错题王国 — Math Kingdom

小学数学应用题错题闯关游戏。把错题变成宝藏，一题一题建造王国！

## 快速开始

```bash
cd D:\source\math-kingdom
npm install
npm start
```

启动后访问：
- 本机：`http://localhost:3000`
- 局域网：`http://<你的IP>:3000`（iPad / 手机同 WiFi 下直接浏览器打开）

## 使用说明

### 家长端（`/admin` 或首页点「家长管理」）
- **手动录入**：填题目标题、内容、答案、提示
- **拍照识别**：拍下错题照片，OCR 自动识别后手动确认
- **PDF 导入**：上传文字版 PDF，自动提取内容
- **错题列表**：查看、编辑、删除所有错题

### 小孩端（`/play` 或首页点「开始闯关」）
- 点击发光的空地开始挑战
- 在草稿区列竖式、打草稿（iPad 支持 Apple Pencil）
- 答案框支持 iPad 随手写（写字自动转文字）
- 答对解锁建筑，答错看提示再试
- 连续答对 3 次 = 已掌握，题目不再出现
- 答错的题第二天会重新出现（间隔复习）

## 项目结构

```
math-kingdom/
├── server.js              # 服务端（Express + OCR + 评分）
├── package.json
├── data/
│   ├── problems.json      # 错题库
│   └── progress.json      # 王国进度
├── public/
│   ├── index.html         # 首页
│   ├── admin.html         # 家长管理
│   ├── play.html          # 小孩游戏
│   └── style.css          # 统一样式
├── uploads/               # 临时上传文件
└── README.md
```

## 技术栈

- **后端**：Node.js + Express
- **前端**：纯 HTML/CSS/JS（零框架）
- **OCR**：tesseract.js（支持中文）
- **PDF**：pdf-parse
- **存储**：JSON 文件

首次识别中文时需要下载语言包（约 10MB），后续自动缓存。

## 间隔复习机制

| 作答情况 | 行为 |
|----------|------|
| 首次错误 | 第二天再次出现 |
| 多次错误 | 间隔递增（1→2→3→4→5 天）|
| 答对 1 次 | 1 天后复习确认 |
| 连续答对 3 次 | ✅ 已掌握，不再出现 |

## License

MIT
