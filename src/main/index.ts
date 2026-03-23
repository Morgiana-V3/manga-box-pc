import { app, BrowserWindow, ipcMain, dialog, protocol, shell, session } from 'electron'
import { join, basename, extname, dirname } from 'path'
import {
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
  cpSync,
  copyFileSync,
  renameSync,
  readFileSync,
  writeFileSync,
  rmdirSync,
  createWriteStream
} from 'fs'
import { get as httpsGet } from 'https'
import { get as httpGet } from 'http'
import Store from 'electron-store'
import AdmZip from 'adm-zip'

interface Book {
  id: string
  title: string
  path: string
  type: 'folder' | 'archive'
  kind: 'single' | 'series'
  cover: string | null
  coverData?: string
  pageCount: number
  chapterCount?: number
  addedAt: number
}

interface Chapter {
  id: string
  title: string
  path: string
  cover: string | null
  pageCount: number
  index: number
}

const store = new Store()
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']
const ARCHIVE_EXTS = ['.zip', '.cbz', '.cbr']
let DEFAULT_LIBRARY_DIR = ''

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1a1a2e',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  DEFAULT_LIBRARY_DIR = join(app.getPath('userData'), 'manga-library')
  mkdirSync(DEFAULT_LIBRARY_DIR, { recursive: true })

  protocol.registerFileProtocol('manga-file', (request, callback) => {
    const raw = request.url.replace('manga-file://', '')
    const noQuery = raw.split('?')[0].split('#')[0]
    const filePath = decodeURIComponent(noQuery)
    callback({ path: filePath })
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ============ 工具函数 ============

function getExt(filename: string): string {
  const idx = filename.lastIndexOf('.')
  if (idx === -1) return ''
  return filename.slice(idx).toLowerCase()
}

function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function imagePathToDataUrl(filePath: string): string | undefined {
  try {
    const ext = getExt(filePath)
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : ext === '.bmp'
              ? 'image/bmp'
              : 'image/jpeg'
    const data = readFileSync(filePath).toString('base64')
    return `data:${mime};base64,${data}`
  } catch {
    return undefined
  }
}

/**
 * 读取系列目录的章节排序文件（.manga-order）
 * 返回 null 表示不存在，使用自然排序兜底
 */
function readChapterOrder(seriesPath: string): string[] | null {
  const orderFile = join(seriesPath, '.manga-order')
  if (!existsSync(orderFile)) return null
  try {
    return JSON.parse(readFileSync(orderFile, 'utf-8')) as string[]
  } catch {
    return null
  }
}

/**
 * 按 .manga-order 对章节目录名排序，没有排序文件则自然排序
 * order 文件中不存在的目录（新增章节）附加到末尾
 */
function sortChapterDirs(seriesPath: string, dirNames: string[]): string[] {
  const order = readChapterOrder(seriesPath)
  if (!order) return [...dirNames].sort(naturalSort)

  const dirSet = new Set(dirNames)
  const validOrder = order.filter((n) => dirSet.has(n))  // 只保留实际存在的
  const inOrder = new Set(validOrder)
  const unordered = dirNames.filter((n) => !inOrder.has(n)).sort(naturalSort) // 新增章节追加末尾
  return [...validOrder, ...unordered]
}

/** 判断文件夹是否为系列（包含子目录 或 存在 .manga-series 标记文件） */
function checkIsSeries(folderPath: string): boolean {
  try {
    if (existsSync(join(folderPath, '.manga-series'))) return true
    return readdirSync(folderPath, { withFileTypes: true }).some((e) => e.isDirectory())
  } catch {
    return false
  }
}

/**
 * 将文件夹内图片按自然排序重命名为 001.ext, 002.ext, ...
 * 如果有子目录（系列），递归处理每个子目录
 */
function autoRenameImages(folderPath: string): void {
  const entries = readdirSync(folderPath, { withFileTypes: true })
  const hasSubs = entries.some((e) => e.isDirectory())

  if (hasSubs) {
    // 系列：只递归处理子目录
    for (const entry of entries) {
      if (entry.isDirectory()) {
        autoRenameImages(join(folderPath, entry.name))
      }
    }
  } else {
    // 单本：重命名本目录的图片
    const images = entries
      .filter((e) => e.isFile() && IMAGE_EXTS.includes(getExt(e.name)))
      .map((e) => e.name)
      .sort(naturalSort)

    if (images.length === 0) return

    // 第一步：改为临时名，避免 001→002、002→001 这类冲突
    const tmpMaps: Array<{ tmp: string; ext: string }> = []
    for (let i = 0; i < images.length; i++) {
      const ext = getExt(images[i])
      const tmpName = `_tmp_${i}${ext}`
      renameSync(join(folderPath, images[i]), join(folderPath, tmpName))
      tmpMaps.push({ tmp: tmpName, ext })
    }
    // 第二步：改为最终顺序名
    for (let i = 0; i < tmpMaps.length; i++) {
      const finalName = `${String(i + 1).padStart(3, '0')}${tmpMaps[i].ext}`
      renameSync(join(folderPath, tmpMaps[i].tmp), join(folderPath, finalName))
    }
  }
}

// ============ IPC 处理 ============

ipcMain.on('window-minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
ipcMain.on('window-maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (win?.isMaximized()) win.unmaximize()
  else win?.maximize()
})
ipcMain.on('window-close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())

ipcMain.handle('dialog:openFolder', async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:openArchive', async (): Promise<string[]> => {
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'Comic Archives', extensions: ['zip', 'cbz', 'cbr'] }],
    properties: ['openFile', 'multiSelections']
  })
  if (result.canceled || !result.filePaths.length) return []
  return result.filePaths
})

/** 统一的文件/文件夹选择对话框，可同时选择文件夹和压缩包 */
ipcMain.handle('dialog:openFileOrFolder', async (): Promise<string[]> => {
  const result = await dialog.showOpenDialog({
    title: '选择漫画文件夹或压缩包',
    filters: [{ name: 'Comic Archives', extensions: ['zip', 'cbz', 'cbr'] }],
    properties: ['openFile', 'openDirectory', 'multiSelections']
  })
  if (result.canceled || !result.filePaths.length) return []
  return result.filePaths
})

ipcMain.handle('fs:getDefaultLibraryDir', () => DEFAULT_LIBRARY_DIR)

/** 导入漫画：文件夹直接复制，压缩包自动解压为文件夹，统一以目录方式存储 */
ipcMain.handle(
  'fs:importBook',
  async (_event, sourcePath: string, destDir: string): Promise<boolean> => {
    if (!existsSync(sourcePath)) return false

    mkdirSync(destDir, { recursive: true })

    const name = basename(sourcePath)
    const ext = extname(name).toLowerCase()
    const base = basename(name, extname(name))

    try {
      const stat = statSync(sourcePath)

      if (stat.isDirectory()) {
        // 文件夹：直接复制
        let destPath = join(destDir, name)
        if (existsSync(destPath)) {
          destPath = join(destDir, `${base}_${Date.now()}`)
        }
        cpSync(sourcePath, destPath, { recursive: true })
        autoRenameImages(destPath)
      } else if (ARCHIVE_EXTS.includes(ext)) {
        // 压缩包：解压为同名文件夹
        let destPath = join(destDir, base)
        if (existsSync(destPath)) {
          destPath = join(destDir, `${base}_${Date.now()}`)
        }
        mkdirSync(destPath, { recursive: true })

        const zip = new AdmZip(sourcePath)
        zip.extractAllTo(destPath, true)

        // 解压后可能有一层多余的根目录（如 zip 里只有一个目录），做扁平化处理
        const extracted = readdirSync(destPath, { withFileTypes: true })
        if (extracted.length === 1 && extracted[0].isDirectory()) {
          // 只有一个子目录，把内容提升一级
          const innerDir = join(destPath, extracted[0].name)
          const innerEntries = readdirSync(innerDir)
          for (const ie of innerEntries) {
            renameSync(join(innerDir, ie), join(destPath, ie))
          }
          // 删除空的内层目录
          try { rmdirSync(innerDir) } catch { /* ignore */ }
        }

        autoRenameImages(destPath)
      } else {
        // 其他文件：直接复制（兜底）
        let destPath = join(destDir, name)
        if (existsSync(destPath)) {
          destPath = join(destDir, `${base}_${Date.now()}${ext}`)
        }
        copyFileSync(sourcePath, destPath)
      }
      return true
    } catch (err) {
      console.error('importBook failed:', sourcePath, err)
      return false
    }
  }
)

/** 删除漫画（移入回收站） */
ipcMain.handle('fs:removeBook', async (_event, bookPath: string): Promise<boolean> => {
  try {
    if (!existsSync(bookPath)) return true
    await shell.trashItem(bookPath)
    return true
  } catch (err) {
    console.error('removeBook failed:', bookPath, err)
    return false
  }
})

/** 在书库中创建空系列目录（带 .manga-series 标记文件） */
ipcMain.handle(
  'fs:createSeries',
  async (_event, libraryDir: string, seriesName: string): Promise<boolean> => {
    try {
      const trimmed = seriesName.trim()
      if (!trimmed) return false

      let destPath = join(libraryDir, trimmed)
      if (existsSync(destPath)) {
        destPath = join(libraryDir, `${trimmed}_${Date.now()}`)
      }

      mkdirSync(destPath, { recursive: true })
      writeFileSync(join(destPath, '.manga-series'), '', 'utf-8')
      return true
    } catch (err) {
      console.error('createSeries failed:', err)
      return false
    }
  }
)

/** 扫描书库，自动识别单本 vs 系列 */
ipcMain.handle('fs:scanLibrary', async (_event, folderPath: string): Promise<Book[]> => {
  if (!existsSync(folderPath)) return []
  const entries = readdirSync(folderPath, { withFileTypes: true })
  const books: Book[] = []

  for (const entry of entries) {
    const fullPath = join(folderPath, entry.name)

    if (entry.isDirectory()) {
      const subEntries = readdirSync(fullPath, { withFileTypes: true })
      const hasSubs = subEntries.some((e) => e.isDirectory())
      const hasSeriesMarker = existsSync(join(fullPath, '.manga-series'))

      if (hasSubs || hasSeriesMarker) {
        // ── 系列：子目录 = 话数，按 .manga-order 文件排序（如有），否则自然排序 ──
        const chapterDirNames = subEntries
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
        const sortedChapterNames = sortChapterDirs(fullPath, chapterDirNames)

        let totalPages = 0
        let cover: string | null = null

        for (const chName of sortedChapterNames) {
          const chPath = join(fullPath, chName)
          const imgs = readdirSync(chPath)
            .filter((f) => IMAGE_EXTS.includes(getExt(f)))
            .sort(naturalSort)
          totalPages += imgs.length
          if (!cover && imgs.length > 0) cover = join(chPath, imgs[0])
        }

        books.push({
          id: btoa(encodeURIComponent(fullPath)),
          title: entry.name,
          path: fullPath,
          type: 'folder',
          kind: 'series',
          cover,
          coverData: cover ? imagePathToDataUrl(cover) : undefined,
          pageCount: totalPages,
          chapterCount: sortedChapterNames.length,
          addedAt: statSync(fullPath).mtimeMs
        })
      } else {
        // ── 单本：直接含图片 ──
        const images = subEntries
          .filter((e) => e.isFile() && IMAGE_EXTS.includes(getExt(e.name)))
          .map((e) => e.name)
          .sort(naturalSort)

        if (images.length > 0) {
          books.push({
            id: btoa(encodeURIComponent(fullPath)),
            title: entry.name,
            path: fullPath,
            type: 'folder',
            kind: 'single',
            cover: join(fullPath, images[0]),
            coverData: imagePathToDataUrl(join(fullPath, images[0])),
            pageCount: images.length,
            addedAt: statSync(fullPath).mtimeMs
          })
        }
      }
    } else if (ARCHIVE_EXTS.includes(getExt(entry.name))) {
      try {
        const zip = new AdmZip(fullPath)
        const pages = zip
          .getEntries()
          .filter((e) => IMAGE_EXTS.includes(getExt(e.entryName)) && !e.isDirectory)
          .sort((a, b) => naturalSort(a.entryName, b.entryName))
        if (pages.length > 0) {
          books.push({
            id: btoa(encodeURIComponent(fullPath)),
            title: entry.name.replace(/\.[^.]+$/, ''),
            path: fullPath,
            type: 'archive',
            kind: 'single',
            cover: null,
            coverData: `data:image/jpeg;base64,${pages[0].getData().toString('base64')}`,
            pageCount: pages.length,
            addedAt: statSync(fullPath).mtimeMs
          })
        }
      } catch (err) {
        console.error('Failed to read archive:', fullPath, err)
      }
    }
  }

  return books.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
})

ipcMain.handle(
  'fs:getPages',
  async (_event, bookPath: string, bookType: 'folder' | 'archive'): Promise<string[]> => {
    if (bookType === 'folder') {
      const files = readdirSync(bookPath)
        .filter((f) => IMAGE_EXTS.includes(getExt(f)))
        .sort(naturalSort)
      return files.map((f) => {
        const abs = join(bookPath, f)
        const st = statSync(abs)
        const ver = `${Math.trunc(st.mtimeMs)}-${Math.trunc(st.ctimeMs)}`
        return `manga-file://${encodeURIComponent(abs)}?v=${ver}`
      })
    } else {
      const zip = new AdmZip(bookPath)
      const pages = zip
        .getEntries()
        .filter((e) => IMAGE_EXTS.includes(getExt(e.entryName)) && !e.isDirectory)
        .sort((a, b) => naturalSort(a.entryName, b.entryName))
      return pages.map((e) => {
        const data = e.getData().toString('base64')
        const mime = getExt(e.entryName) === '.png' ? 'image/png' : 'image/jpeg'
        return `data:${mime};base64,${data}`
      })
    }
  }
)

/** 获取系列的所有章节，按 .manga-order 排序（如有），否则自然排序 */
ipcMain.handle('fs:getChapters', async (_event, seriesPath: string): Promise<Chapter[]> => {
  if (!existsSync(seriesPath)) return []
  const dirNames = readdirSync(seriesPath, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

  const sortedNames = sortChapterDirs(seriesPath, dirNames)

  const chapters: Chapter[] = []
  for (let i = 0; i < sortedNames.length; i++) {
    const chPath = join(seriesPath, sortedNames[i])
    const imgs = readdirSync(chPath)
      .filter((f) => IMAGE_EXTS.includes(getExt(f)))
      .sort(naturalSort)
    if (imgs.length > 0) {
      chapters.push({
        id: btoa(encodeURIComponent(chPath)),
        title: sortedNames[i],
        path: chPath,
        cover: join(chPath, imgs[0]),
        pageCount: imgs.length,
        index: i
      })
    }
  }
  return chapters
})

/**
 * 保存系列章节顺序：将新顺序写入 .manga-order 文件
 * chapterNames: 子目录名称，按用户期望的新顺序排列
 * 不重命名任何目录，顺序完全由文件决定，下次读取自动还原
 */
ipcMain.handle(
  'fs:reorderChapters',
  async (_event, seriesPath: string, chapterNames: string[]): Promise<boolean> => {
    try {
      const orderFile = join(seriesPath, '.manga-order')
      writeFileSync(orderFile, JSON.stringify(chapterNames, null, 2), 'utf-8')
      return true
    } catch (err) {
      console.error('reorderChapters failed:', err)
      return false
    }
  }
)

/**
 * 删除单话中的指定页面文件（移入回收站）
 * pageKeys: 要删除的文件名数组
 */
ipcMain.handle(
  'fs:deletePages',
  async (_event, bookPath: string, pageKeys: string[]): Promise<boolean> => {
    try {
      for (const key of pageKeys) {
        const filePath = join(bookPath, key)
        if (existsSync(filePath)) {
          await shell.trashItem(filePath)
        }
      }
      return true
    } catch (err) {
      console.error('deletePages failed:', err)
      return false
    }
  }
)

/**
 * 按新顺序重命名图片文件（用于单本编辑）
 * filenames: 当前图片文件名，按新的期望顺序传入
 */
ipcMain.handle(
  'fs:renamePages',
  async (_event, bookPath: string, filenames: string[]): Promise<boolean> => {
    try {
      const diskImages = readdirSync(bookPath)
        .filter((f) => IMAGE_EXTS.includes(getExt(f)))
      const lowerMap = new Map(diskImages.map((n) => [n.toLowerCase(), n]))

      const normalize = (val: string): string => {
        const noQuery = val.split('?')[0].split('#')[0]
        const noProto = noQuery.startsWith('manga-file://') ? noQuery.replace('manga-file://', '') : noQuery
        const decoded = decodeURIComponent(noProto)
        const name = basename(decoded.replace(/\\/g, '/'))
        return name
      }

      const orderedNames: string[] = []
      for (const raw of filenames) {
        const wanted = normalize(raw)
        if (diskImages.includes(wanted)) {
          orderedNames.push(wanted)
          continue
        }
        const matched = lowerMap.get(wanted.toLowerCase())
        if (!matched) {
          console.error('renamePages failed: source file not found', { bookPath, raw, wanted })
          return false
        }
        orderedNames.push(matched)
      }

      if (orderedNames.length !== diskImages.length) {
        console.error('renamePages failed: page count mismatch', {
          bookPath,
          ordered: orderedNames.length,
          disk: diskImages.length
        })
        return false
      }

      const tmpMaps: Array<{ tmp: string; ext: string }> = []
      for (let i = 0; i < orderedNames.length; i++) {
        const ext = getExt(orderedNames[i])
        const tmpName = `_rename_tmp_${i}${ext}`
        renameSync(join(bookPath, orderedNames[i]), join(bookPath, tmpName))
        tmpMaps.push({ tmp: tmpName, ext })
      }
      for (let i = 0; i < tmpMaps.length; i++) {
        const finalName = `${String(i + 1).padStart(3, '0')}${tmpMaps[i].ext}`
        renameSync(join(bookPath, tmpMaps[i].tmp), join(bookPath, finalName))
      }
      // 文件名会重新变成 001/002...，URL 不变，清理会话缓存避免旧缩略图残留
      await Promise.all(
        BrowserWindow.getAllWindows().map((w) => w.webContents.session.clearCache())
      )
      return true
    } catch (err) {
      console.error('renamePages failed:', err)
      return false
    }
  }
)

/** 重命名书/章节目录，如父目录有 .manga-order 文件则同步更新 */
ipcMain.handle(
  'fs:renameBook',
  async (_event, bookPath: string, newTitle: string): Promise<string | null> => {
    try {
      const parent = dirname(bookPath)
      const oldName = basename(bookPath)
      const newPath = join(parent, newTitle)
      if (existsSync(newPath) && newPath !== bookPath) return null
      if (newPath !== bookPath) {
        renameSync(bookPath, newPath)
        // 如果父目录有章节顺序文件，把旧目录名替换为新名
        const orderFile = join(parent, '.manga-order')
        if (existsSync(orderFile)) {
          try {
            const order = JSON.parse(readFileSync(orderFile, 'utf-8')) as string[]
            const updated = order.map((n) => (n === oldName ? newTitle : n))
            writeFileSync(orderFile, JSON.stringify(updated, null, 2), 'utf-8')
          } catch {
            // 顺序文件损坏则忽略，不影响主流程
          }
        }
      }
      return newPath
    } catch (err) {
      console.error('renameBook failed:', err)
      return null
    }
  }
)

ipcMain.handle('store:get', (_event, key: string) => store.get(key))
ipcMain.handle('store:set', (_event, key: string, value: unknown) => store.set(key, value))
ipcMain.handle('store:delete', (_event, key: string) => store.delete(key))

ipcMain.handle('shell:openPath', async (_event, targetPath: string): Promise<void> => {
  await shell.openPath(targetPath)
})

// ============ 在线抓取 / 图片嗅探（CDP 方案） ============

/** 嗅探窗口状态 */
let sniffWin: BrowserWindow | null = null
/** 嗅探窗口是否可见（预览模式） */
let sniffWinVisible = true
const sniffedImages: Map<string, { url: string; size: number; contentType: string }> = new Map()
/** 每个请求的原始请求头（用于下载时透传 Cookie/Referer） */
const sniffedRequestHeaders: Map<string, Record<string, string>> = new Map()
let sniffSession: Electron.Session | null = null
/** CDP debugger 是否已附加 */
let cdpAttached = false
/** 当前进行中的网络请求数（用于网络空闲检测） */
let pendingRequests = 0
/** 最后一次网络活动时间 */
let lastNetworkActivityTime = 0

/** 图片 MIME 类型 */
const IMAGE_MIMES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp',
  'image/avif', 'image/svg+xml'
]

/** 图片后缀 */
const IMG_URL_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']

/** 可能是图片的二进制 MIME 类型 */
const BINARY_MIMES = ['application/octet-stream', 'binary/octet-stream']

/** 判断 URL 或 Content-Type 是否为图片 */
function isImageResource(url: string, contentType?: string): boolean {
  if (contentType) {
    const lower = contentType.toLowerCase()
    if (IMAGE_MIMES.some((m) => lower.includes(m))) return true
    if (BINARY_MIMES.some((m) => lower.includes(m))) {
      return hasImageExt(url)
    }
  }
  return hasImageExt(url)
}

function hasImageExt(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    return IMG_URL_EXTS.some((ext) => pathname.endsWith(ext) || pathname.includes(ext + '?'))
  } catch {
    return false
  }
}

/** 获取渲染进程主窗口（排除嗅探预览窗口） */
function getMainWin(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((w) => w !== sniffWin) ?? null
}

/** 等待网络空闲：连续 quietMs 毫秒内无新请求且无进行中请求 */
function waitForNetworkIdle(quietMs = 2000, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve) => {
    const startTime = Date.now()

    const check = (): void => {
      const now = Date.now()
      // 超时强制返回
      if (now - startTime > timeoutMs) {
        resolve()
        return
      }
      // 无进行中请求 且 距上次网络活动已过 quietMs
      if (pendingRequests <= 0 && (now - lastNetworkActivityTime) >= quietMs) {
        resolve()
        return
      }
      setTimeout(check, 300)
    }
    // 给一个最小的初始等待
    setTimeout(check, Math.min(quietMs, 500))
  })
}

/** 附加 CDP debugger 到嗅探窗口，开始监听网络 */
function attachCDP(): void {
  if (!sniffWin || sniffWin.isDestroyed() || cdpAttached) return

  const dbg = sniffWin.webContents.debugger
  try {
    dbg.attach('1.3')
    cdpAttached = true
  } catch (err) {
    console.error('CDP attach failed:', err)
    return
  }

  // 启用 Network 域
  dbg.sendCommand('Network.enable', {
    maxPostDataSize: 0, // 不需要 POST body
    maxTotalBufferSize: 0
  }).catch(() => {})

  // ★ 禁用浏览器缓存：确保所有请求走网络，CDP 才能捕获完整的响应信息
  // 这对于手动滚动/翻页后新出现的图片至关重要
  dbg.sendCommand('Network.setCacheDisabled', {
    cacheDisabled: true
  }).catch(() => {})

  // 监听 CDP 事件
  dbg.on('message', (_event, method, params) => {
    if (method === 'Network.requestWillBeSent') {
      // ── 请求即将发送（第一阶段：比 responseReceived 早得多） ──
      pendingRequests++
      lastNetworkActivityTime = Date.now()

      const reqUrl: string = params.request?.url ?? ''
      const headers: Record<string, string> = params.request?.headers ?? {}

      // 保存请求头（后续下载时透传 Cookie/Referer）
      if (reqUrl && !sniffedRequestHeaders.has(reqUrl)) {
        sniffedRequestHeaders.set(reqUrl, headers)
      }

      // ★ 在请求发送阶段就预录入：通过 URL 后缀判断的图片即使被缓存也能捕获
      // 因为缓存命中时 responseReceived 可能不触发或参数不同
      if (reqUrl && hasImageExt(reqUrl) && !sniffedImages.has(reqUrl)) {
        sniffedImages.set(reqUrl, {
          url: reqUrl,
          size: 0,  // 此阶段还不知道大小
          contentType: ''
        })
        const mainWin = getMainWin()
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('sniff:image-found', {
            url: reqUrl,
            size: 0,
            contentType: ''
          })
        }
      }
    } else if (method === 'Network.responseReceived') {
      // ── 收到响应头（第二阶段：精确的 Content-Type 和大小） ──
      lastNetworkActivityTime = Date.now()

      const response = params.response ?? {}
      const reqUrl: string = response.url ?? ''
      const mimeType: string = response.mimeType ?? ''
      const contentLength: number = response.headers?.['content-length']
        ? parseInt(response.headers['content-length'], 10)
        : (response.headers?.['Content-Length'] ? parseInt(response.headers['Content-Length'], 10) : 0)

      if (reqUrl && isImageResource(reqUrl, mimeType)) {
        // 过滤太小的图片（图标、占位符等），阈值 5KB
        if (contentLength > 0 && contentLength < 5120) return

        if (!sniffedImages.has(reqUrl)) {
          // 全新图片：录入并推送
          sniffedImages.set(reqUrl, {
            url: reqUrl,
            size: contentLength,
            contentType: mimeType
          })
          const mainWin = getMainWin()
          if (mainWin && !mainWin.isDestroyed()) {
            mainWin.webContents.send('sniff:image-found', {
              url: reqUrl,
              size: contentLength,
              contentType: mimeType
            })
          }
        } else {
          // 已在 requestWillBeSent 阶段预录入，但现在有了精确信息，更新之
          const existing = sniffedImages.get(reqUrl)!
          if (existing.size === 0 || !existing.contentType) {
            existing.size = contentLength
            existing.contentType = mimeType
            sniffedImages.set(reqUrl, existing)
            // 推送更新（前端可用于刷新大小显示等）
            const mainWin = getMainWin()
            if (mainWin && !mainWin.isDestroyed()) {
              mainWin.webContents.send('sniff:image-updated', {
                url: reqUrl,
                size: contentLength,
                contentType: mimeType
              })
            }
          }
        }
      }
    } else if (method === 'Network.requestServedFromCache') {
      // ★ 缓存命中时单独触发（responseReceived 可能不触发）
      lastNetworkActivityTime = Date.now()
      const requestId: string = params.requestId ?? ''
      // requestServedFromCache 只有 requestId，没有 URL
      // 但 requestWillBeSent 已经用 URL 预录入了，所以这里主要用于更新网络状态
      if (requestId) {
        pendingRequests = Math.max(0, pendingRequests - 1)
      }
    } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
      // ── 请求完成或失败 ──
      pendingRequests = Math.max(0, pendingRequests - 1)
      lastNetworkActivityTime = Date.now()
    }
  })
}

/** 安全分离 CDP debugger */
function detachCDP(): void {
  if (!cdpAttached) return
  try {
    if (sniffWin && !sniffWin.isDestroyed()) {
      sniffWin.webContents.debugger.detach()
    }
  } catch { /* ignore */ }
  cdpAttached = false
  pendingRequests = 0
}

/** 触发懒加载的 JS 脚本（注入到页面） */
const TRIGGER_LAZY_LOAD_SCRIPT = `
  (function() {
    const lazySrcAttrs = ['data-src', 'data-original', 'data-lazy-src', 'data-actualsrc',
      'data-lazy', 'data-url', 'data-echo', 'data-source', 'data-origin'];
    const imgs = document.querySelectorAll('img');
    let triggered = 0;
    for (const img of imgs) {
      if (img.src && !img.src.startsWith('data:') && img.complete && img.naturalWidth > 0) continue;
      for (const attr of lazySrcAttrs) {
        const val = img.getAttribute(attr);
        if (val && val.startsWith('http')) {
          img.src = val;
          triggered++;
          break;
        }
      }
    }
    // 强制 eager loading
    const lazyImgs = document.querySelectorAll('img[loading="lazy"], img[data-src]');
    for (const img of lazyImgs) {
      img.loading = 'eager';
    }
    return triggered;
  })()
`

/** 滚动 + Canvas 捕获脚本（统一的智能滚动逻辑，同时捕获 Canvas 和触发懒加载） */
const SCROLL_AND_CAPTURE_SCRIPT = `
  new Promise(async (resolve) => {
    const captured = new Set();
    const results = [];

    function findScrollContainer() {
      const commonSelectors = [
        '.reader-container', '.comic-container', '.manga-container',
        '.chapter-content', '.reading-content', '.comic-content',
        '#comic-container', '#reader', '#viewer', '#content',
        '.viewer', '.reader', '[class*="reader"]', '[class*="viewer"]',
        '[class*="comic"]', '[class*="manga"]',
        '[class*="chapter"]', '[class*="scroll"]',
        'main', 'article', '.main-content', '.page-content'
      ];
      for (const sel of commonSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el && el.scrollHeight > el.clientHeight + 100) return el;
        } catch {}
      }
      const docEl = document.documentElement;
      const body = document.body;
      if (docEl.scrollHeight > docEl.clientHeight + 100) return docEl;
      if (body.scrollHeight > body.clientHeight + 100) return body;

      let best = null;
      let bestH = 0;
      for (const el of document.querySelectorAll('div, main, section, article')) {
        const style = getComputedStyle(el);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay') {
          if (el.scrollHeight > el.clientHeight + 100 && el.scrollHeight > bestH) {
            bestH = el.scrollHeight;
            best = el;
          }
        }
      }
      return best || docEl;
    }

    let container = findScrollContainer();
    let isDoc = container === document.documentElement || container === document.body;

    function refreshContainer() {
      const c = findScrollContainer();
      const d = c === document.documentElement || c === document.body;
      const newMax = d ? document.documentElement.scrollHeight - window.innerHeight : c.scrollHeight - c.clientHeight;
      const oldMax = isDoc ? document.documentElement.scrollHeight - window.innerHeight : container.scrollHeight - container.clientHeight;
      if (c !== container && (newMax > oldMax * 1.2 || oldMax <= 10)) {
        container = c;
        isDoc = d;
      }
    }

    const getStep = () => Math.floor((isDoc ? window.innerHeight : container.clientHeight) * 0.6);
    const getTop = () => isDoc ? (window.scrollY || document.documentElement.scrollTop) : container.scrollTop;
    const getMax = () => isDoc ? document.documentElement.scrollHeight - window.innerHeight : container.scrollHeight - container.clientHeight;
    const scroll = (n) => { if (isDoc) window.scrollBy(0, n); else container.scrollTop += n; };

    function captureCanvases() {
      let count = 0;
      for (const cvs of document.querySelectorAll('canvas')) {
        if (cvs.width < 100 || cvs.height < 100) continue;
        const rect = cvs.getBoundingClientRect();
        const cRect = isDoc ? { top: 0, bottom: window.innerHeight } : container.getBoundingClientRect();
        if (rect.bottom < cRect.top - 800 || rect.top > cRect.bottom + 800) continue;
        try {
          const ctx = cvs.getContext('2d');
          if (ctx) {
            let ok = false;
            for (const [x,y] of [[cvs.width/2,cvs.height/2],[cvs.width/4,cvs.height/4],[cvs.width*3/4,cvs.height*3/4]]) {
              if (ctx.getImageData(Math.floor(x),Math.floor(y),1,1).data[3] > 0) { ok = true; break; }
            }
            if (!ok) continue;
          }
          const d = cvs.toDataURL('image/png');
          if (d && d.length > 1000 && !captured.has(d)) { captured.add(d); results.push(d); count++; }
        } catch {}
      }
      return count;
    }

    function triggerLazy() {
      const attrs = ['data-src','data-original','data-lazy-src','data-actualsrc','data-lazy','data-url','data-echo'];
      for (const img of document.querySelectorAll('img')) {
        if (img.src && !img.src.startsWith('data:') && img.complete && img.naturalWidth > 0) continue;
        for (const a of attrs) { const v = img.getAttribute(a); if (v && v.startsWith('http')) { img.src = v; break; } }
      }
    }

    // 滚到顶部
    if (isDoc) window.scrollTo(0, 0); else container.scrollTop = 0;
    await new Promise(r => setTimeout(r, 500));
    refreshContainer();
    captureCanvases();  // 初始捕获

    let lastMax = 0, sameCount = 0, iterations = 0;
    const MAX_ITER = 500;  // 与 AUTO_SCROLL_SCRIPT 保持一致

    while (iterations < MAX_ITER) {
      iterations++;
      if (iterations % 5 === 0) refreshContainer();

      triggerLazy();
      captureCanvases();
      scroll(getStep());
      // 每步等待 350ms（与自动滚动一致）
      await new Promise(r => setTimeout(r, 350));

      const top = getTop(), max = getMax();

      if (top >= max - 10) {
        // 到底了，多等一会让图片和后续内容加载
        await new Promise(r => setTimeout(r, 2000));
        triggerLazy();
        captureCanvases();
        refreshContainer();
        const newMax = getMax();
        if (newMax > max + 30) { sameCount = 0; lastMax = newMax; continue; }
        // 再给一次机会
        await new Promise(r => setTimeout(r, 1500));
        captureCanvases();
        refreshContainer();
        const newMax2 = getMax();
        if (newMax2 > max + 30) { sameCount = 0; lastMax = newMax2; continue; }
        break;
      }

      if (max === lastMax) {
        sameCount++;
        // 与自动滚动一致的宽松阈值
        if (sameCount >= 15) {
          refreshContainer();
          const newMax = getMax();
          if (newMax > max + 30) { sameCount = 0; lastMax = newMax; continue; }
          // 在同高度但还没到底的情况下，继续尝试滚动
          if (top < max - 50) { sameCount = 8; continue; }
          break;
        }
      } else {
        sameCount = 0;
        lastMax = max;
      }
    }

    // 最终捕获
    triggerLazy();
    captureCanvases();
    resolve(results);
  })
`

/** 启动嗅探：创建预览窗口，通过 CDP 持续监听所有网络请求 */
ipcMain.handle('sniff:start', async (_event, url: string): Promise<boolean> => {
  try {
    // 如果已有嗅探窗口，先清理
    if (sniffWin && !sniffWin.isDestroyed()) {
      detachCDP()
      sniffWin.close()
    }
    sniffedImages.clear()
    sniffedRequestHeaders.clear()
    pendingRequests = 0
    lastNetworkActivityTime = Date.now()

    // 创建独立 session
    sniffSession = session.fromPartition('persist:sniffer')

    // 创建可见的嗅探窗口（预览模式：用户可以实时看到页面加载过程）
    sniffWin = new BrowserWindow({
      width: 1100,
      height: 750,
      show: sniffWinVisible,
      title: '嗅探预览 - MangaBox',
      autoHideMenuBar: true,
      webPreferences: {
        session: sniffSession,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: false
      }
    })

    // 同步页面标题到窗口标题
    sniffWin.webContents.on('page-title-updated', (_e, title) => {
      if (sniffWin && !sniffWin.isDestroyed()) {
        sniffWin.setTitle(`${title} - MangaBox 嗅探预览`)
      }
    })

    // 通知前端嗅探窗口 URL 变化（用户在预览中手动导航时）
    sniffWin.webContents.on('did-navigate', (_e, navUrl) => {
      const mainWin = getMainWin()
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('sniff:url-changed', navUrl)
      }
    })
    sniffWin.webContents.on('did-navigate-in-page', (_e, navUrl) => {
      const mainWin = getMainWin()
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('sniff:url-changed', navUrl)
      }
    })

    sniffWin.on('closed', () => {
      detachCDP()
      sniffWin = null
      // 通知渲染进程嗅探窗口已被用户手动关闭
      const mainWin = getMainWin()
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('sniff:window-closed')
      }
    })

    // ★ 关键：在页面开始加载前就附加 CDP，这样不会遗漏任何请求
    // CDP 会持续监听，即使 sniff:start 返回后，用户手动操作（滚动、翻页、点击）
    // 触发的新图片请求也会被 CDP 捕获并推送到前端
    attachCDP()

    // 加载页面
    await sniffWin.loadURL(url)

    // 使用网络空闲检测代替固定等待——等到连续 2 秒无新请求
    await waitForNetworkIdle(2000, 15000)

    // 触发懒加载
    try {
      await sniffWin.webContents.executeJavaScript(TRIGGER_LAZY_LOAD_SCRIPT)
    } catch { /* 非致命 */ }

    // 再等待网络空闲（懒加载触发的新请求）
    await waitForNetworkIdle(2000, 10000)

    // ★ 注意：此处 return 后，CDP 仍然持续工作！
    // 用户在预览窗口中的任何操作（手动滚动、点击翻页、导航）
    // 触发的新图片请求都会继续被 CDP 捕获并实时推送给前端
    return true
  } catch (err) {
    console.error('sniff:start failed:', err)
    return false
  }
})

/** 停止嗅探：分离 CDP 并关闭窗口 */
ipcMain.handle('sniff:stop', async (): Promise<void> => {
  detachCDP()
  if (sniffWin && !sniffWin.isDestroyed()) {
    sniffWin.close()
  }
  sniffWin = null
  sniffedImages.clear()
  sniffedRequestHeaders.clear()
})

/**
 * 在嗅探窗口中手动触发懒加载 + 重新扫描
 * 用于用户手动操作后，确保所有图片都被抓取
 */
ipcMain.handle('sniff:triggerLazy', async (): Promise<number> => {
  if (!sniffWin || sniffWin.isDestroyed()) return 0
  try {
    const countBefore = sniffedImages.size
    await sniffWin.webContents.executeJavaScript(TRIGGER_LAZY_LOAD_SCRIPT)
    // 等待新请求完成
    await waitForNetworkIdle(1500, 8000)
    return sniffedImages.size - countBefore
  } catch {
    return 0
  }
})

/**
 * 切换嗅探窗口可见性（显示/隐藏预览）
 * 如果窗口不存在，只更新 sniffWinVisible 标志供下次创建时使用
 */
ipcMain.handle('sniff:togglePreview', async (_event, visible: boolean): Promise<boolean> => {
  sniffWinVisible = visible
  if (sniffWin && !sniffWin.isDestroyed()) {
    if (visible) {
      sniffWin.show()
      sniffWin.focus()
    } else {
      sniffWin.hide()
    }
  }
  return sniffWinVisible
})

/** 获取嗅探预览窗口当前是否可见 */
ipcMain.handle('sniff:isPreviewVisible', async (): Promise<boolean> => {
  if (sniffWin && !sniffWin.isDestroyed()) {
    return sniffWin.isVisible()
  }
  return false
})

/** 聚焦嗅探预览窗口 */
ipcMain.handle('sniff:focusPreview', async (): Promise<void> => {
  if (sniffWin && !sniffWin.isDestroyed()) {
    sniffWin.show()
    sniffWin.focus()
  }
})

/** 检查当前嗅探 session 是否有指定 URL 的 Cookie（用于判断登录状态） */
ipcMain.handle('sniff:checkLogin', async (_event, url: string): Promise<{ hasCookies: boolean; cookieCount: number }> => {
  try {
    if (!sniffSession) {
      sniffSession = session.fromPartition('persist:sniffer')
    }
    const cookies = await sniffSession.cookies.get({ url })
    return {
      hasCookies: cookies.length > 0,
      cookieCount: cookies.length
    }
  } catch {
    return { hasCookies: false, cookieCount: 0 }
  }
})

/** 清除嗅探 session 的所有 Cookie（用于「退出登录」） */
ipcMain.handle('sniff:clearCookies', async (_event, url?: string): Promise<boolean> => {
  try {
    if (!sniffSession) return true
    if (url) {
      // 只清除指定 URL 的 Cookie
      const cookies = await sniffSession.cookies.get({ url })
      for (const cookie of cookies) {
        const cookieUrl = `${cookie.secure ? 'https' : 'http'}://${cookie.domain?.replace(/^\./, '')}${cookie.path || '/'}`
        await sniffSession.cookies.remove(cookieUrl, cookie.name)
      }
    } else {
      // 清除所有 Cookie
      await sniffSession.clearStorageData({ storages: ['cookies'] })
    }
    return true
  } catch (err) {
    console.error('sniff:clearCookies failed:', err)
    return false
  }
})

/** 获取当前已嗅探到的所有图片列表 */
ipcMain.handle('sniff:getImages', async (): Promise<Array<{ url: string; size: number; contentType: string }>> => {
  return Array.from(sniffedImages.values())
})

/** 在嗅探窗口中执行 JS */
ipcMain.handle('sniff:executeJS', async (_event, code: string): Promise<unknown> => {
  if (!sniffWin || sniffWin.isDestroyed()) return null
  try {
    return await sniffWin.webContents.executeJavaScript(code)
  } catch (err) {
    console.error('sniff:executeJS failed:', err)
    return null
  }
})

/** 获取嗅探窗口的当前 URL */
ipcMain.handle('sniff:getCurrentURL', async (): Promise<string> => {
  if (!sniffWin || sniffWin.isDestroyed()) return ''
  return sniffWin.webContents.getURL()
})

/** 嗅探窗口导航到新 URL（保持 CDP 持续监听） */
ipcMain.handle('sniff:navigate', async (_event, url: string): Promise<boolean> => {
  if (!sniffWin || sniffWin.isDestroyed()) return false
  try {
    // CDP 保持附加状态，导航产生的新请求会继续被捕获
    await sniffWin.loadURL(url)
    // 等待初始加载
    await waitForNetworkIdle(2000, 10000)
    // 触发懒加载
    try {
      await sniffWin.webContents.executeJavaScript(TRIGGER_LAZY_LOAD_SCRIPT)
    } catch { /* 非致命 */ }
    await waitForNetworkIdle(1500, 8000)
    return true
  } catch {
    return false
  }
})

/** 清空已嗅探的图片列表 */
ipcMain.handle('sniff:clearImages', async (): Promise<void> => {
  sniffedImages.clear()
  sniffedRequestHeaders.clear()
})

/** 自动滚动嗅探页面（触发懒加载 + Canvas 捕获） */
ipcMain.handle('sniff:autoScroll', async (): Promise<{ newNetworkImages: number; canvasDataUrls: string[] }> => {
  if (!sniffWin || sniffWin.isDestroyed()) return { newNetworkImages: 0, canvasDataUrls: [] }
  try {
    const countBefore = sniffedImages.size

    // ★ 使用带 Canvas 捕获的滚动脚本（统一逻辑）
    // 这样对 Canvas 渲染的漫画网站（如 CCC 漫画）也能在自动滚动时同步捕获
    const canvasDataUrls: string[] = await sniffWin.webContents.executeJavaScript(SCROLL_AND_CAPTURE_SCRIPT, true) || []

    // 滚动完成后，用网络空闲检测等待最后一批请求完成
    await waitForNetworkIdle(2500, 15000)

    return {
      newNetworkImages: sniffedImages.size - countBefore,
      canvasDataUrls
    }
  } catch (err) {
    console.error('sniff:autoScroll failed:', err)
    return { newNetworkImages: 0, canvasDataUrls: [] }
  }
})

/** 从页面中的 Canvas 元素提取图片 */
ipcMain.handle('sniff:captureCanvas', async (): Promise<string[]> => {
  if (!sniffWin || sniffWin.isDestroyed()) return []
  try {
    const dataUrls: string[] = await sniffWin.webContents.executeJavaScript(`
      (function() {
        const results = [];
        for (const cvs of document.querySelectorAll('canvas')) {
          if (cvs.width < 100 || cvs.height < 100) continue;
          try {
            const ctx = cvs.getContext('2d');
            if (ctx) {
              let hasContent = false;
              for (const [x, y] of [
                [cvs.width/2, cvs.height/2], [cvs.width/4, cvs.height/4],
                [cvs.width*3/4, cvs.height/4], [cvs.width/4, cvs.height*3/4],
                [cvs.width*3/4, cvs.height*3/4], [cvs.width/2, cvs.height/4],
                [cvs.width/2, cvs.height*3/4]
              ]) {
                if (ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3] > 0) { hasContent = true; break; }
              }
              if (!hasContent) continue;
            }
            const d = cvs.toDataURL('image/png');
            if (d && d.length > 1000) results.push(d);
          } catch {}
        }
        return results;
      })()
    `)
    return dataUrls || []
  } catch (err) {
    console.error('sniff:captureCanvas failed:', err)
    return []
  }
})

/** 自动滚动 + Canvas 连续捕获 */
ipcMain.handle('sniff:scrollAndCapture', async (): Promise<string[]> => {
  if (!sniffWin || sniffWin.isDestroyed()) return []
  try {
    const mainWin = getMainWin()

    const allDataUrls: string[] = await sniffWin.webContents.executeJavaScript(SCROLL_AND_CAPTURE_SCRIPT, true)

    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('sniff:download-progress', {
        current: allDataUrls?.length || 0,
        total: allDataUrls?.length || 0,
        downloaded: allDataUrls?.length || 0
      })
    }

    return allDataUrls || []
  } catch (err) {
    console.error('sniff:scrollAndCapture failed:', err)
    return []
  }
})

/** 将 base64 data URL 保存为图片文件 */
ipcMain.handle(
  'sniff:saveDataUrlsToLibrary',
  async (_event, dataUrls: string[], mangaTitle: string, libraryDir: string): Promise<boolean> => {
    try {
      const trimmed = mangaTitle.trim() || `抓取_${Date.now()}`
      let destPath = join(libraryDir, trimmed)
      if (existsSync(destPath)) {
        destPath = join(libraryDir, `${trimmed}_${Date.now()}`)
      }
      mkdirSync(destPath, { recursive: true })

      const mainWin = getMainWin()
      let saved = 0

      for (let i = 0; i < dataUrls.length; i++) {
        try {
          const dataUrl = dataUrls[i]
          // 解析 data URL: data:image/png;base64,xxxx
          const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
          if (!match) continue

          const ext = match[1] === 'jpeg' ? '.jpg' : `.${match[1]}`
          const buffer = Buffer.from(match[2], 'base64')

          // 过滤太小的图片（< 10KB 可能是空白 canvas）
          if (buffer.length < 10240) continue

          const filename = `${String(saved + 1).padStart(3, '0')}${ext}`
          writeFileSync(join(destPath, filename), buffer)
          saved++
        } catch { /* skip bad data URL */ }

        // 推送进度
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('sniff:download-progress', {
            current: i + 1,
            total: dataUrls.length,
            downloaded: saved
          })
        }
      }

      // 如果一张都没保存成功，清理空目录
      if (saved === 0) {
        try { rmdirSync(destPath) } catch { /* ignore */ }
        return false
      }

      return true
    } catch (err) {
      console.error('sniff:saveDataUrlsToLibrary failed:', err)
      return false
    }
  }
)

/**
 * 统一保存抓取图片到书库（合并 Canvas + 网络图片，支持单话/系列模式）
 * mode: 'single' = 直接保存为单话, 'series' = 保存到系列下的一话
 * seriesPath: 当 mode='series' 时，指定已有系列目录的路径（为空则新建系列）
 * seriesName: 当 mode='series' 且 seriesPath 为空时，用于创建新系列的名称
 * chapterName: 话/章节名称（单话模式就是漫画名，系列模式就是章节名）
 * canvasDataUrls: Canvas 捕获的 data URL 数组
 * networkUrls: 网络嗅探的图片 URL 数组
 */
ipcMain.handle(
  'sniff:saveGrab',
  async (
    _event,
    opts: {
      mode: 'single' | 'series'
      seriesPath: string
      seriesName: string
      chapterName: string
      canvasDataUrls: string[]
      networkUrls: string[]
      libraryDir: string
    }
  ): Promise<{ ok: boolean; savedCount: number }> => {
    try {
      const mainWin = getMainWin()
      const { mode, canvasDataUrls, networkUrls, libraryDir } = opts
      const chapterName = opts.chapterName.trim() || `抓取_${Date.now()}`
      const totalItems = canvasDataUrls.length + networkUrls.length

      let destPath: string

      if (mode === 'series') {
        // ── 系列模式：保存到系列目录下的子目录 ──
        let seriesDir: string

        if (opts.seriesPath && existsSync(opts.seriesPath)) {
          // 使用已有系列
          seriesDir = opts.seriesPath
        } else {
          // 创建新系列
          const seriesName = (opts.seriesName || chapterName).trim()
          seriesDir = join(libraryDir, seriesName)
          if (!existsSync(seriesDir)) {
            mkdirSync(seriesDir, { recursive: true })
            writeFileSync(join(seriesDir, '.manga-series'), '', 'utf-8')
          }
        }

        // 在系列下创建章节子目录
        destPath = join(seriesDir, chapterName)
        if (existsSync(destPath)) {
          destPath = join(seriesDir, `${chapterName}_${Date.now()}`)
        }
        mkdirSync(destPath, { recursive: true })
      } else {
        // ── 单话模式：直接在书库根目录创建 ──
        destPath = join(libraryDir, chapterName)
        if (existsSync(destPath)) {
          destPath = join(libraryDir, `${chapterName}_${Date.now()}`)
        }
        mkdirSync(destPath, { recursive: true })
      }

      let saved = 0
      let progress = 0

      // 1. 先保存 Canvas 图片（通常是漫画主体内容）
      for (let i = 0; i < canvasDataUrls.length; i++) {
        progress++
        try {
          const dataUrl = canvasDataUrls[i]
          const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/)
          if (!match) continue

          const ext = match[1] === 'jpeg' ? '.jpg' : `.${match[1]}`
          const buffer = Buffer.from(match[2], 'base64')
          if (buffer.length < 10240) continue  // 过滤太小

          const filename = `${String(saved + 1).padStart(3, '0')}${ext}`
          writeFileSync(join(destPath, filename), buffer)
          saved++
        } catch { /* skip */ }

        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('sniff:download-progress', {
            current: progress,
            total: totalItems,
            downloaded: saved
          })
        }
      }

      // 2. 再保存网络图片
      for (let i = 0; i < networkUrls.length; i++) {
        progress++
        const url = networkUrls[i]
        let ext = '.jpg'
        try {
          const pathname = new URL(url).pathname.toLowerCase()
          const m = pathname.match(/\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?|$)/i)
          if (m) ext = `.${m[1]}`
        } catch { /* fallback */ }

        const filename = `${String(saved + 1).padStart(3, '0')}${ext}`
        const ok = await downloadImage(url, join(destPath, filename))
        if (ok) saved++

        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('sniff:download-progress', {
            current: progress,
            total: totalItems,
            downloaded: saved
          })
        }
      }

      // 如果一张都没保存成功，清理空目录
      if (saved === 0) {
        try { rmdirSync(destPath) } catch { /* ignore */ }
        return { ok: false, savedCount: 0 }
      }

      return { ok: true, savedCount: saved }
    } catch (err) {
      console.error('sniff:saveGrab failed:', err)
      return { ok: false, savedCount: 0 }
    }
  }
)

/** 获取书库中所有系列目录信息 */
ipcMain.handle(
  'sniff:getSeriesList',
  async (_event, libraryDir: string): Promise<Array<{ name: string; path: string; chapterCount: number }>> => {
    try {
      if (!existsSync(libraryDir)) return []
      const entries = readdirSync(libraryDir, { withFileTypes: true })
      const seriesList: Array<{ name: string; path: string; chapterCount: number }> = []

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const fullPath = join(libraryDir, entry.name)
        if (checkIsSeries(fullPath)) {
          const chapters = readdirSync(fullPath, { withFileTypes: true })
            .filter((e) => e.isDirectory())
          seriesList.push({
            name: entry.name,
            path: fullPath,
            chapterCount: chapters.length
          })
        }
      }

      return seriesList.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    } catch (err) {
      console.error('sniff:getSeriesList failed:', err)
      return []
    }
  }
)

/**
 * 从嗅探 session 中获取指定 URL 的 Cookie 字符串
 * （用于下载时透传，解决某些 CDN 需要登录态的问题）
 */
async function getSessionCookies(url: string): Promise<string> {
  try {
    if (!sniffSession) return ''
    const cookies = await sniffSession.cookies.get({ url })
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  } catch {
    return ''
  }
}

/**
 * 下载图片并保存到指定目录（带重试 + Cookie 透传）
 * 优先使用 CDP 捕获的原始请求头（含 Cookie/Referer），
 * 如果没有则从 sniffSession.cookies 获取 Cookie 作为兜底
 */
function downloadImage(imageUrl: string, destPath: string, retries = 3): Promise<boolean> {
  return new Promise((resolve) => {
    const doDownload = async (attempt: number): Promise<void> => {
      try {
        const urlObj = new URL(imageUrl)
        const getter = urlObj.protocol === 'https:' ? httpsGet : httpGet

        // ★ 构建请求头：优先透传 CDP 捕获的原始请求头
        const originalHeaders = sniffedRequestHeaders.get(imageUrl)
        const headers: Record<string, string> = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': originalHeaders?.['Referer'] || originalHeaders?.['referer'] || urlObj.origin,
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        }

        // 透传 Cookie：优先用 CDP 捕获的，其次从 session 获取
        if (originalHeaders?.['Cookie'] || originalHeaders?.['cookie']) {
          headers['Cookie'] = originalHeaders['Cookie'] || originalHeaders['cookie']
        } else {
          const sessionCookie = await getSessionCookies(imageUrl)
          if (sessionCookie) headers['Cookie'] = sessionCookie
        }

        // 透传其他关键请求头
        if (originalHeaders?.['Origin'] || originalHeaders?.['origin']) {
          headers['Origin'] = originalHeaders['Origin'] || originalHeaders['origin']
        }

        const req = getter(imageUrl, { headers }, (res) => {
          // 跟随重定向
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            downloadImage(res.headers.location, destPath, attempt).then(resolve)
            return
          }
          if (!res.statusCode || res.statusCode >= 400) {
            if (attempt < retries) {
              setTimeout(() => doDownload(attempt + 1), 500 * attempt)
            } else {
              resolve(false)
            }
            return
          }
          const file = createWriteStream(destPath)
          res.pipe(file)
          file.on('finish', () => { file.close(); resolve(true) })
          file.on('error', () => {
            if (attempt < retries) {
              setTimeout(() => doDownload(attempt + 1), 500 * attempt)
            } else {
              resolve(false)
            }
          })
        })
        req.on('error', () => {
          if (attempt < retries) {
            setTimeout(() => doDownload(attempt + 1), 500 * attempt)
          } else {
            resolve(false)
          }
        })
        req.setTimeout(30000, () => {
          req.destroy()
          if (attempt < retries) {
            setTimeout(() => doDownload(attempt + 1), 500 * attempt)
          } else {
            resolve(false)
          }
        })
      } catch {
        resolve(false)
      }
    }
    doDownload(1)
  })
}

/** 将选中的图片 URL 列表下载到书库中作为一本漫画 */
ipcMain.handle(
  'sniff:saveToLibrary',
  async (_event, imageUrls: string[], mangaTitle: string, libraryDir: string): Promise<boolean> => {
    try {
      const trimmed = mangaTitle.trim() || `抓取_${Date.now()}`
      let destPath = join(libraryDir, trimmed)
      if (existsSync(destPath)) {
        destPath = join(libraryDir, `${trimmed}_${Date.now()}`)
      }
      mkdirSync(destPath, { recursive: true })

      // 通知进度
      const mainWin = getMainWin()
      let downloaded = 0

      for (let i = 0; i < imageUrls.length; i++) {
        const url = imageUrls[i]
        // 从 URL 推断后缀
        let ext = '.jpg'
        try {
          const pathname = new URL(url).pathname.toLowerCase()
          const match = pathname.match(/\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?|$)/i)
          if (match) ext = `.${match[1]}`
        } catch { /* fallback to .jpg */ }

        const filename = `${String(i + 1).padStart(3, '0')}${ext}`
        const ok = await downloadImage(url, join(destPath, filename))
        if (ok) downloaded++

        // 推送进度
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('sniff:download-progress', {
            current: i + 1,
            total: imageUrls.length,
            downloaded
          })
        }
      }

      return downloaded > 0
    } catch (err) {
      console.error('sniff:saveToLibrary failed:', err)
      return false
    }
  }
)
