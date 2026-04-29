<template>
  <div class="max-w-[560px] mx-auto pt-10 px-4">
    <div class="flex justify-between mb-12">
      <div v-for="(label, i) in stepLabels" :key="i" class="text-center flex-1">
        <div
          class="w-9 h-9 rounded-full inline-flex items-center justify-center font-bold text-sm mb-2 transition-colors"
          :class="currentStep === i ? 'bg-primary text-white opacity-100' : currentStep > i ? 'bg-primary text-white opacity-70' : 'bg-hover-bg opacity-50'"
        >
          {{ currentStep > i ? '✓' : i + 1 }}
        </div>
        <div
          class="text-xs transition-opacity"
          :class="currentStep === i ? 'opacity-100 text-primary' : 'opacity-50'"
        >
          {{ label }}
        </div>
      </div>
    </div>

    <div v-if="currentStep === 0">
      <h2 class="text-[28px] font-bold mb-2">欢迎使用 TSMusicBot</h2>
      <p class="text-text-secondary mb-8">请设置管理员密码以保护你的 WebUI</p>
      <div class="mb-5">
        <label class="block text-[13px] font-semibold mb-1.5 opacity-80">管理员密码</label>
        <input type="password" v-model="adminPassword" placeholder="设置密码" class="w-full px-3.5 py-2.5 bg-bg-card border border-border-color rounded-[var(--radius-md)] text-sm text-text-primary outline-none font-family-inherit focus:border-primary" />
      </div>
      <div class="mb-5">
        <label class="block text-[13px] font-semibold mb-1.5 opacity-80">语言</label>
        <select v-model="locale" class="w-full px-3.5 py-2.5 bg-bg-card border border-border-color rounded-[var(--radius-md)] text-sm text-text-primary outline-none font-family-inherit focus:border-primary">
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </div>
      <div class="mb-5">
        <label class="block text-[13px] font-semibold mb-1.5 opacity-80">主题</label>
        <select v-model="theme" class="w-full px-3.5 py-2.5 bg-bg-card border border-border-color rounded-[var(--radius-md)] text-sm text-text-primary outline-none font-family-inherit focus:border-primary">
          <option value="dark">深色</option>
          <option value="light">浅色</option>
        </select>
      </div>
      <button class="px-8 py-2.5 bg-primary text-white rounded-[var(--radius-md)] text-sm font-semibold transition-transform hover:scale-[1.04] active:scale-[0.96]" @click="currentStep = 1">下一步</button>
    </div>

    <div v-if="currentStep === 1">
      <h2 class="text-[28px] font-bold mb-2">连接 TeamSpeak 服务器</h2>
      <div class="mb-5">
        <label class="block text-[13px] font-semibold mb-1.5 opacity-80">服务器地址</label>
        <input v-model="serverAddress" placeholder="ts.example.com" class="w-full px-3.5 py-2.5 bg-bg-card border border-border-color rounded-[var(--radius-md)] text-sm text-text-primary outline-none font-family-inherit focus:border-primary" />
      </div>
      <div class="mb-5">
        <label class="block text-[13px] font-semibold mb-1.5 opacity-80">端口</label>
        <input v-model.number="serverPort" type="number" placeholder="9987" class="w-full px-3.5 py-2.5 bg-bg-card border border-border-color rounded-[var(--radius-md)] text-sm text-text-primary outline-none font-family-inherit focus:border-primary" />
      </div>
      <div class="mb-5">
        <label class="block text-[13px] font-semibold mb-1.5 opacity-80">机器人昵称</label>
        <input v-model="nickname" placeholder="MusicBot" class="w-full px-3.5 py-2.5 bg-bg-card border border-border-color rounded-[var(--radius-md)] text-sm text-text-primary outline-none font-family-inherit focus:border-primary" />
      </div>
      <div class="mb-5">
        <label class="block text-[13px] font-semibold mb-1.5 opacity-80">默认频道 (可选)</label>
        <input v-model="defaultChannel" placeholder="音乐频道" class="w-full px-3.5 py-2.5 bg-bg-card border border-border-color rounded-[var(--radius-md)] text-sm text-text-primary outline-none font-family-inherit focus:border-primary" />
      </div>
      <div class="flex gap-3 mt-8">
        <button class="px-8 py-2.5 bg-hover-bg rounded-[var(--radius-md)] text-sm font-semibold" @click="currentStep = 0">上一步</button>
        <button class="px-8 py-2.5 bg-primary text-white rounded-[var(--radius-md)] text-sm font-semibold transition-transform hover:scale-[1.04] active:scale-[0.96]" @click="createBotAndNext">下一步</button>
      </div>
    </div>

    <div v-if="currentStep === 2">
      <h2 class="text-[28px] font-bold mb-2">登录音乐账号 (可选)</h2>
      <p class="text-text-secondary mb-8">登录后可播放 VIP/付费歌曲，跳过则只能播放免费歌曲</p>
      <div class="flex gap-3 mt-8">
        <button class="px-8 py-2.5 bg-hover-bg rounded-[var(--radius-md)] text-sm font-semibold" @click="currentStep = 1">上一步</button>
        <button class="px-8 py-2.5 bg-hover-bg rounded-[var(--radius-md)] text-sm font-semibold" @click="currentStep = 3">跳过</button>
        <button class="px-8 py-2.5 bg-primary text-white rounded-[var(--radius-md)] text-sm font-semibold transition-transform hover:scale-[1.04] active:scale-[0.96]" @click="currentStep = 3">完成登录</button>
      </div>
    </div>

    <div v-if="currentStep === 3" class="text-center pt-[60px]">
      <h2 class="text-[28px] font-bold mb-2">设置完成!</h2>
      <p class="text-text-secondary mb-8">TSMusicBot 已准备就绪</p>
      <button class="px-8 py-2.5 bg-primary text-white rounded-[var(--radius-md)] text-sm font-semibold transition-transform hover:scale-[1.04] active:scale-[0.96]" @click="$router.push('/')">开始使用</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { http } from '../utils/http';

const currentStep = ref(0);
const stepLabels = ['欢迎', 'TS 服务器', '音乐账号', '完成'];

const adminPassword = ref('');
const locale = ref('zh');
const theme = ref('dark');
const serverAddress = ref('');
const serverPort = ref(9987);
const nickname = ref('MusicBot');
const defaultChannel = ref('');

async function createBotAndNext() {
  try {
    await http.post('/api/bot', {
      name: `Bot - ${serverAddress.value}`,
      serverAddress: serverAddress.value,
      serverPort: serverPort.value,
      nickname: nickname.value,
      defaultChannel: defaultChannel.value,
      autoStart: true,
    });
    currentStep.value = 2;
  } catch (err) {
    alert('Failed to create bot: ' + (err as Error).message);
  }
}
</script>
