<template>
  <Teleport to="body">
    <TransitionGroup
      tag="div"
      name="toast"
      class="fixed top-4 right-4 z-[9999] flex flex-col gap-2"
    >
      <Toast
        v-for="item in store.items"
        :key="item.id"
        :item="item"
        @vue:mounted="scheduleRemove(item)"
      />
    </TransitionGroup>
  </Teleport>
</template>

<script setup lang="ts">
import { useToastStore } from '../../stores/toast.js';
import Toast from './Toast.vue';

const store = useToastStore();

function scheduleRemove(item: { id: string; duration: number }) {
  setTimeout(() => store.remove(item.id), item.duration);
}
</script>

<style>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
