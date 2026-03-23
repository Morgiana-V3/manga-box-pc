<template>
  <div class="grab-view">
    <!-- 顶栏 -->
    <div class="grab-header">
      <button class="back-btn" @click="goBack">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <div class="header-info">
        <h2>在线抓取</h2>
        <span class="header-sub">输入网址，自动嗅探页面中的漫画图片</span>
      </div>
    </div>

    <!-- 主体 -->
    <div class="grab-body">
      <!-- Step 1: 输入 URL -->
      <div class="url-section">
        <div class="url-bar">
          <svg class="url-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            v-model="inputUrl"
            class="url-input"
            type="text"
            placeholder="输入漫画网页地址，如 https://example.com/manga/chapter-1"
            @keydown.enter.prevent="startSniff"
          />
          <button
            v-if="!isSniffing"
            class="btn btn-primary btn-sm"
            :disabled="!inputUrl.trim()"
            @click="startSniff"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            开始嗅探
          </button>
          <button v-else class="btn btn-ghost btn-sm" @click="stopSniff">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <rect x="6" y="6" width="12" height="12" rx="2"/>
            </svg>
            停止
          </button>
        </div>
        <p class="url-hint">
          嗅探器会在后台打开网页，自动拦截所有图片资源。初次加载会自动尝试触发懒加载图片，也支持手动滚动抓取。
        </p>
      </div>

      <!-- 嗅探状态 & 控制 -->
      <div v-if="isSniffing || images.length > 0 || canvasImages.length > 0" class="sniff-toolbar">
        <div class="sniff-status">
          <div v-if="isSniffing" class="status-dot pulse" />
          <div v-else class="status-dot idle" />
          <span>{{ isSniffing ? '嗅探中...' : '嗅探已停止' }}</span>
          <span class="status-count">
            网络图片 <strong>{{ images.length }}</strong> 张
            <template v-if="canvasImages.length > 0">
              &nbsp;| Canvas <strong>{{ canvasImages.length }}</strong> 张
            </template>
          </span>
        </div>
        <div class="sniff-actions">
          <button
            v-if="isSniffing"
            class="btn btn-ghost btn-sm"
            :disabled="isScrolling"
            @click="autoScroll"
          >
            <svg v-if="isScrolling" class="spinning" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
            </svg>
            <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
            </svg>
            {{ isScrolling ? '滚动中...' : '自动滚动' }}
          </button>
          <button
            v-if="isSniffing"
            class="btn btn-accent btn-sm"
            :disabled="isCapturing"
            @click="captureCanvas"
          >
            <svg v-if="isCapturing" class="spinning" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
            </svg>
            <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            {{ isCapturing ? '捕获中...' : '捕获Canvas' }}
          </button>
          <button
            v-if="isSniffing"
            class="btn btn-accent btn-sm"
            :disabled="isCapturing"
            @click="scrollAndCapture"
          >
            <svg v-if="isCapturing" class="spinning" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
            </svg>
            <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
              <rect x="2" y="2" width="6" height="6" rx="1"/>
            </svg>
            {{ isCapturing ? '捕获中...' : '滚动+捕获' }}
          </button>
          <button
            v-if="images.length > 0 || canvasImages.length > 0"
            class="btn btn-ghost btn-sm"
            @click="toggleSelectAll"
          >
            {{ allSelected ? '取消全选' : '全选' }}
          </button>
          <button
            v-if="images.length > 0 || canvasImages.length > 0"
            class="btn btn-ghost btn-sm"
            @click="clearImages"
          >
            清空列表
          </button>
        </div>
      </div>

      <!-- Canvas 捕获图片 -->
      <div v-if="canvasImages.length > 0" class="section-label">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        Canvas 捕获（{{ canvasImages.length }} 张）
      </div>
      <div v-if="canvasImages.length > 0" class="image-grid">
        <div
          v-for="(dataUrl, idx) in canvasImages"
          :key="'canvas-' + idx"
          class="image-card"
          :class="{ selected: selectedCanvasIdxs.has(idx) }"
          @click="toggleCanvasSelect(idx)"
        >
          <div class="image-thumb">
            <img :src="dataUrl" loading="lazy" draggable="false" @error="onImgError" />
            <div class="select-badge canvas-badge">
              <svg v-if="selectedCanvasIdxs.has(idx)" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
              </svg>
              <span v-else>C{{ idx + 1 }}</span>
            </div>
          </div>
          <div class="image-info">
            <span class="image-size">{{ formatDataUrlSize(dataUrl) }}</span>
          </div>
        </div>
      </div>

      <!-- 网络嗅探图片 -->
      <div v-if="images.length > 0 && canvasImages.length > 0" class="section-label">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
        </svg>
        网络嗅探（{{ images.length }} 张）
      </div>

      <!-- 图片网格 -->
      <div v-if="images.length > 0" class="image-grid">
        <div
          v-for="(img, idx) in images"
          :key="img.url"
          class="image-card"
          :class="{ selected: selectedUrls.has(img.url) }"
          @click="toggleSelect(img.url)"
        >
          <div class="image-thumb">
            <img :src="img.url" loading="lazy" draggable="false" @error="onImgError" />
            <div class="select-badge">
              <svg v-if="selectedUrls.has(img.url)" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
              </svg>
              <span v-else>{{ idx + 1 }}</span>
            </div>
          </div>
          <div class="image-info">
            <span class="image-size">{{ formatSize(img.size) }}</span>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else-if="!isSniffing && canvasImages.length === 0" class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          <line x1="8" y1="11" x2="14" y2="11"/><line x1="11" y1="8" x2="11" y2="14"/>
        </svg>
        <h3>输入网址开始抓取</h3>
        <p>粘贴任意漫画网页的 URL，嗅探器会自动捕获页面中加载的所有图片资源</p>
      </div>

      <!-- 嗅探进行中但还没结果 -->
      <div v-else-if="isSniffing && images.length === 0 && canvasImages.length === 0" class="loading-state">
        <div class="spinner" />
        <p>正在加载页面并嗅探图片...</p>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <Transition name="bar-slide">
      <div v-if="totalSelected > 0" class="save-bar">
        <div class="save-info">
          <span>已选择 <strong>{{ totalSelected }}</strong> 张图片</span>
          <span v-if="selectedCanvasIdxs.size > 0" class="save-tag">含 {{ selectedCanvasIdxs.size }} 张 Canvas</span>
        </div>
        <div class="save-actions">
          <!-- 保存模式选择 -->
          <div class="save-mode-select">
            <button
              class="mode-btn"
              :class="{ active: saveMode === 'single' }"
              @click="saveMode = 'single'"
            >单话</button>
            <button
              class="mode-btn"
              :class="{ active: saveMode === 'series' }"
              @click="switchToSeriesMode"
            >系列</button>
          </div>

          <!-- 系列选择（仅系列模式） -->
          <div v-if="saveMode === 'series'" class="series-picker" ref="seriesPickerRef">
            <div class="series-input-wrap" @click="showSeriesDropdown = true">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
              </svg>
              <input
                v-model="seriesSearchText"
                class="series-input"
                type="text"
                placeholder="搜索或新建系列..."
                @focus="showSeriesDropdown = true"
                @input="onSeriesSearch"
              />
              <span v-if="selectedSeries" class="series-count">{{ selectedSeries.chapterCount }} 话</span>
              <svg v-if="selectedSeries" class="series-clear" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
                @click.stop="clearSeriesSelection"
              >
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </div>
            <Transition name="dropdown">
              <div v-if="showSeriesDropdown" class="series-dropdown">
                <div v-if="filteredSeriesList.length === 0 && !seriesSearchText.trim()" class="dropdown-empty">
                  暂无系列，输入名称创建新系列
                </div>
                <div v-else-if="filteredSeriesList.length === 0 && seriesSearchText.trim()" class="dropdown-item create-item" @click="selectNewSeries">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  新建系列「{{ seriesSearchText.trim() }}」
                </div>
                <template v-else>
                  <div
                    v-if="seriesSearchText.trim() && !filteredSeriesList.find(s => s.name === seriesSearchText.trim())"
                    class="dropdown-item create-item"
                    @click="selectNewSeries"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    新建系列「{{ seriesSearchText.trim() }}」
                  </div>
                  <div
                    v-for="s in filteredSeriesList"
                    :key="s.path"
                    class="dropdown-item"
                    :class="{ selected: selectedSeries?.path === s.path }"
                    @click="selectSeries(s)"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                    </svg>
                    <span class="series-name">{{ s.name }}</span>
                    <span class="series-meta">{{ s.chapterCount }} 话</span>
                  </div>
                </template>
              </div>
            </Transition>
          </div>

          <!-- 名称输入 -->
          <input
            v-model="mangaTitle"
            class="title-input"
            type="text"
            :placeholder="saveMode === 'series' ? '输入章节/话名称' : '输入漫画名称'"
            @keydown.enter.prevent="saveToLibrary"
          />
          <button
            class="btn btn-primary"
            :disabled="isSaving || !canSave"
            @click="saveToLibrary"
          >
            <svg v-if="isSaving" class="spinning" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
            </svg>
            {{ isSaving ? `${saveProgress.current}/${saveProgress.total}` : '保存到书库' }}
          </button>
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
import { useRouter } from 'vue-router'
import { useLibraryStore } from '../stores/library'

const router = useRouter()
const library = useLibraryStore()

const inputUrl = ref('')
const isSniffing = ref(false)
const isScrolling = ref(false)
const isCapturing = ref(false)
const isSaving = ref(false)
const images = ref<SniffedImage[]>([])
const canvasImages = ref<string[]>([])
const selectedUrls = ref<Set<string>>(new Set())
const selectedCanvasIdxs = ref<Set<number>>(new Set())
const mangaTitle = ref('')
const saveProgress = ref({ current: 0, total: 0, downloaded: 0 })

// ─── 保存模式 ───
const saveMode = ref<'single' | 'series'>('single')
const seriesList = ref<SeriesInfo[]>([])
const selectedSeries = ref<SeriesInfo | null>(null)
const newSeriesName = ref('')  // 新建系列时的名称
const seriesSearchText = ref('')
const showSeriesDropdown = ref(false)
const seriesPickerRef = ref<HTMLElement | null>(null)

const filteredSeriesList = computed(() => {
  const q = seriesSearchText.value.trim().toLowerCase()
  if (!q) return seriesList.value
  return seriesList.value.filter((s) => s.name.toLowerCase().includes(q))
})

const canSave = computed(() => {
  if (!mangaTitle.value.trim()) return false
  if (saveMode.value === 'series') {
    // 必须选了已有系列 或 准备新建系列
    return !!(selectedSeries.value || newSeriesName.value.trim())
  }
  return true
})

const totalSelected = computed(() => selectedUrls.value.size + selectedCanvasIdxs.value.size)
const allSelected = computed(() => {
  const totalImages = images.value.length + canvasImages.value.length
  return totalImages > 0 && totalSelected.value === totalImages
})

// ─── 嗅探控制 ───
let removeImageListener: (() => void) | null = null
let removeProgressListener: (() => void) | null = null

async function startSniff(): Promise<void> {
  let url = inputUrl.value.trim()
  if (!url) return
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url
    inputUrl.value = url
  }

  images.value = []
  canvasImages.value = []
  selectedUrls.value.clear()
  selectedCanvasIdxs.value = new Set()
  isSniffing.value = true

  // 监听实时推送
  removeImageListener = window.electronAPI.onSniffImageFound((data) => {
    // 去重
    if (!images.value.find((i) => i.url === data.url)) {
      images.value.push(data)
      // 默认全选
      selectedUrls.value.add(data.url)
    }
  })

  showToast('正在加载页面并分析图片，请稍候...', 'success')
  const ok = await window.electronAPI.sniffStart(url)
  if (!ok) {
    showToast('页面加载失败，请检查网址', 'error')
    isSniffing.value = false
  } else if (images.value.length > 0) {
    showToast(`页面加载完成，发现 ${images.value.length} 张图片`, 'success')
  } else {
    showToast('页面加载完成，尝试点击「自动滚动」加载更多图片', 'success')
  }
}

async function stopSniff(): Promise<void> {
  await window.electronAPI.sniffStop()
  isSniffing.value = false
  if (removeImageListener) { removeImageListener(); removeImageListener = null }
}

async function autoScroll(): Promise<void> {
  isScrolling.value = true
  const newCount = await window.electronAPI.sniffAutoScroll()
  isScrolling.value = false
  if (newCount > 0) {
    showToast(`滚动完成，新发现 ${newCount} 张图片`, 'success')
  } else {
    showToast('滚动完成，未发现新图片', 'success')
  }
}

function clearImages(): void {
  images.value = []
  canvasImages.value = []
  selectedUrls.value.clear()
  selectedCanvasIdxs.value = new Set()
  window.electronAPI.sniffClearImages()
}

// ─── Canvas 捕获 ───
async function captureCanvas(): Promise<void> {
  isCapturing.value = true
  const dataUrls = await window.electronAPI.sniffCaptureCanvas()
  isCapturing.value = false

  if (dataUrls.length > 0) {
    // 去重追加
    const existing = new Set(canvasImages.value)
    let added = 0
    for (const d of dataUrls) {
      if (!existing.has(d)) {
        canvasImages.value.push(d)
        selectedCanvasIdxs.value.add(canvasImages.value.length - 1)
        existing.add(d)
        added++
      }
    }
    selectedCanvasIdxs.value = new Set(selectedCanvasIdxs.value)
    showToast(`捕获到 ${added} 张 Canvas 图片`, 'success')
  } else {
    showToast('未发现有效的 Canvas 图片', 'error')
  }
}

async function scrollAndCapture(): Promise<void> {
  isCapturing.value = true
  showToast('正在自动滚动并捕获 Canvas 图片...', 'success')
  const dataUrls = await window.electronAPI.sniffScrollAndCapture()
  isCapturing.value = false

  if (dataUrls.length > 0) {
    const existing = new Set(canvasImages.value)
    let added = 0
    for (const d of dataUrls) {
      if (!existing.has(d)) {
        canvasImages.value.push(d)
        selectedCanvasIdxs.value.add(canvasImages.value.length - 1)
        existing.add(d)
        added++
      }
    }
    selectedCanvasIdxs.value = new Set(selectedCanvasIdxs.value)
    showToast(`滚动捕获完成，获取 ${added} 张 Canvas 图片`, 'success')
  } else {
    showToast('未捕获到 Canvas 图片，该页面可能未使用 Canvas 渲染', 'error')
  }
}

// ─── 图片选择 ───
function toggleSelect(url: string): void {
  if (selectedUrls.value.has(url)) {
    selectedUrls.value.delete(url)
  } else {
    selectedUrls.value.add(url)
  }
  // 触发响应式更新
  selectedUrls.value = new Set(selectedUrls.value)
}

function toggleSelectAll(): void {
  if (allSelected.value) {
    selectedUrls.value = new Set()
    selectedCanvasIdxs.value = new Set()
  } else {
    selectedUrls.value = new Set(images.value.map((i) => i.url))
    selectedCanvasIdxs.value = new Set(canvasImages.value.map((_, idx) => idx))
  }
}

function toggleCanvasSelect(idx: number): void {
  if (selectedCanvasIdxs.value.has(idx)) {
    selectedCanvasIdxs.value.delete(idx)
  } else {
    selectedCanvasIdxs.value.add(idx)
  }
  selectedCanvasIdxs.value = new Set(selectedCanvasIdxs.value)
}

// ─── 系列选择 ───
async function loadSeriesList(): Promise<void> {
  const libraryDir = library.libraryPath || (await window.electronAPI.getDefaultLibraryDir())
  seriesList.value = await window.electronAPI.sniffGetSeriesList(libraryDir)
}

async function switchToSeriesMode(): Promise<void> {
  saveMode.value = 'series'
  await loadSeriesList()
}

function selectSeries(s: SeriesInfo): void {
  selectedSeries.value = s
  newSeriesName.value = ''
  seriesSearchText.value = s.name
  showSeriesDropdown.value = false
}

function selectNewSeries(): void {
  const name = seriesSearchText.value.trim()
  if (!name) return
  selectedSeries.value = null
  newSeriesName.value = name
  showSeriesDropdown.value = false
}

function clearSeriesSelection(): void {
  selectedSeries.value = null
  newSeriesName.value = ''
  seriesSearchText.value = ''
}

function onSeriesSearch(): void {
  // 输入搜索时清除已选的系列（让用户重新选）
  selectedSeries.value = null
  newSeriesName.value = ''
}

// 点击外部关闭下拉框
function onClickOutside(e: MouseEvent): void {
  if (seriesPickerRef.value && !seriesPickerRef.value.contains(e.target as Node)) {
    showSeriesDropdown.value = false
  }
}

// ─── 保存到书库 ───
async function saveToLibrary(): Promise<void> {
  const title = mangaTitle.value.trim()
  if (!title || totalSelected.value === 0) return
  if (saveMode.value === 'series' && !selectedSeries.value && !newSeriesName.value.trim()) return

  isSaving.value = true
  const total = totalSelected.value
  saveProgress.value = { current: 0, total, downloaded: 0 }

  // 监听下载进度
  removeProgressListener = window.electronAPI.onSniffDownloadProgress((data) => {
    saveProgress.value = data
  })

  const libraryDir = library.libraryPath || (await window.electronAPI.getDefaultLibraryDir())

  // 收集选中的图片
  const selectedCanvasDataUrls = canvasImages.value.filter((_, idx) => selectedCanvasIdxs.value.has(idx))
  const selectedNetworkUrls = images.value
    .filter((i) => selectedUrls.value.has(i.url))
    .map((i) => i.url)

  const result = await window.electronAPI.sniffSaveGrab({
    mode: saveMode.value,
    seriesPath: selectedSeries.value?.path || '',
    seriesName: newSeriesName.value.trim(),
    chapterName: title,
    canvasDataUrls: selectedCanvasDataUrls,
    networkUrls: selectedNetworkUrls,
    libraryDir
  })

  if (removeProgressListener) { removeProgressListener(); removeProgressListener = null }
  isSaving.value = false

  if (result.ok) {
    if (saveMode.value === 'series') {
      const sName = selectedSeries.value?.name || newSeriesName.value.trim()
      showToast(`「${title}」已保存到系列「${sName}」（${result.savedCount} 张）`, 'success')
    } else {
      showToast(`「${title}」已保存到书库（${result.savedCount} 张）`, 'success')
    }
    await library.refreshLibrary()
  } else {
    showToast('保存失败，请重试', 'error')
  }
}

// ─── 工具 ───
const toastMsg = ref('')
const toastType = ref<'success' | 'error'>('success')
function showToast(msg: string, type: 'success' | 'error'): void {
  toastMsg.value = msg
  toastType.value = type
  setTimeout(() => { toastMsg.value = '' }, 3000)
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '未知'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDataUrlSize(dataUrl: string): string {
  // data URL 的 base64 部分约为实际大小的 4/3
  const commaIdx = dataUrl.indexOf(',')
  if (commaIdx < 0) return '未知'
  const base64Len = dataUrl.length - commaIdx - 1
  const bytes = Math.floor(base64Len * 0.75)
  return formatSize(bytes)
}

function onImgError(e: Event): void {
  const img = e.target as HTMLImageElement
  img.style.display = 'none'
}

function goBack(): void {
  stopSniff()
  router.push('/')
}

onMounted(() => {
  // 如果有之前嗅探的残留图片，获取一下
  window.electronAPI.sniffGetImages().then((list) => {
    if (list.length > 0) {
      images.value = list
      selectedUrls.value = new Set(list.map((i) => i.url))
    }
  })
  document.addEventListener('click', onClickOutside)
})

onUnmounted(() => {
  if (removeImageListener) removeImageListener()
  if (removeProgressListener) removeProgressListener()
  document.removeEventListener('click', onClickOutside)
})
</script>

<style scoped lang="less">
.grab-view {
  width: 100%;
  height: 100%;
  .flex-col();
  background: @bg-primary;
  overflow: hidden;
}

// ── 顶栏 ──
.grab-header {
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

// ── 主体 ──
.grab-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  .flex-col();
  gap: 20px;
}

// ── URL 输入 ──
.url-section {
  .flex-col();
  gap: 8px;
}

.url-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  background: @bg-card;
  border: 1px solid @border;
  border-radius: @radius;
  padding: 6px 12px;
  transition: border-color @transition;

  &:focus-within { border-color: @border-accent; }
}

.url-icon { color: @text-muted; flex-shrink: 0; }

.url-input {
  flex: 1;
  background: transparent;
  border: none;
  color: @text-primary;
  font-size: 13px;
  outline: none;
  padding: 6px 0;

  &::placeholder { color: @text-muted; }
}

.url-hint { font-size: 11px; color: @text-muted; }

.btn { cursor: pointer; }

.btn-primary {
  background: @accent;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: @radius-sm;
  font-size: 13px;
  font-weight: 600;
  transition: background @transition;
  &:hover { background: @accent-hover; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.btn-ghost {
  background: transparent;
  color: @text-secondary;
  border: 1px solid @border;
  padding: 8px 14px;
  border-radius: @radius-sm;
  font-size: 13px;
  font-weight: 500;
  transition: all @transition;
  &:hover { background: @bg-hover; color: @text-primary; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.btn-sm {
  font-size: 12px;
  padding: 6px 12px;
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.btn-accent {
  background: rgba(124, 58, 237, 0.15);
  color: @accent-light;
  border: 1px solid rgba(124, 58, 237, 0.3);
  padding: 8px 14px;
  border-radius: @radius-sm;
  font-size: 13px;
  font-weight: 600;
  transition: all @transition;
  &:hover { background: rgba(124, 58, 237, 0.25); border-color: @accent-light; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.spinning { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

// ── 分区标签 ──
.section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: @text-secondary;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 0;

  svg { color: @accent-light; }
}

// ── 嗅探工具栏 ──
.sniff-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 16px;
  background: @bg-card;
  border: 1px solid @border;
  border-radius: @radius;
}

.sniff-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: @text-secondary;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;

  &.pulse {
    background: #22c55e;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.6);
    animation: pulse-dot 1.5s ease infinite;
  }
  &.idle { background: @text-muted; }
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.status-count {
  color: @text-muted;
  font-size: 12px;

  strong { color: @accent-light; font-weight: 700; }
}

.sniff-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

// ── 图片网格 ──
.image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.image-card {
  width: 130px;
  .flex-col();
  gap: 6px;
  cursor: pointer;
  border-radius: @radius;
  padding: 4px;
  border: 2px solid transparent;
  transition: all 0.15s ease;

  &:hover { border-color: @border; }

  &.selected {
    border-color: @accent-light;
    background: rgba(124, 58, 237, 0.06);

    .select-badge {
      background: @accent;
      color: #fff;
    }
  }
}

.image-thumb {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: @radius-sm;
  overflow: hidden;
  background: @bg-card;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    pointer-events: none;
    user-select: none;
  }
}

.select-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  width: 22px;
  height: 22px;
  .flex-center();
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: @text-secondary;
  font-size: 10px;
  font-weight: 700;
  backdrop-filter: blur(4px);
  transition: all 0.15s ease;

  &.canvas-badge {
    background: rgba(124, 58, 237, 0.7);
    color: #fff;
  }
}

.image-info {
  text-align: center;
}

.image-size {
  font-size: 10px;
  color: @text-muted;
}

// ── 空状态 ──
.empty-state {
  flex: 1;
  .flex-col();
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: @text-muted;
  text-align: center;

  h3 {
    font-size: 16px;
    font-weight: 600;
    color: @text-secondary;
  }

  p {
    font-size: 13px;
    max-width: 360px;
    line-height: 1.6;
  }
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

// ── 底部保存栏 ──
.save-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 24px;
  background: rgba(10, 10, 15, 0.95);
  border-top: 1px solid @border;
  flex-shrink: 0;
}

.save-info {
  font-size: 13px;
  color: @text-secondary;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;

  strong { color: @accent-light; font-weight: 700; }
}

.save-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(124, 58, 237, 0.15);
  color: @accent-light;
  font-weight: 500;
}

.save-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
  justify-content: flex-end;
}

// ── 保存模式选择 ──
.save-mode-select {
  display: flex;
  border: 1px solid @border;
  border-radius: @radius-sm;
  overflow: hidden;
  flex-shrink: 0;
}

.mode-btn {
  background: transparent;
  border: none;
  color: @text-muted;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 14px;
  cursor: pointer;
  transition: all @transition;

  &:hover { background: @bg-hover; color: @text-secondary; }

  &.active {
    background: @accent;
    color: #fff;
  }

  & + & { border-left: 1px solid @border; }
}

// ── 系列选择器 ──
.series-picker {
  position: relative;
  flex-shrink: 0;
}

.series-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  background: @bg-card;
  border: 1px solid @border;
  border-radius: @radius-sm;
  padding: 0 10px;
  height: 34px;
  cursor: pointer;
  transition: border-color @transition;
  min-width: 180px;

  &:focus-within { border-color: @border-accent; }

  svg { color: @text-muted; flex-shrink: 0; }
}

.series-input {
  flex: 1;
  background: transparent;
  border: none;
  color: @text-primary;
  font-size: 12px;
  outline: none;
  min-width: 0;

  &::placeholder { color: @text-muted; }
}

.series-count {
  font-size: 10px;
  color: @text-muted;
  white-space: nowrap;
}

.series-clear {
  color: @text-muted;
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s;
  &:hover { color: @text-primary; }
}

// ── 系列下拉框 ──
.series-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  right: 0;
  min-width: 240px;
  max-height: 280px;
  overflow-y: auto;
  background: @bg-card;
  border: 1px solid @border;
  border-radius: @radius;
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.4);
  z-index: 100;
  padding: 4px;
}

.dropdown-empty {
  padding: 16px 12px;
  font-size: 12px;
  color: @text-muted;
  text-align: center;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: @radius-sm;
  cursor: pointer;
  font-size: 12px;
  color: @text-secondary;
  transition: all 0.12s ease;

  &:hover { background: @bg-hover; color: @text-primary; }

  &.selected {
    background: rgba(124, 58, 237, 0.1);
    color: @accent-light;
  }

  &.create-item {
    color: @accent-light;
    font-weight: 600;
    border-bottom: 1px solid @border;
    margin-bottom: 2px;

    svg { color: @accent-light; }
  }

  svg { color: @text-muted; flex-shrink: 0; }
}

.series-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.series-meta {
  font-size: 10px;
  color: @text-muted;
  white-space: nowrap;
}

// ── 下拉框动画 ──
.dropdown-enter-active { transition: all 0.15s ease; }
.dropdown-leave-active { transition: all 0.1s ease; }
.dropdown-enter-from, .dropdown-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

.title-input {
  background: @bg-card;
  border: 1px solid @border;
  border-radius: @radius-sm;
  padding: 8px 12px;
  color: @text-primary;
  font-size: 13px;
  outline: none;
  width: 220px;
  transition: border-color @transition;

  &:focus { border-color: @border-accent; }
  &::placeholder { color: @text-muted; }
}

// ── 动画 ──
.bar-slide-enter-active { transition: all 0.25s ease; }
.bar-slide-leave-active { transition: all 0.2s ease; }
.bar-slide-enter-from, .bar-slide-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

// ── Toast ──
.toast {
  position: fixed;
  bottom: 80px;
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
