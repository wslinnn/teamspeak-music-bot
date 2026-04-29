<template>
  <div class="home">
    <QuickActions />
    <NowPlaying />
    <RecentHistory />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { usePlayerStore } from '../stores/player';
import QuickActions from '../components/home/QuickActions.vue';
import NowPlaying from '../components/home/NowPlaying.vue';
import RecentHistory from '../components/home/RecentHistory.vue';

const store = usePlayerStore();

onMounted(() => {
  store.fetchHomeData();
});
</script>
