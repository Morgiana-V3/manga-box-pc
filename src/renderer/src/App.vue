<template>
  <div class="app-root">
    <!-- 自定义标题栏 -->
    <TitleBar />
    <!-- 路由视图 -->
    <div class="app-body">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useLibraryStore } from './stores/library'
import TitleBar from './components/TitleBar.vue'

const library = useLibraryStore()

onMounted(async () => {
  await library.loadFromStore()
})
</script>

<style scoped lang="less">
.app-root {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: @bg-primary;
  overflow: hidden;
}

.app-body {
  flex: 1;
  overflow: hidden;
}
</style>
