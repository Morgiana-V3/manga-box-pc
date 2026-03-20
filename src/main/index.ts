import { app, BrowserWindow, ipcMain, dialog, protocol, shell } from 'electron'
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
  writeFileSync
} from 'fs'
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

/** 判断文件夹是否为系列（包含子目录） */
function checkIsSeries(folderPath: string): boolean {
  try {
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

ipcMain.handle('fs:getDefaultLibraryDir', () => DEFAULT_LIBRARY_DIR)

/** 导入漫画：复制到书库目录，文件夹自动重命名图片 */
ipcMain.handle(
  'fs:importBook',
  async (_event, sourcePath: string, destDir: string): Promise<boolean> => {
    if (!existsSync(sourcePath)) return false

    mkdirSync(destDir, { recursive: true })

    const name = basename(sourcePath)
    const ext = extname(name)
    const base = basename(name, ext)

    let destPath = join(destDir, name)
    if (existsSync(destPath)) {
      destPath = join(destDir, `${base}_${Date.now()}${ext}`)
    }

    try {
      const stat = statSync(sourcePath)
      if (stat.isDirectory()) {
        cpSync(sourcePath, destPath, { recursive: true })
        // 导入后自动按序号重命名
        autoRenameImages(destPath)
      } else {
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

      if (hasSubs) {
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
