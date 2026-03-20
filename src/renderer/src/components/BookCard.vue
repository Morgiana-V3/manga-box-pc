<template>
  <div
    ref="cardRef"
    class="book-card"
    :class="{ 'has-progress': progress }"
    @click="handleClick"
  >
    <!-- 封面图 -->
    <div class="cover-wrap">
      <div class="card-menu-wrap">
        <button class="card-menu-trigger" title="更多操作" @click.stop="toggleMenu">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
          </svg>
        </button>
        <div v-if="showMenu" class="card-menu-pop" @click.stop>
          <button class="card-menu-item" @click="onEdit">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            编辑
          </button>
          <button class="card-menu-item danger" @click="onRemove">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3,6 5,6 21,6"/><path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6M8,6V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/>
            </svg>
            删除
          </button>
        </div>
      </div>
      <img
        v-if="coverSrc"
        :src="coverSrc"
        class="cover-img"
        loading="lazy"
        draggable="false"
        @error="coverError = true"
      />
      <div v-else class="cover-placeholder">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
          <path d="M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14M4 19h14a2 2 0 010 4H4v-4z"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="8" y1="8" x2="16" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="8" y1="12" x2="13" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>

      <!-- 类型标签（仅 Book 模式显示） -->
      <div v-if="book" class="type-badge" :class="[book.type, book.kind]">
        {{ book.type === 'archive' ? 'ZIP' : book.kind === 'series' ? '系列' : 'DIR' }}
      </div>

      <!-- 话数标签（仅 Chapter 模式显示） -->
      <div v-if="chapter" class="chapter-num">第 {{ chapter.index + 1 }} 话</div>

      <!-- 进度条 -->
      <div v-if="progress" class="progress-bar">
        <div class="progress-fill" :style="{ width: progressPercent + '%' }" />
      </div>

      <!-- 悬浮操作（仅 Book 模式显示） -->
      <div v-if="book" class="card-overlay">
        <button class="overlay-btn read-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
          {{ progress ? '继续阅读' : '开始阅读' }}
        </button>
      </div>
    </div>

    <!-- 信息 -->
    <div class="card-info">
      <p class="card-title" :title="displayTitle">{{ displayTitle }}</p>
      <div class="card-meta">
        <span class="page-count">{{ metaText }}</span>
        <span v-if="progress && (!book || book.kind !== 'series')" class="read-page">P.{{ progress.page + 1 }}</span>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useLibraryStore } from '../stores/library'

const props = defineProps<{
  /** Book 模式（首页使用） */
  book?: Book
  /** Chapter 模式（系列内使用） */
  chapter?: Chapter
}>()

const emit = defineEmits<{
  (e: 'open', book: Book): void
  (e: 'open-chapter', chapter: Chapter): void
  (e: 'edit', book: Book): void
  (e: 'edit-chapter', chapter: Chapter): void
  (e: 'remove', id: string): void
  (e: 'remove-chapter', chapter: Chapter): void
}>()

const library = useLibraryStore()
const cardRef = ref<HTMLElement | null>(null)
const showMenu = ref<boolean>(false)
const coverError = ref<boolean>(false)

/** 统一获取 id，用于读取进度 */
const itemId = computed(() => props.book?.id ?? props.chapter?.id ?? '')

const progress = computed(() => library.getProgress(itemId.value))
const progressPercent = computed(() => {
  if (!progress.value) return 0
  return Math.round(((progress.value.page + 1) / progress.value.total) * 100)
})

const displayTitle = computed(() => {
  if (props.book) return props.book.title
  if (props.chapter) return props.chapter.title
  return ''
})

const metaText = computed(() => {
  if (props.book) {
    return props.book.kind === 'series'
      ? `${props.book.chapterCount ?? 0} 话`
      : `${props.book.pageCount} 页`
  }
  if (props.chapter) {
    return `${props.chapter.pageCount} 页`
  }
  return ''
})

const coverSrc = computed(() => {
  if (coverError.value) return null
  if (props.book) {
    if (props.book.coverData) return props.book.coverData
    if (props.book.cover) {
      return `manga-file://${encodeURIComponent(props.book.cover)}?v=${library.assetVersion}`
    }
  }
  if (props.chapter) {
    if (props.chapter.cover) {
      return `manga-file://${encodeURIComponent(props.chapter.cover)}?v=${library.assetVersion}`
    }
  }
  return null
})

function handleClick(): void {
  if (props.book) {
    emit('open', props.book)
  } else if (props.chapter) {
    emit('open-chapter', props.chapter)
  }
}

function toggleMenu() {
  showMenu.value = !showMenu.value
}

function onEdit() {
  showMenu.value = false
  if (props.book) {
    emit('edit', props.book)
  } else if (props.chapter) {
    emit('edit-chapter', props.chapter)
  }
}

function onRemove() {
  showMenu.value = false
  if (props.book) {
    emit('remove', props.book.id)
  } else if (props.chapter) {
    emit('remove-chapter', props.chapter)
  }
}

function onGlobalPointerDown(e: PointerEvent): void {
  if (!showMenu.value) return
  const target = e.target as Node | null
  if (!target) return
  if (!cardRef.value?.contains(target)) {
    showMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onGlobalPointerDown)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onGlobalPointerDown)
})
</script>

<style scoped lang="less">
.book-card {
  .flex-col();
  gap: 8px;
  cursor: pointer;
  border-radius: @radius;
  transition: transform @transition;

  &:hover {
    transform: translateY(-3px);
  }
}

.cover-wrap {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: @radius;
  overflow: hidden;
  background: @bg-card;
  border: 1px solid @border;
  box-shadow: @shadow-card;

  &:hover .card-overlay {
    opacity: 1;
  }
}

.card-menu-wrap {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 3;
}

.card-menu-trigger {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  .flex-center();
  opacity: 0;
  cursor: pointer;
  transition: opacity @transition, background @transition;

  &:hover {
    background: rgba(124, 58, 237, 0.75);
  }
}

.cover-wrap:hover .card-menu-trigger,
.card-menu-trigger:focus-visible {
  opacity: 1;
}

.card-menu-pop {
  margin-top: 6px;
  min-width: 120px;
  background: @bg-card;
  border: 1px solid @border;
  border-radius: @radius-sm;
  padding: 5px;
  box-shadow: @shadow-card;
}

.card-menu-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 7px 9px;
  border: none;
  background: transparent;
  color: @text-primary;
  border-radius: @radius-sm;
  cursor: pointer;
  font-size: 12px;

  &:hover {
    background: @bg-hover;
  }

  &.danger {
    color: #fc8181;
    &:hover {
      background: rgba(252, 129, 129, 0.1);
    }
  }
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cover-placeholder {
  width: 100%;
  height: 100%;
  .flex-center();
  color: @text-muted;
  background: linear-gradient(135deg, @bg-card 0%, @bg-secondary 100%);
}

.type-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 9px;
  font-weight: 700;
  padding: 2px 5px;
  border-radius: 3px;
  letter-spacing: 0.5px;
  backdrop-filter: blur(4px);

  &.archive {
    background: rgba(168, 85, 247, 0.75);
    color: #fff;
  }

  &.folder {
    background: rgba(59, 130, 246, 0.75);
    color: #fff;
  }
}

.progress-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
}

.progress-fill {
  height: 100%;
  background: @accent-light;
  transition: width 0.3s ease;
}

.card-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  .flex-center();
  opacity: 0;
  transition: opacity @transition;
  backdrop-filter: blur(2px);
}

.overlay-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: @accent;
  color: #fff;
  border: none;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 15px @accent-glow;
  transition: all @transition;

  &:hover {
    background: @accent-light;
    transform: scale(1.05);
  }
}

.card-info {
  padding: 0 2px;
}

.card-title {
  font-size: 12px;
  font-weight: 500;
  color: @text-primary;
  .text-truncate();
  line-height: 1.4;
}

.card-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 3px;
}

.page-count,
.read-page {
  font-size: 10px;
  color: @text-muted;
}

.read-page {
  color: @accent-light;
}

// 系列标签颜色
.type-badge.series {
  background: rgba(34, 197, 94, 0.75);
  color: #fff;
}

// 话数标签（Chapter 模式）
.chapter-num {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 600;
  background: linear-gradient(transparent, rgba(0,0,0,0.7));
  color: #fff;
  text-align: center;
}
</style>
