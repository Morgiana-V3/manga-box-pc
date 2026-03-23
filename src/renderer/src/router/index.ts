import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import ReaderView from '../views/ReaderView.vue'
import SeriesView from '../views/SeriesView.vue'
import EditView from '../views/EditView.vue'
import GrabView from '../views/GrabView.vue'

const routes = [
  { path: '/', component: HomeView },
  { path: '/reader/:id', component: ReaderView },
  { path: '/series/:id', component: SeriesView },
  { path: '/edit/:id', component: EditView },
  { path: '/grab', component: GrabView }
]

export default createRouter({
  history: createWebHashHistory(),
  routes
})
