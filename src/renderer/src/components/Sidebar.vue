<template>
  <aside class="sidebar">
    <nav class="nav">
      <router-link to="/" class="nav-item" :class="{ active: route.path === '/' }">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        </svg>
        <span>书架</span>
      </router-link>

      <button class="nav-item" @click="$emit('showRecent')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <span>最近阅读</span>
      </button>

      <!-- 添加漫画：展开子菜单 -->
      <div class="nav-group">
        <button class="nav-item" :class="{ expanded: addMenuOpen }" @click="addMenuOpen = !addMenuOpen">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
          <span>添加漫画</span>
          <svg class="chevron" :class="{ rotate: addMenuOpen }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        <div class="sub-menu" :class="{ open: addMenuOpen }">
          <button class="sub-item" @click="emit('addFolder'); addMenuOpen = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
            </svg>
            添加文件夹
          </button>
          <button class="sub-item" @click="emit('addArchive'); addMenuOpen = false">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/>
              <line x1="10" y1="12" x2="14" y2="12"/>
            </svg>
            添加压缩包
          </button>
        </div>
      </div>

    </nav>

    <div class="sidebar-bottom">
      <button class="nav-item" @click="$emit('showSettings')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
        <span>设置</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const emit = defineEmits<{
  (e: 'showRecent'): void
  (e: 'addFolder'): void
  (e: 'addArchive'): void
  (e: 'showSettings'): void
}>()

const addMenuOpen = ref(false)
</script>

<style scoped lang="less">
.sidebar {
  width: @sidebar-width;
  height: 100%;
  background: @bg-sidebar;
  border-right: 1px solid @border;
  .flex-col();
  padding: 12px 8px;
  flex-shrink: 0;
}

.nav {
  .flex-col();
  gap: 2px;
  flex: 1;
}

.sidebar-bottom {
  border-top: 1px solid @border;
  padding-top: 8px;
  .flex-col();
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: @radius-sm;
  color: @text-secondary;
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  border: none;
  width: 100%;
  transition: all @transition;

  span {
    flex: 1;
    text-align: left;
  }

  &:hover {
    background: @bg-hover;
    color: @text-primary;
  }

  &.active,
  &.expanded {
    background: rgba(124, 58, 237, 0.2);
    color: @accent-light;
  }
}

.chevron {
  margin-left: auto;
  transition: transform 0.2s ease;
  flex-shrink: 0;

  &.rotate {
    transform: rotate(180deg);
  }
}

// 子菜单
.nav-group {
  .flex-col();
  gap: 0;
}

.sub-menu {
  overflow: hidden;
  max-height: 0;
  transition: max-height 0.2s ease, opacity 0.2s ease;
  opacity: 0;

  &.open {
    max-height: 120px;
    opacity: 1;
  }
}

.sub-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px 7px 40px;
  background: transparent;
  border: none;
  color: @text-muted;
  font-size: 12px;
  border-radius: @radius-sm;
  cursor: pointer;
  transition: all @transition;

  &:hover {
    background: @bg-hover;
    color: @text-primary;
  }
}
</style>
