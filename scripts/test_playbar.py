"""Reproduce the player-bar-not-appearing bug."""
import time
import requests
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"

def get_bot_id():
    r = requests.get(f"{BASE}/api/bot/")
    return r.json()["bots"][0]["id"]

def stop(bot_id):
    requests.post(f"{BASE}/api/player/{bot_id}/stop")
    requests.post(f"{BASE}/api/player/{bot_id}/clear")

def play(bot_id, query="test"):
    requests.post(f"{BASE}/api/player/{bot_id}/play", json={"query": query, "platform": "netease"})

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context()
    ctx.add_init_script("""
      (() => {
        const OrigWS = window.WebSocket;
        window.__wsMessages = [];
        window.WebSocket = function(...args) {
          const ws = new OrigWS(...args);
          ws.addEventListener('message', (ev) => {
            try {
              const d = JSON.parse(ev.data);
              const summary = {type: d.type, botId: d.botId};
              if (d.status) summary.playing = d.status.playing;
              if (d.status?.currentSong) summary.song = d.status.currentSong.name;
              window.__wsMessages.push(summary);
              console.log('WS_MSG ' + JSON.stringify(summary));
            } catch(e) {}
          });
          return ws;
        };
        Object.assign(window.WebSocket, OrigWS);
      })();
    """)
    page = ctx.new_page()
    logs = []
    page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))

    bot_id = get_bot_id()
    stop(bot_id)
    time.sleep(0.6)

    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    time.sleep(0.8)

    # Hook into WebSocket messages from the page to confirm they arrive
    page.evaluate("""
      () => {
        const origWS = window.WebSocket;
        // Already connected via useWebSocket — tap Pinia store directly
        // Expose store state via window
        const store = window.__pinia?._s?.get('player');
        window.__getStore = () => ({
          bots: JSON.parse(JSON.stringify(store?.bots || [])),
          activeBotId: store?.activeBotId,
          currentSong: store?.currentSong ? JSON.parse(JSON.stringify(store.currentSong)) : null,
          isPlaying: store?.isPlaying,
        });
      }
    """)

    snap_before = page.evaluate("() => window.__getStore?.()")
    print("store before:", snap_before)

    # Player bar should be absent right now (nothing playing)
    initial = page.locator(".player-wrapper").count()
    print(f"initial .player-wrapper count: {initial}")

    # Trigger play via API (simulates any play trigger)
    play(bot_id, "test")

    # Poll for up to 6s to see if player bar appears automatically
    appeared_at = None
    for i in range(60):
        if page.locator(".player-wrapper").count() > 0:
            appeared_at = i * 0.1
            break
        page.wait_for_timeout(100)

    print(f"player bar appeared after: {appeared_at}")
    snap_after = page.evaluate("() => window.__getStore?.()")
    print("store after:", snap_after)

    # After force reload, does it appear?
    if appeared_at is None:
        page.reload()
        page.wait_for_load_state("networkidle")
        time.sleep(0.8)
        after_reload = page.locator(".player-wrapper").count()
        print(f"after reload .player-wrapper count: {after_reload}")

    print("--- console logs ---")
    for line in logs[-20:]:
        print(line)

    browser.close()
