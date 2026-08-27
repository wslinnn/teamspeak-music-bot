import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { addCollection } from '@iconify/vue';
import App from './App.vue';
import router from './router/index.js';
// 离线图标集合（npm run icons:build 生成，构建前自动刷新）：注册后
// Iconify 不再向 api.iconify.design 发起任何运行时请求
import iconsMdi from './assets/icons-mdi';
import './styles/index.css';

addCollection(iconsMdi as unknown as Parameters<typeof addCollection>[0]);

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
