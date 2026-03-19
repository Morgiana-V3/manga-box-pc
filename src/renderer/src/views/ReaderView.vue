<template>
  <div
    class="reader"
    :class="[`mode-${readMode}`, { 'ui-hidden': uiHidden }]"
    @mousemove="handleMouseMove"
    @click="handleReaderClick"
    @wheel="handleWheel"
    @keydown.prevent="handleKeydown"
    tabindex="0"
    ref="readerEl"
  >
    <!-- 顶部导航栏 -->
    <transition name="ui-fade">
      <div v-if="!uiHidden" class="reader-header">
        <button class="back-btn" @click="goBack">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div class="header-info">
          <h2 class="book-name">{{ displayTitle }}</h2>
          <span class="page-indicator">{{ currentPage + 1 }} / {{ pages.length }}</span>
        </div>
        <div class="header-actions">
          <!-- 阅读模式切换 -->
          <div class="mode-group">
            <button
              v-for="m in modes"
              :key="m.value"
              class="mode-btn"
              :class="{ active: readMode === m.value }"
              @click="readMode = m.value"
              :title="m.label"
            >
              <span>{{ m.label }}</span>
            </button>
          </div>

          <!-- 缩放控制 -->
          <div class="zoom-ctrl" v-if="readMode !== 'scroll'">
            <button class="btn-icon" @click="zoom(-0.1)" title="缩小">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
              </svg>
            </button>
            <span class="zoom-val">{{ Math.round(scale * 100) }}%</span>
            <button class="btn-icon" @click="zoom(0.1)" title="放大">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
              </svg>
            </button>
            <button class="btn-icon" @click="resetZoom" title="重置缩放">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8"/><path d="M21 3v5h-5"/>
                <path d="M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16"/><path d="M8 16H3v5"/>
              </svg>
            </button>
          </div>

          <!-- 全屏 -->
          <button class="btn-icon" @click="toggleFullscreen" title="全屏">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
              <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
          </button>

          <!-- 隐藏 UI -->
          <button class="btn-icon" @click="uiHidden = true" title="隐藏界面 (H键)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          </button>
        </div>
      </div>
    </transition>

    <!-- 阅读区域 -->
    <div class="reader-body" ref="bodyEl">
      <!-- 加载状态 -->
      <div v-if="isLoading" class="reader-loading">
        <div class="spinner-lg" />
        <p>加载中...</p>
      </div>

      <!-- 单页/双页模式 -->
      <div
        v-else-if="readMode !== 'scroll'"
        class="page-view"
        @click="handlePageAreaClick"
      >
        <div class="page-container" :style="pageContainerStyle">
          <!-- 双页模式左页 -->
          <div v-if="readMode === 'double' && leftPage" class="page-img-wrap">
            <img :src="leftPage" class="page-img" draggable="false" />
          </div>
          <!-- 当前页 -->
          <div class="page-img-wrap">
            <img
              v-if="currentPageSrc"
              :src="currentPageSrc"
              class="page-img"
              draggable="false"
              @load="onImgLoad"
            />
          </div>
        </div>

        <!-- 左右点击导航区域 -->
        <div class="nav-area left" @click.stop="prevPage" />
        <div class="nav-area right" @click.stop="nextPage" />
      </div>

      <!-- 滚动模式 -->
      <div v-else class="scroll-view" ref="scrollEl">
        <div class="scroll-container">
          <img
            v-for="(src, i) in pages"
            :key="i"
            :src="src"
            class="scroll-img"
            loading="lazy"
            draggable="false"
            @load="onScrollImgLoad(i)"
          />
        </div>
      </div>
    </div>

    <!-- 底部进度条 -->
    <transition name="ui-fade">
      <div v-if="!uiHidden && readMode !== 'scroll'" class="reader-footer">
        <div class="progress-track" @click="seekPage" ref="progressEl">
          <div class="progress-thumb" :style="{ width: progressWidth + '%' }" />
          <div class="progress-tooltip" :style="{ left: hoverProgress + '%' }">
            {{ Math.round((hoverProgress / 100) * pages.length) }}
          </div>
        </div>
        <div class="footer-info">
          <span>{{ currentPage + 1 }} / {{ pages.length }}</span>
          <span v-if="book">
            <span v-if="libraryProgress" class="progress-text">
              {{ Math.round(((currentPage + 1) / pages.length) * 100) }}%
            </span>
          </span>
        </div>
      </div>
    </transition>

    <!-- 隐藏UI时的提示 -->
    <transition name="ui-fade">
      <div v-if="uiHidden" class="hidden-hint" @click="uiHidden = false">
        点击任意位置恢复界面
      </div>
    </transition>

    <!-- 键盘快捷键提示 -->
    <transition name="ui-fade">
      <div v-if="showShortcuts" class="shortcuts-panel">
        <div class="shortcuts-title">键盘快捷键</div>
        <div class="shortcuts-grid">
          <template v-for="s in shortcuts" :key="s.key">
            <kbd>{{ s.key }}</kbd>
            <span>{{ s.desc }}</span>
          </template>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLibraryStore } from '../stores/library'

type ReadMode = 'single' | 'double' | 'scroll'

const route = useRoute()
const router = useRouter()
const library = useLibraryStore()

const readerEl = ref<HTMLDivElement | null>(null)
const bodyEl = ref<HTMLDivElement | null>(null)
const scrollEl = ref<HTMLDivElement | null>(null)
const progressEl = ref<HTMLDivElement | null>(null)

const pages = ref<string[]>([])
const currentPage = ref<number>(0)
const isLoading = ref<boolean>(true)
const readMode = ref<ReadMode>('single')
const scale = ref<number>(1.0)
const uiHidden = ref<boolean>(false)
const showShortcuts = ref<boolean>(false)
const hoverProgress = ref<number>(0)

let uiHideTimer: ReturnType<typeof setTimeout> | null = null

const modes: { value: ReadMode; label: string }[] = [
  { value: 'single', label: '单页' },
  { value: 'double', label: '双页' },
  { value: 'scroll', label: '长条' }
]

const shortcuts = [
  { key: '← / A', desc: '上一页' },
  { key: '→ / D', desc: '下一页' },
  { key: '↑ / W', desc: '向上滚动' },
  { key: '↓ / S', desc: '向下滚动' },
  { key: '+', desc: '放大' },
  { key: '-', desc: '缩小' },
  { key: '0', desc: '重置缩放' },
  { key: 'H', desc: '隐藏/显示界面' },
  { key: 'F', desc: '全屏' },
  { key: '?', desc: '快捷键帮助' }
]

const book = computed(() => library.getBook(route.params.id as string))
const ctx = computed(() => library.readerContext)
/** 当前读的 title：章节上下文优先，否则用书库的 */
const displayTitle = computed(() => ctx.value?.title ?? book.value?.title ?? '未知漫画')
const libraryProgress = computed(() => library.getProgress(route.params.id as string))

const currentPageSrc = computed<string>(() => pages.value[currentPage.value] ?? '')
const leftPage = computed<string | null>(() => {
  if (readMode.value !== 'double' || currentPage.value === 0) return null
  return pages.value[currentPage.value - 1] ?? null
})
const progressWidth = computed<number>(() => {
  if (!pages.value.length) return 0
  return ((currentPage.value + 1) / pages.value.length) * 100
})

const pageContainerStyle = computed(() => ({
  transform: `scale(${scale.value})`,
  transformOrigin: 'center center'
}))

async function loadBook(): Promise<void> {
  isLoading.value = true
  try {
    // 优先使用章节上下文（从系列页跳转来的）
    const context = ctx.value
    if (context) {
      const result = await window.electronAPI.getPages(context.bookPath, context.bookType)
      pages.value = result
      return
    }
    // 普通书库书籍
    const b = book.value
    if (!b) { router.push('/'); return }
    const result = await window.electronAPI.getPages(b.path, b.type)
    pages.value = result
    if (libraryProgress.value) {
      currentPage.value = Math.min(libraryProgress.value.page, result.length - 1)
    }
  } finally {
    isLoading.value = false
  }
}

function prevPage(): void {
  if (readMode.value === 'double') {
    currentPage.value = Math.max(0, currentPage.value - 2)
  } else {
    currentPage.value = Math.max(0, currentPage.value - 1)
  }
  saveProgress()
}

function nextPage(): void {
  if (readMode.value === 'double') {
    currentPage.value = Math.min(pages.value.length - 1, currentPage.value + 2)
  } else {
    currentPage.value = Math.min(pages.value.length - 1, currentPage.value + 1)
  }
  saveProgress()
}

function saveProgress(): void {
  library.saveProgress(route.params.id as string, currentPage.value, pages.value.length)
}

function zoom(delta: number): void {
  scale.value = Math.min(3, Math.max(0.3, scale.value + delta))
}

function resetZoom(): void {
  scale.value = 1.0
}

function goBack(): void {
  saveProgress()
  const context = ctx.value
  if (context?.seriesId) {
    library.setReaderContext(null)
    router.push(`/series/${context.seriesId}`)
  } else {
    library.setReaderContext(null)
    router.push('/')
  }
}

function handleKeydown(e: KeyboardEvent): void {
  switch (e.key) {
    case 'ArrowLeft':
    case 'a':
    case 'A':
      if (readMode.value !== 'scroll') prevPage()
      break
    case 'ArrowRight':
    case 'd':
    case 'D':
      if (readMode.value !== 'scroll') nextPage()
      break
    case 'ArrowUp':
    case 'w':
    case 'W':
      scrollEl.value?.scrollBy({ top: -300, behavior: 'smooth' })
      break
    case 'ArrowDown':
    case 's':
    case 'S':
      scrollEl.value?.scrollBy({ top: 300, behavior: 'smooth' })
      break
    case '+':
    case '=':
      zoom(0.1)
      break
    case '-':
      zoom(-0.1)
      break
    case '0':
      resetZoom()
      break
    case 'h':
    case 'H':
      uiHidden.value = !uiHidden.value
      break
    case 'f':
    case 'F':
      toggleFullscreen()
      break
    case 'Escape':
      if (document.fullscreenElement) document.exitFullscreen()
      else goBack()
      break
    case '?':
      showShortcuts.value = !showShortcuts.value
      break
  }
}

function handleWheel(e: WheelEvent): void {
  // 滚动模式下不拦截，让原生滚动条正常工作
  if (readMode.value === 'scroll') return
  // 非滚动模式才阻止默认行为（翻页 / 缩放）
  e.preventDefault()
  if (e.ctrlKey || e.metaKey) {
    zoom(e.deltaY > 0 ? -0.1 : 0.1)
  } else {
    if (e.deltaY > 0) nextPage()
    else prevPage()
  }
}

function handleMouseMove(): void {
  uiHidden.value = false
  if (uiHideTimer) clearTimeout(uiHideTimer)
  uiHideTimer = setTimeout(() => {
    if (readMode.value !== 'scroll') uiHidden.value = true
  }, 3000)
}

function handleReaderClick(): void {
  if (uiHidden.value) uiHidden.value = false
}

function handlePageAreaClick(_e: MouseEvent): void {
  // 中间区域保留空实现供后续扩展
}

function seekPage(e: MouseEvent): void {
  if (!progressEl.value) return
  const rect = progressEl.value.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  currentPage.value = Math.round(ratio * (pages.value.length - 1))
  saveProgress()
}

function onImgLoad(): void {}
function onScrollImgLoad(_i: number): void {}

async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen()
  } else {
    await readerEl.value?.requestFullscreen()
  }
}

function onScrollProgress(): void {
  if (readMode.value !== 'scroll' || !scrollEl.value) return
  const el = scrollEl.value
  const items = el.querySelectorAll<HTMLImageElement>('.scroll-img')
  for (let i = 0; i < items.length; i++) {
    const rect = items[i].getBoundingClientRect()
    if (rect.top >= 0 || rect.bottom > 0) {
      currentPage.value = i
      break
    }
  }
  saveProgress()
}

onMounted(async () => {
  await loadBook()
  readerEl.value?.focus()
  const savedMode = await window.electronAPI.storeGet('readMode')
  if (savedMode) readMode.value = savedMode as ReadMode
})

onUnmounted(() => {
  if (uiHideTimer) clearTimeout(uiHideTimer)
  saveProgress()
})

watch(readMode, async (val: ReadMode) => {
  await window.electronAPI.storeSet('readMode', val)
})

watch(scrollEl, (el: HTMLDivElement | null) => {
  if (el) el.addEventListener('scroll', onScrollProgress, { passive: true })
})
</script>

<style scoped lang="less">
@reader-bg: #0a0a0f;
@glass-bg:  rgba(10, 10, 15, 0.9);

.reader {
  width: 100%;
  height: 100%;
  .flex-col();
  background: @reader-bg;
  position: relative;
  outline: none;
}

// 顶部栏
.reader-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  height: 52px;
  background: @glass-bg;
  backdrop-filter: blur(12px);
  border-bottom: 1px solid @border;
  flex-shrink: 0;
  z-index: 50;
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

  &:hover {
    background: @bg-hover;
    color: @text-primary;
  }
}

.header-info {
  flex: 1;
  overflow: hidden;
}

.book-name {
  font-size: 14px;
  font-weight: 600;
  color: @text-primary;
  .text-truncate();
}

.page-indicator {
  font-size: 11px;
  color: @text-muted;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.mode-group {
  display: flex;
  gap: 2px;
  background: @bg-secondary;
  padding: 3px;
  border-radius: @radius-sm;
}

.mode-btn {
  padding: 4px 10px;
  border-radius: 4px;
  border: none;
  font-size: 12px;
  cursor: pointer;
  background: transparent;
  color: @text-secondary;
  transition: all @transition;

  &.active {
    background: @accent;
    color: #fff;
  }
}

.zoom-ctrl {
  display: flex;
  align-items: center;
  gap: 4px;
  background: @bg-secondary;
  padding: 3px 8px;
  border-radius: @radius-sm;
}

.zoom-val {
  font-size: 12px;
  color: @text-secondary;
  min-width: 36px;
  text-align: center;
}

// 阅读区
.reader-body {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.reader-loading {
  .flex-col();
  .flex-center();
  height: 100%;
  gap: 16px;
  color: @text-secondary;
}

.spinner-lg {
  .spinner-base(48px, 3px);
}

// 单页 / 双页
.page-view {
  width: 100%;
  height: 100%;
  .flex-center();
  position: relative;
  overflow: hidden;
}

.page-container {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  max-width: 100%;
  max-height: 100%;
  transition: transform 0.15s ease;
}

.page-img-wrap {
  .flex-center();
  max-height: calc(100vh - 120px);
}

.page-img {
  max-width: 100%;
  max-height: calc(100vh - 120px);
  object-fit: contain;
  display: block;
}

.nav-area {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 25%;
  cursor: pointer;
  z-index: 10;
  opacity: 0;
  transition: opacity @transition;

  &.left {
    left: 0;
    --side: right;

    &:hover {
      background: linear-gradient(to right, rgba(124, 58, 237, 0.15), transparent);
    }
  }

  &.right {
    right: 0;
    --side: left;

    &:hover {
      background: linear-gradient(to left, rgba(124, 58, 237, 0.15), transparent);
    }
  }

  &:hover {
    opacity: 1;
  }
}

// 滚动模式
.scroll-view {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}

.scroll-container {
  .flex-col();
  align-items: center;
  padding: 0;
  gap: 2px;
}

.scroll-img {
  width: 100%;
  max-width: 900px;
  display: block;
  object-fit: contain;
}

// 底部进度条
.reader-footer {
  height: 48px;
  background: @glass-bg;
  backdrop-filter: blur(12px);
  border-top: 1px solid @border;
  .flex-col();
  justify-content: center;
  padding: 0 20px;
  gap: 6px;
  flex-shrink: 0;
}

.progress-track {
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  cursor: pointer;
  position: relative;
  overflow: visible;

  &:hover .progress-tooltip {
    opacity: 1;
  }
}

.progress-thumb {
  height: 100%;
  background: @accent-light;
  border-radius: 2px;
  transition: width 0.2s ease;
}

.progress-tooltip {
  position: absolute;
  top: -24px;
  transform: translateX(-50%);
  background: @bg-card;
  border: 1px solid @border;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  color: @text-secondary;
  pointer-events: none;
  opacity: 0;
  transition: opacity @transition;
}

.footer-info {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: @text-muted;
}

.progress-text {
  color: @accent-light;
}

// 隐藏UI提示
.hidden-hint {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.6);
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  padding: 6px 14px;
  border-radius: 20px;
  pointer-events: auto;
  cursor: pointer;
  backdrop-filter: blur(4px);
}

// 快捷键面板
.shortcuts-panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: @bg-card;
  border: 1px solid @border;
  border-radius: @radius-lg;
  padding: 20px 24px;
  z-index: 200;
  min-width: 280px;
  box-shadow: @shadow-card;
}

.shortcuts-title {
  font-size: 14px;
  font-weight: 600;
  color: @text-primary;
  margin-bottom: 14px;
}

.shortcuts-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 16px;
  align-items: center;

  span {
    font-size: 12px;
    color: @text-secondary;
  }
}

kbd {
  display: inline-block;
  padding: 3px 7px;
  background: @bg-secondary;
  border: 1px solid @border;
  border-radius: 4px;
  font-size: 11px;
  font-family: monospace;
  color: @accent-light;
  white-space: nowrap;
}

// UI 过渡动画
.ui-fade-enter-active,
.ui-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.ui-fade-enter-from,
.ui-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
