# TSMusicBot Phase 8: Deployment & Packaging

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create one-click install experiences for Windows (.exe + portable .zip) and Linux (install script + Docker), plus the first-run Setup Wizard in the WebUI.

**Architecture:** Windows uses `pkg` to bundle Node.js into a single .exe with FFmpeg as a sidecar binary. Linux uses a shell script that installs dependencies and configures systemd, plus a Docker image. The Setup Wizard is a Vue.js view that guides users through initial configuration.

**Tech Stack:** pkg, Inno Setup/NSIS, Docker, bash

---

### Task 1: Windows start script

**Files:**
- Create: `scripts/start.bat`

- [ ] **Step 1: Create start.bat**

```bat
@echo off
title TSMusicBot
echo Starting TSMusicBot...
echo.

:: Check if node is available
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js is not installed. Please install Node.js 20 LTS from https://nodejs.org
    pause
    exit /b 1
)

:: Check if ffmpeg is available
where ffmpeg >nul 2>&1
if %errorlevel% neq 0 (
    echo FFmpeg not found in PATH. Checking local directory...
    if exist "%~dp0ffmpeg\ffmpeg.exe" (
        set PATH=%~dp0ffmpeg;%PATH%
        echo Using bundled FFmpeg.
    ) else (
        echo FFmpeg is required. Please install FFmpeg or place it in the ffmpeg\ directory.
        pause
        exit /b 1
    )
)

:: Install dependencies if needed
if not exist "%~dp0node_modules" (
    echo Installing dependencies...
    cd /d "%~dp0"
    call npm install --production
)

:: Start the application
cd /d "%~dp0"
node dist/index.js

pause
```

- [ ] **Step 2: Commit**

```bash
git add scripts/start.bat
git commit -m "feat: add Windows start script with dependency checks"
```

---

### Task 2: Linux install script

**Files:**
- Create: `scripts/install.sh`

- [ ] **Step 1: Create install.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "╔══════════════════════════════════════╗"
echo "║       TSMusicBot Installer           ║"
echo "╚══════════════════════════════════════╝"
echo ""

INSTALL_DIR="/opt/tsmusicbot"
SERVICE_NAME="tsmusicbot"

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "Unsupported OS"
    exit 1
fi

echo "[1/5] Installing system dependencies..."
case $OS in
    ubuntu|debian)
        sudo apt-get update -qq
        sudo apt-get install -y -qq curl ffmpeg
        ;;
    centos|rhel|fedora)
        sudo yum install -y curl ffmpeg
        ;;
    arch|manjaro)
        sudo pacman -S --noconfirm curl ffmpeg
        ;;
    *)
        echo "Unsupported OS: $OS. Please install Node.js 20 and FFmpeg manually."
        ;;
esac

echo "[2/5] Installing Node.js 20 LTS..."
if ! command -v node &> /dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y -qq nodejs 2>/dev/null || sudo yum install -y nodejs 2>/dev/null
fi
echo "Node.js $(node -v) installed"

echo "[3/5] Downloading TSMusicBot..."
sudo mkdir -p "$INSTALL_DIR"
# In production, this would download from GitHub releases
# For now, copy from current directory
if [ -d "$(pwd)/dist" ]; then
    sudo cp -r "$(pwd)"/* "$INSTALL_DIR/"
else
    echo "Please run this script from the TSMusicBot source directory after building."
    exit 1
fi

echo "[4/5] Installing npm dependencies..."
cd "$INSTALL_DIR"
sudo npm install --production

echo "[5/5] Creating systemd service..."
sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null <<EOL
[Unit]
Description=TSMusicBot - TeamSpeak Music Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node ${INSTALL_DIR}/dist/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOL

sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE_NAME}
sudo systemctl start ${SERVICE_NAME}

echo ""
echo "╔══════════════════════════════════════╗"
echo "║    TSMusicBot installed and running! ║"
echo "║                                      ║"
echo "║    WebUI: http://localhost:3000       ║"
echo "║                                      ║"
echo "║    Commands:                          ║"
echo "║    systemctl status tsmusicbot       ║"
echo "║    systemctl restart tsmusicbot      ║"
echo "║    systemctl stop tsmusicbot         ║"
echo "╚══════════════════════════════════════╝"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x scripts/install.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/install.sh
git commit -m "feat: add Linux one-click install script with systemd service"
```

---

### Task 3: Docker setup

**Files:**
- Create: `scripts/docker/Dockerfile`
- Create: `scripts/docker/docker-compose.yml`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/package*.json ./
RUN npm ci --production

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Create docker-compose.yml**

```yaml
version: '3.8'

services:
  tsmusicbot:
    build:
      context: ../..
      dockerfile: scripts/docker/Dockerfile
    container_name: tsmusicbot
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
    environment:
      - NODE_ENV=production
```

- [ ] **Step 3: Commit**

```bash
git add scripts/docker/
git commit -m "feat: add Dockerfile and docker-compose.yml"
```

---

### Task 4: Setup Wizard (first-run flow)

**Files:**
- Create: `web/src/views/Setup.vue`
- Modify: `web/src/router/index.ts` (add setup route)

- [ ] **Step 1: Create Setup wizard view**

Create `web/src/views/Setup.vue` — A 4-step wizard:
1. Welcome: set admin password, language, theme
2. TS Server: address, port, nickname, default channel, test connection button
3. Music Account (optional): QR code login for NetEase/QQ, skip button
4. Done: success message, redirect to home

```vue
<template>
  <div class="setup-wizard">
    <!-- Step Indicator -->
    <div class="steps">
      <div v-for="(label, i) in stepLabels" :key="i" class="step" :class="{ active: currentStep === i, done: currentStep > i }">
        <div class="step-dot">{{ currentStep > i ? '✓' : i + 1 }}</div>
        <div class="step-label">{{ label }}</div>
      </div>
    </div>

    <!-- Step 1: Welcome -->
    <div v-if="currentStep === 0" class="step-content">
      <h2>欢迎使用 TSMusicBot</h2>
      <p class="subtitle">请设置管理员密码以保护你的 WebUI</p>
      <div class="form-group">
        <label>管理员密码</label>
        <input type="password" v-model="adminPassword" placeholder="设置密码" class="input" />
      </div>
      <div class="form-group">
        <label>语言</label>
        <select v-model="locale" class="input">
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </div>
      <div class="form-group">
        <label>主题</label>
        <select v-model="theme" class="input">
          <option value="dark">深色</option>
          <option value="light">浅色</option>
        </select>
      </div>
      <button class="btn-primary" @click="currentStep = 1">下一步</button>
    </div>

    <!-- Step 2: TS Server -->
    <div v-if="currentStep === 1" class="step-content">
      <h2>连接 TeamSpeak 服务器</h2>
      <div class="form-group">
        <label>服务器地址</label>
        <input v-model="serverAddress" placeholder="ts.example.com" class="input" />
      </div>
      <div class="form-group">
        <label>端口</label>
        <input v-model.number="serverPort" type="number" placeholder="9987" class="input" />
      </div>
      <div class="form-group">
        <label>机器人昵称</label>
        <input v-model="nickname" placeholder="MusicBot" class="input" />
      </div>
      <div class="form-group">
        <label>默认频道 (可选)</label>
        <input v-model="defaultChannel" placeholder="音乐频道" class="input" />
      </div>
      <div class="btn-row">
        <button class="btn-secondary" @click="currentStep = 0">上一步</button>
        <button class="btn-primary" @click="createBotAndNext">下一步</button>
      </div>
    </div>

    <!-- Step 3: Music Account -->
    <div v-if="currentStep === 2" class="step-content">
      <h2>登录音乐账号 (可选)</h2>
      <p class="subtitle">登录后可播放 VIP/付费歌曲，跳过则只能播放免费歌曲</p>
      <div class="btn-row">
        <button class="btn-secondary" @click="currentStep = 1">上一步</button>
        <button class="btn-secondary" @click="currentStep = 3">跳过</button>
        <button class="btn-primary" @click="currentStep = 3">完成登录</button>
      </div>
    </div>

    <!-- Step 4: Done -->
    <div v-if="currentStep === 3" class="step-content done-step">
      <h2>设置完成!</h2>
      <p class="subtitle">TSMusicBot 已准备就绪</p>
      <button class="btn-primary" @click="$router.push('/')">开始使用</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import axios from 'axios';
import { useRouter } from 'vue-router';

const router = useRouter();

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
    await axios.post('/api/bot', {
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

<style lang="scss" scoped>
.setup-wizard {
  max-width: 560px;
  margin: 0 auto;
  padding-top: 40px;
}

.steps {
  display: flex;
  justify-content: space-between;
  margin-bottom: 48px;
}

.step {
  text-align: center;
  flex: 1;
}

.step-dot {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  background: var(--hover-bg);
  margin-bottom: 8px;
  opacity: 0.5;
}

.step.active .step-dot {
  background: var(--color-primary);
  color: white;
  opacity: 1;
}

.step.done .step-dot {
  background: var(--color-primary);
  color: white;
  opacity: 0.7;
}

.step-label {
  font-size: 12px;
  opacity: 0.5;
}

.step.active .step-label { opacity: 1; color: var(--color-primary); }

.step-content h2 {
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 8px;
}

.subtitle {
  color: var(--text-secondary);
  margin-bottom: 32px;
}

.form-group {
  margin-bottom: 20px;

  label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 6px;
    opacity: 0.8;
  }
}

.input {
  width: 100%;
  padding: 10px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: 14px;
  color: var(--text-primary);
  outline: none;
  font-family: inherit;

  &:focus {
    border-color: var(--color-primary);
  }
}

.btn-primary {
  padding: 10px 32px;
  background: var(--color-primary);
  color: white;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 600;
  transition: transform var(--transition-fast);

  &:hover { transform: scale(1.04); }
  &:active { transform: scale(0.96); }
}

.btn-secondary {
  padding: 10px 32px;
  background: var(--hover-bg);
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 600;
}

.btn-row {
  display: flex;
  gap: 12px;
  margin-top: 32px;
}

.done-step {
  text-align: center;
  padding-top: 60px;
}
</style>
```

- [ ] **Step 2: Add setup route to router**

Add to `web/src/router/index.ts` routes array:

```typescript
{
  path: '/setup',
  name: 'setup',
  component: () => import('../views/Setup.vue'),
},
```

- [ ] **Step 3: Commit**

```bash
git add web/src/views/Setup.vue web/src/router/index.ts
git commit -m "feat: add first-run Setup Wizard (4-step guided configuration)"
```

---

### Task 5: Final build and verify

- [ ] **Step 1: Build full project**

```bash
cd "C:/Users/saopig1/Music/teamspeak music bot"
npm run build
```

Expected: `dist/` (backend) and `web/dist/` (frontend) both exist.

- [ ] **Step 2: Run application**

```bash
node dist/index.js
```

Expected: Console shows "TSMusicBot started" and "WebUI: http://localhost:3000"

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: Phase 8 complete — deployment scripts, Docker, Setup Wizard. TSMusicBot v0.1.0"
```
