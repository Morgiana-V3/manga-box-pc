<template>
  <div class="edit-view" @pointermove="onPointerMove" @pointerup="onPointerUp">
    <!-- 顶栏 -->
    <div class="edit-header">
      <button class="back-btn" @click="goBack">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <div class="header-info">
        <h2>编辑{{ isSeries ? '系列' : '漫画' }}</h2>
        <span class="header-sub">拖拽缩略图可调整顺序，拖到右上角垃圾桶可删除</span>
      </div>
      <div class="header-actions">
        <!-- 垃圾桶：拖拽时在取消按钮左侧显示 -->
        <Transition name="trash-fade">
          <div
            v-if="dragKey"
            ref="trashRef"
            class="header-trash"
            :class="{ hover: trashHover }"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </div>
        </Transition>
        <button class="btn btn-ghost" @click="goBack" :disabled="isSaving">取消</button>
        <button class="btn btn-primary" @click="handleSave" :disabled="isSaving || isLoading">
          <svg v-if="isSaving" class="spinning" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
          </svg>
          {{ isSaving ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>

    <!-- 加载 -->
    <div v-if="isLoading" class="loading-state">
      <div class="spinner" />
      <p>加载中...</p>
    </div>

    <div v-else class="edit-body">
      <!-- 名称编辑 -->
      <div class="name-section">
        <label class="field-label">{{ isSeries ? '系列名称' : '漫画名称' }}</label>
        <input v-model="editTitle" class="name-input" type="text" @keydown.enter.prevent />
        <p class="field-hint">修改后将重命名对应目录</p>
      </div>

      <!-- 排序区 -->
      <div class="order-section">
        <div class="order-header">
          <span class="field-label">{{ isSeries ? '话数顺序' : '页面顺序' }}</span>
          <div class="order-actions">
            <span class="order-count">{{ items.length }} {{ isSeries ? '话' : '页' }}</span>
            <button v-if="isSeries" class="btn btn-ghost btn-sm" @click="handleAddChapter">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
              </svg>
              导入新话
            </button>
          </div>
        </div>

        <div ref="gridRef" class="item-grid">
          <TransitionGroup name="sort" tag="div" class="item-grid-inner">
            <div
              v-for="(item, idx) in renderItems"
              :key="item.key"
              class="edit-item"
              :class="{ 'is-dragging': item.key === dragKey }"
              @pointerdown="onPointerDown($event, item.key)"
            >
              <div class="item-cover">
                <img
                  v-if="item.src"
                  :src="item.src"
                  loading="lazy"
                  draggable="false"
                  @error="(e) => ((e.target as HTMLImageElement).style.display='none')"
                />
                <div v-else class="cover-placeholder">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14M4 19h14a2 2 0 010 4H4v-4z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                </div>
                <div class="drag-handle-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                    <line x1="9" y1="5" x2="9" y2="19"/><line x1="15" y1="5" x2="15" y2="19"/>
                  </svg>
                </div>
              </div>

              <div class="item-label">
                <span class="item-index">{{ idx + 1 }}</span>
                <!-- 系列：话数名可内联编辑 -->
                <input
                  v-if="isSeries && editingKey === item.key"
                  :ref="(el) => { if (el) (el as HTMLInputElement).focus() }"
                  v-model="item.name"
                  class="inline-input"
                  @blur="editingKey = null"
                  @keydown.enter.prevent="editingKey = null"
                  @keydown.escape.prevent="cancelInlineEdit(item)"
                  @pointerdown.stop
                />
                <span
                  v-else
                  class="item-name"
                  :title="isSeries ? '双击重命名' : item.name"
                  @dblclick="isSeries && startInlineEdit(item)"
                >{{ item.name }}</span>
              </div>
            </div>
          </TransitionGroup>
        </div>

        <p v-if="isSeries" class="field-hint">双击话数名称可重命名；拖拽封面调整顺序</p>

        <!-- 已删除项提示 -->
        <div v-if="deletedItems.length > 0" class="deleted-hint">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>已标记删除 {{ deletedItems.length }} {{ isSeries ? '话' : '页' }}，保存后生效</span>
        </div>
      </div>
    </div>

    <!-- 跟手 Ghost（Teleport 到 body） -->
    <Teleport to="body">
      <div v-if="ghost" class="drag-ghost-fixed" :class="{ 'over-trash': trashHover }" :style="ghostStyle">
        <img v-if="ghost.src" :src="ghost.src" draggable="false" />
        <div v-else class="ghost-placeholder">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14M4 19h14a2 2 0 010 4H4v-4z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
      </div>
    </Teleport>

    <!-- 删除确认弹窗 -->
    <Transition name="fade">
      <div v-if="deleteConfirm" class="modal-backdrop" @click.self="cancelDelete">
        <div class="modal-card">
          <h3 class="modal-title">确认删除</h3>
          <p class="modal-desc">
            确定要删除{{ isSeries ? '这一话' : '这一页' }}吗？保存后将无法恢复。
          </p>
          <div class="delete-preview">
            <div class="delete-preview-cover">
              <img v-if="deleteConfirm.src" :src="deleteConfirm.src" draggable="false" />
              <div v-else class="cover-placeholder">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14M4 19h14a2 2 0 010 4H4v-4z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </div>
            </div>
            <span class="delete-preview-name">{{ deleteConfirm.name }}</span>
          </div>
          <div class="modal-actions">
            <button class="btn btn-ghost" @click="cancelDelete">取消</button>
            <button class="btn btn-danger" @click="confirmDelete">删除</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toastMsg" class="toast" :class="toastType">{{ toastMsg }}</div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLibraryStore } from '../stores/library'

interface EditItem {
  key: string           // 原始文件名/目录名
  name: string          // 显示名（可编辑）
  originalName: string  // 编辑前的名字（用于取消还原）
  src: string
}

interface DeletedItem {
  key: string
  name: string
  src: string
}

const route = useRoute()
const router = useRouter()
const library = useLibraryStore()

const libraryBook = computed(() => library.getBook(route.params.id as string))
const chapterPath = computed<string | null>(() => {
  const raw = route.query.chapterPath
  if (typeof raw !== 'string' || !raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
})
const chapterTitle = computed<string | null>(() => {
  const raw = route.query.chapterTitle
  if (typeof raw !== 'string' || !raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
})
const fromSeriesId = computed<string | null>(() => {
  const raw = route.query.fromSeries
  return typeof raw === 'string' && raw ? raw : null
})

const target = computed(() => {
  if (chapterPath.value) {
    return {
      path: chapterPath.value,
      title: chapterTitle.value ?? '章节',
      type: 'folder' as const,
      kind: 'single' as const,
      isChapter: true
    }
  }
  const b = libraryBook.value
  if (!b) return null
  return {
    path: b.path,
    title: b.title,
    type: b.type,
    kind: b.kind,
    isChapter: false
  }
})

const isSeries = computed(() => target.value?.kind === 'series')

const isLoading = ref(true)
const isSaving = ref(false)
const editTitle = ref('')
const items = ref<EditItem[]>([])

// ─── 已删除的项（保存时才真正删除文件） ───
const deletedItems = ref<DeletedItem[]>([])

// ─── 垃圾桶拖放区状态 ───
const trashHover = ref(false)
const trashRef = ref<HTMLElement | null>(null)

// ─── 删除确认弹窗 ───
const deleteConfirm = ref<{ key: string; name: string; src: string } | null>(null)

// ─── 内联编辑（系列话数名） ───
const editingKey = ref<string | null>(null)
function startInlineEdit(item: EditItem): void {
  item.originalName = item.name
  editingKey.value = item.key
}
function cancelInlineEdit(item: EditItem): void {
  item.name = item.originalName
  editingKey.value = null
}

// ─── 拖拽状态 ───
const dragKey = ref<string | null>(null)
const insertIdx = ref(-1)
const gridRef = ref<HTMLElement | null>(null)

interface GhostData { src: string; w: number; h: number }
const ghost = ref<GhostData | null>(null)
const ghostX = ref(0)
const ghostY = ref(0)
let ghostOffsetX = 0
let ghostOffsetY = 0

const ghostStyle = computed(() => ({
  left: ghostX.value + 'px',
  top: ghostY.value + 'px',
  width: ghost.value ? ghost.value.w + 'px' : '0'
}))

// 渲染列表：被拖项保留在数组中，直接移动到目标位置，用 is-dragging 样式显示为占位框
// 这样 TransitionGroup 永远不会看到 key 的增删，放手时 zero 抖动
const renderItems = computed<EditItem[]>(() => {
  if (!dragKey.value || insertIdx.value < 0) return items.value

  const fromIdx = items.value.findIndex((i) => i.key === dragKey.value)
  if (fromIdx < 0) return items.value

  const arr = [...items.value]
  const [moved] = arr.splice(fromIdx, 1)
  arr.splice(Math.min(insertIdx.value, arr.length), 0, moved)
  return arr
})

// ─── 拖拽逻辑 ───
function onPointerDown(e: PointerEvent, key: string): void {
  // 只响应主按钮（左键/触摸）
  if (e.button !== 0 && e.pointerType !== 'touch') return
  e.preventDefault()

  const itemEl = (e.currentTarget as HTMLElement)
  const coverEl = itemEl.querySelector('.item-cover') as HTMLElement | null
  const rect = coverEl ? coverEl.getBoundingClientRect() : itemEl.getBoundingClientRect()

  dragKey.value = key
  insertIdx.value = items.value.findIndex((i) => i.key === key)

  const srcItem = items.value.find((i) => i.key === key)
  ghost.value = { src: srcItem?.src ?? '', w: rect.width, h: rect.height }
  ghostOffsetX = e.clientX - rect.left
  ghostOffsetY = e.clientY - rect.top
  ghostX.value = e.clientX - ghostOffsetX
  ghostY.value = e.clientY - ghostOffsetY

  // 防止文字被选中
  document.body.style.userSelect = 'none'
}

function onPointerMove(e: PointerEvent): void {
  if (!dragKey.value) return

  ghostX.value = e.clientX - ghostOffsetX
  ghostY.value = e.clientY - ghostOffsetY

  // 检测 Ghost 图片是否与垃圾桶区域重叠（矩形碰撞检测）
  if (trashRef.value && ghost.value) {
    const trashRect = trashRef.value.getBoundingClientRect()
    // Ghost 的实际矩形范围
    const gx = ghostX.value
    const gy = ghostY.value
    const gw = ghost.value.w
    const gh = gw * 1.5 // aspect-ratio 2/3
    // 两个矩形有任意重叠即命中
    trashHover.value =
      gx < trashRect.right &&
      gx + gw > trashRect.left &&
      gy < trashRect.bottom &&
      gy + gh > trashRect.top
  }

  insertIdx.value = findInsertIdx(e.clientX, e.clientY)
}

function onPointerUp(): void {
  if (!dragKey.value) { cleanupDrag(); return }

  // 如果松手时位于垃圾桶上 → 弹出确认删除
  if (trashHover.value) {
    const item = items.value.find((i) => i.key === dragKey.value)
    if (item) {
      deleteConfirm.value = { key: item.key, name: item.name, src: item.src }
    }
    trashHover.value = false
    cleanupDrag()
    return
  }

  if (insertIdx.value >= 0) {
    items.value = renderItems.value.slice()
  }
  cleanupDrag()
}

// ─── 删除确认操作 ───
function confirmDelete(): void {
  if (!deleteConfirm.value) return
  const { key, name, src } = deleteConfirm.value

  // 从 items 中移除
  const idx = items.value.findIndex((i) => i.key === key)
  if (idx >= 0) {
    items.value.splice(idx, 1)
  }

  // 记录到已删除列表（保存时才真正操作文件系统）
  deletedItems.value.push({ key, name, src })
  deleteConfirm.value = null
  showToast(`已标记删除「${name}」，保存后生效`, 'success')
}

function cancelDelete(): void {
  deleteConfirm.value = null
}

function findInsertIdx(cx: number, cy: number): number {
  const grid = gridRef.value
  if (!grid) return 0

  const els = Array.from(
    grid.querySelectorAll<HTMLElement>('.edit-item:not(.is-dragging)')
  )
  if (els.length === 0) return 0

  let best = els.length
  let minDist = Infinity

  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect()
    // 同行判断（允许 ±30px 的行内误差）
    const onRow = cy >= r.top - 30 && cy <= r.bottom + 30
    if (!onRow) continue

    const cx2 = r.left + r.width / 2
    const dist = Math.abs(cx - cx2)
    if (dist < minDist) {
      minDist = dist
      best = cx < cx2 ? i : i + 1
    }
  }

  // 如果没有同行（拖到行间隙），按距离最近的整行兜底
  if (minDist === Infinity) {
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect()
      const cy2 = r.top + r.height / 2
      const cx2 = r.left + r.width / 2
      const dist = Math.hypot(cx - cx2, cy - cy2)
      if (dist < minDist) {
        minDist = dist
        best = cx < cx2 ? i : i + 1
      }
    }
  }

  return best
}

function cleanupDrag(): void {
  dragKey.value = null
  insertIdx.value = -1
  ghost.value = null
  document.body.style.userSelect = ''
}

onUnmounted(cleanupDrag)

// ─── 加载数据 ───
onMounted(async () => {
  if (!target.value) { router.push('/'); return }
  editTitle.value = target.value.title
  isLoading.value = true
  try {
    if (isSeries.value) {
      const chapters = await window.electronAPI.getChapters(target.value.path)
      items.value = chapters.map((ch) => ({
        key: ch.title,
        name: ch.title,
        originalName: ch.title,
        src: ch.cover ? `manga-file://${encodeURIComponent(ch.cover)}` : ''
      }))
    } else {
      const pages = await window.electronAPI.getPages(target.value.path, target.value.type)
      items.value = pages.map((url) => {
        const noQuery = url.split('?')[0].split('#')[0]
        const decoded = decodeURIComponent(noQuery.replace('manga-file://', ''))
        const filename = decoded.replace(/\\/g, '/').split('/').pop() ?? decoded
        return { key: filename, name: filename, originalName: filename, src: url }
      })
    }
  } finally {
    isLoading.value = false
  }
})

// ─── 导入新话（系列） ───
async function handleAddChapter(): Promise<void> {
  if (!target.value) return
  const folderPath = await window.electronAPI.openFolder()
  if (!folderPath) return

  isLoading.value = true
  try {
    await window.electronAPI.importBook(folderPath, target.value.path)
    const chapters = await window.electronAPI.getChapters(target.value.path)
    items.value = chapters.map((ch) => ({
      key: ch.title,
      name: ch.title,
      originalName: ch.title,
      src: ch.cover ? `manga-file://${encodeURIComponent(ch.cover)}` : ''
    }))
  } finally {
    isLoading.value = false
  }
}

// ─── 保存 ───
async function handleSave(): Promise<void> {
  if (!target.value) return
  isSaving.value = true
  let bookPath = target.value.path

  try {
    // 若用户在拖拽结束瞬间点击保存，优先采用当前可视顺序，保证落盘顺序与界面一致
    const finalItems =
      dragKey.value && insertIdx.value >= 0 ? renderItems.value.slice() : items.value.slice()
    items.value = finalItems

    // 1. 重命名书/系列目录
    const newTitle = editTitle.value.trim()
    if (newTitle && newTitle !== target.value.title) {
      const newPath = await window.electronAPI.renameBook(bookPath, newTitle)
      if (!newPath) { showToast('重命名失败，目标目录已存在', 'error'); return }
      bookPath = newPath
    }

    if (isSeries.value) {
      // 0. 先删除被标记删除的章节目录
      if (deletedItems.value.length > 0) {
        for (const d of deletedItems.value) {
          const chapterPath = `${bookPath}/${d.key}`
          await window.electronAPI.removeBook(chapterPath)
        }
      }

      // 2a. 先重命名有变化的章节目录
      for (const item of finalItems) {
        if (item.name !== item.key) {
          const oldPath = `${bookPath}/${item.key}` // 简单拼接
          const newPath = await window.electronAPI.renameBook(oldPath, item.name)
          if (newPath) item.key = item.name // 更新 key 以便后续排序用
        }
      }
      // 2b. 重排章节
      const chapterNames = finalItems.map((i) => i.key)
      const ok = await window.electronAPI.reorderChapters(bookPath, chapterNames)
      if (!ok) { showToast('话数重排失败', 'error'); return }
    } else {
      if (target.value.type !== 'folder') {
        showToast('压缩包暂不支持重命名页文件，请先解压为文件夹再编辑', 'error')
        return
      }
      // 0. 先删除被标记删除的页面文件
      if (deletedItems.value.length > 0) {
        const pageKeys = deletedItems.value.map((d) => d.key)
        const ok = await window.electronAPI.deletePages(bookPath, pageKeys)
        if (!ok) { showToast('删除页面失败', 'error'); return }
      }
      // 2. 重排页面（重命名为 001, 002...）
      const filenames = finalItems.map((i) => i.src || i.key)
      const ok = await window.electronAPI.renamePages(bookPath, filenames)
      if (!ok) { showToast('页面重排失败', 'error'); return }
    }

    await library.refreshLibrary()
    showToast('保存成功', 'success')
    setTimeout(goBack, 800)
  } finally {
    isSaving.value = false
  }
}

// ─── 工具 ───
const toastMsg = ref('')
const toastType = ref<'success' | 'error'>('success')
function showToast(msg: string, type: 'success' | 'error'): void {
  toastMsg.value = msg
  toastType.value = type
  setTimeout(() => { toastMsg.value = '' }, 2500)
}

function goBack(): void {
  if (fromSeriesId.value) {
    router.push(`/series/${fromSeriesId.value}`)
    return
  }
  router.push(isSeries.value ? `/series/${route.params.id}` : '/')
}
</script>

<style scoped lang="less">
.edit-view {
  width: 100%;
  height: 100%;
  .flex-col();
  background: @bg-primary;
  overflow: hidden;
  // 拖拽时禁止文字选中
  &.dragging-active { user-select: none; }
}

// ── 顶栏 ──
.edit-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 24px;
  height: 60px;
  background: rgba(10, 10, 15, 0.95);
  border-bottom: 1px solid @border;
  flex-shrink: 0;
}

.back-btn {
  .flex-center();
  width: 32px;
  height: 32px;
  border-radius: @radius-sm;
  background: transparent;
  border: 1px solid @border;
  color: @text-secondary;
  cursor: pointer;
  transition: all @transition;
  flex-shrink: 0;
  &:hover { background: @bg-hover; color: @text-primary; }
}

.header-info {
  flex: 1;
  h2 { font-size: 15px; font-weight: 700; color: @text-primary; }
}

.header-sub { font-size: 12px; color: @text-muted; }

.header-actions { display: flex; gap: 8px; }

.spinning { animation: spin 0.8s linear infinite; }

.btn-sm {
  font-size: 12px;
  padding: 5px 10px;
  display: flex;
  align-items: center;
  gap: 5px;
}

// ── 内容区 ──
.edit-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  .flex-col();
  gap: 28px;
}

.loading-state {
  flex: 1;
  .flex-col();
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: @text-secondary;
}

.spinner { .spinner-base(32px, 3px); }

// ── 名称 ──
.name-section {
  .flex-col();
  gap: 8px;
  max-width: 480px;
}

.field-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: @accent-light;
}

.name-input {
  background: @bg-card;
  border: 1px solid @border;
  border-radius: @radius-sm;
  padding: 10px 14px;
  color: @text-primary;
  font-size: 14px;
  outline: none;
  transition: border-color @transition;
  &:focus { border-color: @border-accent; }
}

.field-hint { font-size: 11px; color: @text-muted; }

// ── 排序区 ──
.order-section { .flex-col(); gap: 14px; }

.order-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.order-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.order-count { font-size: 12px; color: @text-muted; }

// ── 网格 ──
.item-grid {
  overflow: visible;
}

.item-grid-inner {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
}

// ── 单个 item ──
.edit-item {
  width: 110px;
  .flex-col();
  gap: 7px;
  cursor: grab;
  touch-action: none; // 防止触摸时页面滚动干扰拖拽
  flex-shrink: 0;

  &:active { cursor: grabbing; }

  // 被拖拽时：本体留在目标位置显示为占位框（ghost 跟手），
  // 这样不会有 key 增删，TransitionGroup 只做 sort-move，放手零抖动
  &.is-dragging {
    pointer-events: none;
    cursor: grabbing;

    .item-cover {
      background: rgba(124, 58, 237, 0.06);
      border: 2px dashed @accent-light;
      animation: pulse-border 1.2s ease infinite;
      img, .cover-placeholder { opacity: 0.15; }
      .drag-handle-icon { opacity: 0 !important; }
    }
    .item-label { opacity: 0.2; }
  }
}

@keyframes pulse-border {
  0%, 100% { border-color: @accent-light; }
  50% { border-color: rgba(168, 85, 247, 0.4); }
}

.item-cover {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: @radius;
  overflow: hidden;
  background: @bg-card;
  border: 1px solid @border;
  transition: border-color 0.15s;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    pointer-events: none;
    user-select: none;
  }

  .edit-item:hover & { border-color: @accent-light; }
}

.cover-placeholder {
  width: 100%;
  height: 100%;
  .flex-center();
  color: @text-muted;
}

.drag-handle-icon {
  position: absolute;
  inset: 0;
  .flex-center();
  background: rgba(0, 0, 0, 0.5);
  color: rgba(255,255,255,0.8);
  opacity: 0;
  transition: opacity 0.15s;

  .edit-item:hover & { opacity: 1; }
}

.item-label {
  display: flex;
  gap: 5px;
  align-items: center;
  overflow: hidden;
}

.item-index {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  color: @accent-light;
  background: rgba(124, 58, 237, 0.15);
  padding: 1px 5px;
  border-radius: 3px;
}

.item-name {
  font-size: 11px;
  color: @text-muted;
  .text-truncate();
  cursor: text;
}

.inline-input {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  background: @bg-secondary;
  border: 1px solid @border-accent;
  border-radius: 3px;
  color: @text-primary;
  padding: 2px 5px;
  outline: none;
}

// ── TransitionGroup 滑动动画 ──
// 只需 sort-move：拖拽过程及放手时其他项平移，永远不会有 enter/leave
.sort-move {
  transition: transform 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

// ── 跟手 Ghost ──
.drag-ghost-fixed {
  position: fixed;
  pointer-events: none;
  z-index: 9999;
  border-radius: @radius;
  overflow: hidden;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6), 0 0 0 2px @accent-light;
  transform: rotate(2deg) scale(1.06);
  transition: opacity 0.15s ease, box-shadow 0.1s;

  &.over-trash {
    opacity: 0.35;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6), 0 0 0 2px #ef4444;
  }

  img {
    width: 100%;
    aspect-ratio: 2 / 3;
    object-fit: cover;
    display: block;
    user-select: none;
    pointer-events: none;
  }
}

.ghost-placeholder {
  width: 100%;
  aspect-ratio: 2 / 3;
  background: @bg-card;
  .flex-center();
  color: @text-muted;
}

// ── 顶栏垃圾桶图标 ──
.header-trash {
  .flex-center();
  width: 36px;
  height: 36px;
  border-radius: @radius-sm;
  border: 2px dashed @border;
  color: @text-muted;
  cursor: default;
  transition: all 0.2s ease;

  &.hover {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    transform: scale(1.15);

    svg { stroke: #ef4444; }
  }
}

// trash-fade 过渡动画
.trash-fade-enter-active { transition: all 0.2s ease; }
.trash-fade-leave-active { transition: all 0.15s ease; }
.trash-fade-enter-from, .trash-fade-leave-to {
  opacity: 0;
  transform: scale(0.7);
}

// ── 已删除项提示 ──
.deleted-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: @radius-sm;
  color: #f87171;
  font-size: 12px;
}

// ── 删除确认弹窗 ──
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 1000;
  .flex-center();
}

.modal-card {
  background: @bg-card;
  border: 1px solid @border;
  border-radius: @radius;
  padding: 28px;
  width: 360px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  .flex-col();
  gap: 16px;
}

.modal-title {
  font-size: 18px;
  font-weight: 700;
  color: @text-primary;
}

.modal-desc {
  font-size: 13px;
  color: @text-muted;
  margin-top: -8px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.btn-danger {
  background: #ef4444;
  color: #fff;
  border: none;
  padding: 8px 18px;
  border-radius: @radius-sm;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background @transition;

  &:hover { background: #dc2626; }
}

.delete-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: @bg-secondary;
  border-radius: @radius-sm;
  border: 1px solid @border;
}

.delete-preview-cover {
  width: 48px;
  aspect-ratio: 2 / 3;
  border-radius: 4px;
  overflow: hidden;
  background: @bg-card;
  flex-shrink: 0;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.delete-preview-name {
  font-size: 13px;
  color: @text-primary;
  .text-truncate();
}

// fade 动画
.fade-enter-active { transition: all 0.2s ease; }
.fade-leave-active { transition: all 0.15s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

// ── Toast ──
.toast {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  border-radius: @radius-sm;
  font-size: 13px;
  font-weight: 500;
  z-index: 999;
  pointer-events: none;
  &.success { background: rgba(34, 197, 94, 0.9); color: #fff; }
  &.error   { background: rgba(239, 68, 68, 0.9);  color: #fff; }
}

.toast-enter-active, .toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(10px); }
</style>
