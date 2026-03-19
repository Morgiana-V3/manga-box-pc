<template>
  <div
    class="book-card"
    :class="{ 'has-progress': progress }"
    @click="$emit('open', book)"
    @contextmenu.prevent="showMenu = true"
  >
    <!-- 封面图 -->
    <div class="cover-wrap">
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

      <!-- 类型标签 -->
      <div class="type-badge" :class="[book.type, book.kind]">
        {{ book.type === 'archive' ? 'ZIP' : book.kind === 'series' ? '系列' : 'DIR' }}
      </div>

      <!-- 进度条 -->
      <div v-if="progress" class="progress-bar">
        <div class="progress-fill" :style="{ width: progressPercent + '%' }" />
      </div>

      <!-- 悬浮操作 -->
      <div class="card-overlay">
        <button class="overlay-btn read-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
          {{ progress ? '继续阅读' : '开始阅读' }}
        </button>
      </div>
    </div>

    <!-- 书名 -->
    <div class="card-info">
      <p class="card-title" :title="book.title">{{ book.title }}</p>
        <div class="card-meta">
        <span class="page-count">
          {{ book.kind === 'series' ? `${book.chapterCount ?? 0} 话` : `${book.pageCount} 页` }}
        </span>
        <span v-if="progress && book.kind !== 'series'" class="read-page">P.{{ progress.page + 1 }}</span>
      </div>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div v-if="showMenu" class="ctx-backdrop" @click="showMenu = false">
        <div class="ctx-menu" :style="menuStyle" @click.stop>
          <button class="ctx-item" @click="onOpen">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 5v14l11-7z"/></svg>
            {{ book.kind === 'series' ? '查看系列' : '开始阅读' }}
          </button>
          <button class="ctx-item" @click="onEdit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            编辑
          </button>
          <div class="ctx-divider" />
          <button class="ctx-item danger" @click="onRemove">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6M8,6V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/></svg>
            从书架移除
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useLibraryStore } from '../stores/library'

const props = defineProps<{ book: Book }>()
const emit = defineEmits<{
  (e: 'open', book: Book): void
  (e: 'edit', book: Book): void
  (e: 'remove', id: string): void
}>()
const library = useLibraryStore()
const showMenu = ref<boolean>(false)
const menuStyle = ref<Record<string, string>>({})
const coverError = ref<boolean>(false)

const progress = computed(() => library.getProgress(props.book.id))
const progressPercent = computed(() => {
  if (!progress.value) return 0
  return Math.round(((progress.value.page + 1) / progress.value.total) * 100)
})

const coverSrc = computed(() => {
  if (coverError.value) return null
  if (props.book.coverData) return props.book.coverData
  if (props.book.cover) return `manga-file://${encodeURIComponent(props.book.cover)}`
  return null
})

function onOpen() {
  showMenu.value = false
  emit('open', props.book)
}
function onEdit() {
  showMenu.value = false
  emit('edit', props.book)
}
function onRemove() {
  showMenu.value = false
  emit('remove', props.book.id)
}
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

// 右键菜单
.ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

.ctx-menu {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: @bg-card;
  border: 1px solid @border;
  border-radius: @radius;
  padding: 6px;
  min-width: 150px;
  box-shadow: @shadow-card;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  color: @text-primary;
  font-size: 13px;
  border-radius: @radius-sm;
  cursor: pointer;
  transition: all @transition;

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

.ctx-divider {
  height: 1px;
  background: @border;
  margin: 4px 6px;
}

// 系列标签颜色
.type-badge.series {
  background: rgba(34, 197, 94, 0.75);
  color: #fff;
}
</style>
