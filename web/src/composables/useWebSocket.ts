import { ref, onUnmounted } from 'vue';
import { usePlayerStore } from '../stores/player.js';
import { useAuthStore } from '../stores/auth.js';

export function useWebSocket() {
  const connected = ref(false);
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url = `${protocol}//${window.location.host}/ws`;

    // Attach JWT token if available
    const authStore = useAuthStore();
    const token = authStore.getToken();
    if (token) {
      url += `?token=${encodeURIComponent(token)}`;
    }

    ws = new WebSocket(url);

    ws.onopen = () => {
      connected.value = true;
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const store = usePlayerStore();

      switch (data.type) {
        case 'init':
          for (const bot of data.bots) {
            store.updateBotStatus(bot.id, bot);
          }
          break;
        case 'stateChange':
          store.updateBotStatus(data.botId, data.status);
          if (data.queue) {
            store.setQueue(data.botId, data.queue);
          } else {
            store.fetchQueueForBot(data.botId);
          }
          break;
        case 'botConnected':
          store.updateBotStatus(data.botId, data.status);
          break;
        case 'botDisconnected':
          if (data.status) {
            store.updateBotStatus(data.botId, data.status);
          } else {
            const existing = store.bots.find((b) => b.id === data.botId);
            if (existing) {
              store.updateBotStatus(data.botId, {
                ...existing,
                connected: false,
                playing: false,
                paused: false,
                currentSong: null,
              });
            }
          }
          break;
        case 'botRemoved':
          store.removeBotStatus(data.botId);
          if (store.activeBotId === data.botId) {
            store.activeBotId = store.bots[0]?.id ?? null;
          }
          break;
      }
    };

    ws.onclose = (event) => {
      connected.value = false;
      // If closed with auth error (4001), don't reconnect — user needs to re-login
      if (event.code === 4001) {
        console.warn('WebSocket auth failed, stopping reconnection');
        return;
      }
      // Reconnect after 3 seconds
      reconnectTimer = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  function disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  }

  onUnmounted(disconnect);

  return { connected, connect, disconnect };
}
