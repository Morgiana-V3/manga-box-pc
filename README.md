# MangaBox

本地漫画阅读器，支持文件夹与压缩包（ZIP / CBZ），Electron + Vue 3 构建。

## 核心功能

**书库管理** — 设置书库目录自动扫描，也支持单本添加和拖拽导入

**多模式阅读** — 单页 / 双页 / 长条滚动，自由切换

**系列支持** — 自动识别多话漫画，按章节组织浏览

**编辑排序** — 拖拽调整页面/话数顺序，支持删除和重命名

**阅读进度** — 自动记录每本漫画的阅读位置

**快捷键** — 键盘翻页、缩放、全屏，支持沉浸阅读模式

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发模式
npm run dev
```

## 打包

```bash
npm run build:win     # Windows
npm run build:mac     # macOS
npm run build:linux   # Linux
```

## 支持格式

- 图片文件夹：`.jpg` `.jpeg` `.png` `.webp` `.gif` `.bmp`
- 压缩包：`.zip` `.cbz` `.cbr`

## License

MIT
