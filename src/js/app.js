// AVIS Main App Controller — v3.0 with live thinking steps + abort + self-edit
const AVIS = {
  isProcessing: false,
  terminalLog: [],
  activeStepPanel: null,  // reference to live step panel DOM element
  steps: {},              // stepId → DOM element for live updates
  lastUserMessage: null,  // for retry
  lastUserFiles: null,

  async init() {
    // Check if a client code is persisted — boot directly into their experience
    const persistedClient = await window.avis.storeGet('activeClient', null);
    const persistedMode = await window.avis.storeGet('bootMode', null); // 'operator' or null

    // CLIENT PLATFORM INIT (always — needed for code entry screen)
    if (typeof ClientManager !== 'undefined') {
      await ClientManager.init();
      const clientDirs = await window.avis.clientList();
      for (const code of clientDirs) {
        await ClientManager.registerClient(code);
      }
      window.avis.onWeeklyCheckin(() => this.generateWeeklyCheckIn());
      window.avis.onClientAlert((alert) => {
        this.showToast(`[${alert.client}] ${alert.type}: ${alert.days || ''} days`, 'warning');
      });
    }

    // ALWAYS show code entry screen — auto-fill last used code
    let lastCode = persistedClient || (persistedMode === 'operator' ? 'AVL' : null);
    if (lastCode === 'AMB-001') lastCode = 'AMBER'; // migrate old code
    this._showCodeEntryScreen(lastCode);
  },

  // Full operator mode initialization
  async _operatorBoot() {
    if (!this._licenseVerified) {
      const licenseOk = await this.checkLicense();
      if (!licenseOk) return;
    }

    this._paths = await window.avis.getPaths();
    this.setupTabs();
    this.setupInput();
    this.updateProviderStatus();
    this.renderMeters();
    await this.loadHistoryList();

    Orchestrator.onStep = (id, type, message, status) => this.handleStep(id, type, message, status);
    Orchestrator.onStreamChunk = (chunk, fullText) => this.handleStreamChunk(chunk, fullText);

    window.avis.onSentinelReport((report) => {
      const degraded = Object.entries(report.results).filter(([_, v]) => v !== 'healthy');
      if (degraded.length > 0) this.showToast(`SENTINEL: ${degraded.length} provider(s) degraded`, 'warning');
      if (typeof MissionControl !== 'undefined') MissionControl.updateHealthIndicators(report.results);
    });

    if (typeof MissionControl !== 'undefined') MissionControl.render();
    this.refreshClaudeCodeLock();
    window.avis.onClaudeRateLimits((data) => this.updateRateLimits(data));

    const firstRun = await window.avis.isFirstRun();
    if (firstRun) this.showOnboarding();

    await this.detectProviders();
    setTimeout(() => this.healthCheckAll(), 2000);
    setInterval(() => this.healthCheckAll(), 15 * 60 * 1000);
    window.avis.onUpdateStatus((data) => this.handleUpdateStatus(data));

    try {
      const ver = await window.avis.getAppVersion();
      const verEl = document.getElementById('app-version');
      if (verEl) verEl.textContent = `v${ver}`;
    } catch (e) {}

    this.renderChangelog();
    this.initDevConsole();
    this.startClock();
    this.updateChromeStatus();
    setInterval(() => this.updateChromeStatus(), 10000);

    window.avis.onLicenseRevoked((data) => {
      document.getElementById('license-revoked').style.display = 'flex';
      document.getElementById('revoked-reason').textContent = data.reason || 'Your license has been deactivated.';
    });
    window.avis.onLicenseStatus((data) => {
      if (data.valid && data.tier === 'master') {
        const ver = document.getElementById('app-version');
        if (ver) ver.innerHTML += ' <span class="master-badge">MASTER</span>';
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        const devBtn = document.getElementById('dev-tab-btn');
        if (devBtn) { devBtn.style.display = devBtn.style.display !== 'none' ? 'none' : ''; }
        return;
      }
      if (e.ctrlKey && e.key === 'k') { e.preventDefault(); this.toggleCommandPalette(); }
      if (e.ctrlKey && e.key === 'n') { e.preventDefault(); this.newConversation(); }
      if (e.ctrlKey && e.key === 'e') { e.preventDefault(); this.exportConversation(); }
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') { e.preventDefault(); const tabs = document.querySelectorAll('.nav-tab:not([style*="display:none"])'); const idx = parseInt(e.key) - 1; if (tabs[idx]) tabs[idx].click(); }
      if (e.key === 'Escape') this.closeCommandPalette();
    });

    this.initParticles();
    window.addEventListener('beforeunload', () => MemoryManager.saveLastSessionInfo());
    this.checkResumableSession();
  },

  // ================================================================
  // CODE ENTRY SCREEN — universal AVIS welcome
  // ================================================================
  _showCodeEntryScreen(prefillCode) {
    // Hide all AVIS operator UI
    document.querySelector('.titlebar')?.style.setProperty('display', 'none');
    document.querySelector('.main-layout')?.style.setProperty('display', 'none');

    // Create the code entry overlay
    let overlay = document.getElementById('code-entry-screen');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'code-entry-screen';
      document.body.appendChild(overlay);
    }

    overlay.style.cssText = `
      position:fixed;inset:0;z-index:50000;
      background:linear-gradient(135deg, #060810 0%, #0a0f1a 50%, #060810 100%);
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:'Inter','Segoe UI',sans-serif;
      -webkit-app-region:drag;
    `;

    overlay.innerHTML = `
      <div style="text-align:center;-webkit-app-region:no-drag;">
        <!-- Logo -->
        <div style="margin-bottom:24px;">
          <div style="width:80px;height:80px;border-radius:50%;border:2px solid rgba(0,168,255,0.2);margin:0 auto;display:flex;align-items:center;justify-content:center;position:relative;">
            <div style="position:absolute;inset:-4px;border:1px solid transparent;border-top-color:rgba(0,168,255,0.5);border-radius:50%;animation:spin 4s linear infinite;"></div>
            <span style="font-size:32px;font-weight:800;color:#00a8ff;text-shadow:0 0 20px rgba(0,168,255,0.3);">A</span>
          </div>
        </div>

        <h1 style="font-size:28px;font-weight:800;color:#fff;letter-spacing:8px;margin-bottom:4px;">AVIS</h1>
        <p style="font-size:11px;color:rgba(255,255,255,0.3);letter-spacing:4px;text-transform:uppercase;margin-bottom:32px;">Avel Intelligence Services</p>

        <!-- Code entry -->
        <div style="margin-bottom:12px;">
          <input type="text" id="client-code-input" placeholder="Enter your code" value="${prefillCode || ''}"
            style="width:240px;padding:14px 20px;border-radius:12px;border:1.5px solid rgba(255,255,255,0.1);
            background:rgba(255,255,255,0.05);color:#fff;font-size:15px;font-weight:600;
            text-align:center;letter-spacing:3px;text-transform:uppercase;
            font-family:'JetBrains Mono','Courier New',monospace;outline:none;
            transition:border-color 0.2s;"
            onfocus="this.style.borderColor='rgba(0,168,255,0.4)'"
            onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
            onkeydown="if(event.key==='Enter')AVIS.submitClientCode()">
        </div>

        <div id="code-entry-error" style="font-size:11px;color:#ff4444;height:20px;margin-bottom:8px;"></div>

        <button onclick="AVIS.submitClientCode()"
          style="width:240px;padding:12px;border-radius:12px;border:none;
          background:linear-gradient(135deg,#00a8ff,#0066cc);color:#fff;
          font-size:13px;font-weight:700;cursor:pointer;letter-spacing:1px;
          transition:transform 0.15s,box-shadow 0.15s;-webkit-app-region:no-drag;"
          onmousedown="this.style.transform='scale(0.97)'"
          onmouseup="this.style.transform='scale(1)'"
        >Continue</button>

        <div style="margin-top:40px;font-size:9px;color:rgba(255,255,255,0.12);letter-spacing:2px;">
          AVEL PRODUCTIONS LLC
        </div>
      </div>

      <!-- Window controls -->
      <div style="position:fixed;top:8px;right:8px;display:flex;gap:4px;-webkit-app-region:no-drag;">
        <button onclick="avis.minimize()" style="width:28px;height:28px;border:none;background:none;color:rgba(255,255,255,0.2);font-size:14px;cursor:pointer;">&#x2500;</button>
        <button onclick="avis.maximize()" style="width:28px;height:28px;border:none;background:none;color:rgba(255,255,255,0.2);font-size:14px;cursor:pointer;">&#x25A1;</button>
        <button onclick="avis.close()" style="width:28px;height:28px;border:none;background:none;color:rgba(255,255,255,0.2);font-size:14px;cursor:pointer;">&#x2715;</button>
      </div>

      <style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>
    `;

    // Focus the input
    setTimeout(() => document.getElementById('client-code-input')?.focus(), 300);
  },

  async submitClientCode() {
    const input = document.getElementById('client-code-input');
    const errorEl = document.getElementById('code-entry-error');
    if (!input) return;

    const code = input.value.trim().toUpperCase();
    if (!code) {
      if (errorEl) errorEl.textContent = 'Please enter a code';
      return;
    }

    // Special operator code — bypass to full AVIS
    const operatorPassword = await window.avis.storeGet('operatorPassword', 'avis2026');
    if (code === 'OPERATOR' || code === 'AVL-000' || code === 'AVL' || code === operatorPassword.toUpperCase()) {
      await window.avis.storeSet('bootMode', 'operator');
      document.getElementById('code-entry-screen')?.remove();
      document.querySelector('.titlebar')?.style.setProperty('display', '');
      document.querySelector('.main-layout')?.style.setProperty('display', '');
      await this._operatorBoot();
      return;
    }

    // Check if client exists
    const clients = await window.avis.clientList();
    if (!clients.includes(code)) {
      if (errorEl) errorEl.textContent = 'Code not recognized';
      input.style.borderColor = '#ff4444';
      setTimeout(() => { input.style.borderColor = 'rgba(255,255,255,0.1)'; }, 1500);
      return;
    }

    // Valid client — check device binding
    const profile = await ClientManager.getProfile(code);
    const deviceId = await window.avis.getDeviceId();
    const isOperator = await window.avis.isOperatorDevice();

    if (!isOperator) {
      // Non-operator device — enforce single-device binding
      if (profile.bound_device && profile.bound_device !== deviceId) {
        if (errorEl) errorEl.textContent = 'This code is already activated on another device';
        input.style.borderColor = '#ff4444';
        setTimeout(() => { input.style.borderColor = 'rgba(255,255,255,0.1)'; }, 2000);
        return;
      }
      // First activation on this device — bind it
      if (!profile.bound_device) {
        await ClientManager.updateProfile(code, { bound_device: deviceId, activated_at: new Date().toISOString() });
      }
    }

    if (errorEl) errorEl.textContent = '';

    // Brief loading animation
    input.disabled = true;
    input.style.borderColor = '#00a8ff';

    // Animate transition — fade the code screen to the client's primary color
    const overlay = document.getElementById('code-entry-screen');
    if (overlay && profile?.theme) {
      overlay.style.transition = 'background 0.5s ease';
      overlay.style.background = profile.theme.color_background || '#fff0f7';
    }

    // Set active client and persist
    await ClientManager.setActiveClient(code);
    await window.avis.storeSet('bootMode', null); // clear operator flag

    // Determine client type — finance_coach gets full coach UI, standard gets themed AVIS
    const clientType = profile.client_type || 'standard';

    if (clientType === 'standard') {
      // STANDARD CLIENT — boot into regular AVIS with their theme applied
      // Skip license check for standard clients
      this._licenseVerified = true;
      this._standardClientCode = code;
      await window.avis.storeSet('bootMode', 'operator');
      setTimeout(async () => {
        overlay?.remove();
        document.querySelector('.titlebar')?.style.setProperty('display', '');
        document.querySelector('.main-layout')?.style.setProperty('display', '');
        await this._operatorBoot();

        // Apply client theme on top of regular AVIS
        if (typeof ThemeManager !== 'undefined' && profile.theme) {
          ThemeManager.applyTheme(profile.theme);
          const bgCSS = ThemeManager.getBackgroundCSS(profile.theme);
          if (bgCSS) document.body.style.backgroundImage = bgCSS;
        }

        // Update title with client name
        document.title = `AVIS — ${profile.display_name}`;
        const titleEl = document.getElementById('app-title');
        if (titleEl) titleEl.textContent = `AVIS — ${profile.display_name}`;

        // Hide operator-only elements for standard clients
        const devBtn = document.getElementById('dev-tab-btn');
        if (devBtn) devBtn.style.display = 'none';
        const councilTab = document.querySelector('.council-tab');
        if (councilTab) councilTab.style.display = 'none';
        // Hide right panel (usage meters)
        const rightPanel = document.querySelector('.right-panel');
        if (rightPanel) rightPanel.style.display = 'none';

        this.showToast(`Welcome, ${profile.display_name}`, 'success');
      }, 600);
    } else {
      // FINANCE COACH CLIENT — full coach experience
      this._paths = await window.avis.getPaths();
      await MemoryManager.init();
      await HotConfig.init();
      this.setupTabs();
      this.setupInput();
      Orchestrator.onStep = (id, type, message, status) => this.handleStep(id, type, message, status);
      Orchestrator.onStreamChunk = (chunk, fullText) => this.handleStreamChunk(chunk, fullText);
      this.startClock();

      // Remove code entry screen
      setTimeout(() => {
        overlay?.remove();
        document.querySelector('.titlebar')?.style.setProperty('display', '');
        document.querySelector('.main-layout')?.style.setProperty('display', '');
        this.enterClientMode(code);
      }, 600);
    }
  },

  async checkResumableSession() {
    const lastSession = await MemoryManager.getLastSession();
    if (!lastSession || !lastSession.conversationId || lastSession.messageCount === 0) return;

    // Show resume banner in welcome area
    const welcome = document.getElementById('welcome-msg');
    if (!welcome) return;

    const resumeBar = document.createElement('div');
    resumeBar.className = 'resume-bar';
    resumeBar.innerHTML = `
      <span class="resume-text">Resume "${this.escapeHtml((lastSession.title || 'Last conversation').substring(0, 50))}" (${lastSession.messageCount} messages)?</span>
      <button class="resume-btn resume-yes" onclick="AVIS.resumeSession()">Resume</button>
      <button class="resume-btn resume-no" onclick="this.parentElement.remove()">New Chat</button>
    `;
    welcome.querySelector('.welcome-content')?.appendChild(resumeBar);
  },

  async resumeSession() {
    const conv = await MemoryManager.resumeLastConversation();
    if (!conv) { this.showToast('Could not restore session'); return; }

    const welcome = document.getElementById('welcome-msg');
    if (welcome) welcome.remove();

    const chatArea = document.getElementById('chat-area');
    chatArea.innerHTML = '';

    // Replay messages into UI
    for (const msg of conv.messages) {
      if (msg.role === 'user') {
        this.addMessageToChat('user', msg.content);
      } else if (msg.role === 'assistant') {
        this.addMessageToChat('assistant', msg.content, msg.provider, msg.model);
      }
    }

    this.showToast(`Resumed: ${conv.messages.length} messages loaded`);
  },

  // ====================================================================
  // Command Palette (Ctrl+K)
  // ====================================================================
  _cmdPaletteOpen: false,

  COMMANDS: [
    { icon: '\u2795', label: 'New Chat', shortcut: 'Ctrl+N', action: () => AVIS.newConversation() },
    { icon: '\u2B07', label: 'Export Conversation', shortcut: 'Ctrl+E', action: () => AVIS.exportConversation() },
    { icon: '\u2699', label: 'Settings', action: () => AVIS.openSettings() },
    { icon: '\uD83D\uDCCB', label: 'Copy Chat', action: () => AVIS.copyChatHistory() },
    { icon: '\u26A1', label: 'Switch to Status', shortcut: 'Ctrl+1', action: () => AVIS.switchToTab('providers') },
    { icon: '\uD83D\uDD0D', label: 'Switch to Search', shortcut: 'Ctrl+3', action: () => AVIS.switchToTab('search') },
    { icon: '\uD83C\uDFAF', label: 'Switch to Control', shortcut: 'Ctrl+7', action: () => AVIS.switchToTab('control') },
    { icon: '\u2B50', label: 'Switch to Council', shortcut: 'Ctrl+8', action: () => AVIS.switchToTab('council') },
    { icon: '\uD83D\uDCBB', label: 'Switch to Terminal', shortcut: 'Ctrl+5', action: () => AVIS.switchToTab('terminal') },
    { icon: '\u23F0', label: 'Switch to History', shortcut: 'Ctrl+2', action: () => AVIS.switchToTab('history') },
    { icon: '\uD83D\uDD04', label: 'Check for Updates', action: () => AVIS.manualUpdateCheck() },
    { icon: '\uD83C\uDFA8', label: 'Direct Chat', shortcut: 'Ctrl+4', action: () => AVIS.switchToTab('browser') },
    { icon: '\uD83D\uDCC4', label: 'Workflow Builder', shortcut: 'Ctrl+6', action: () => AVIS.switchToTab('workflow') },
  ],

  toggleCommandPalette() {
    if (this._cmdPaletteOpen) { this.closeCommandPalette(); return; }
    this._cmdPaletteOpen = true;

    const overlay = document.createElement('div');
    overlay.className = 'cmd-overlay';
    overlay.id = 'cmd-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) this.closeCommandPalette(); };

    const palette = document.createElement('div');
    palette.className = 'cmd-palette';

    const input = document.createElement('input');
    input.className = 'cmd-input';
    input.placeholder = 'Type a command...';
    input.id = 'cmd-search';

    const results = document.createElement('div');
    results.className = 'cmd-results';
    results.id = 'cmd-results';

    palette.appendChild(input);
    palette.appendChild(results);
    overlay.appendChild(palette);
    document.body.appendChild(overlay);

    this._renderCommands('');
    input.focus();

    input.addEventListener('input', () => this._renderCommands(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.closeCommandPalette(); return; }
      if (e.key === 'Enter') {
        const active = results.querySelector('.cmd-item.active') || results.querySelector('.cmd-item');
        if (active) active.click();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = results.querySelectorAll('.cmd-item');
        let idx = Array.from(items).findIndex(i => i.classList.contains('active'));
        items.forEach(i => i.classList.remove('active'));
        if (e.key === 'ArrowDown') idx = (idx + 1) % items.length;
        else idx = (idx - 1 + items.length) % items.length;
        items[idx]?.classList.add('active');
      }
    });
  },

  _renderCommands(query) {
    const results = document.getElementById('cmd-results');
    if (!results) return;
    const q = query.toLowerCase();
    const filtered = this.COMMANDS.filter(c => !q || c.label.toLowerCase().includes(q));
    results.innerHTML = filtered.map((c, i) => `
      <div class="cmd-item${i === 0 ? ' active' : ''}" onclick="AVIS.COMMANDS.find(x=>x.label==='${c.label.replace(/'/g, "\\'")}')?.action(); AVIS.closeCommandPalette();">
        <span class="cmd-icon">${c.icon}</span>
        <span class="cmd-label">${c.label}</span>
        ${c.shortcut ? `<span class="cmd-shortcut">${c.shortcut}</span>` : ''}
      </div>
    `).join('');
  },

  closeCommandPalette() {
    this._cmdPaletteOpen = false;
    const overlay = document.getElementById('cmd-overlay');
    if (overlay) overlay.remove();
  },

  // Claude rate limit display
  updateRateLimits(data) {
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    if (data.requestLimit > 0) {
      setEl('rl-req-remaining', data.requestsRemaining);
      setEl('rl-req-limit', data.requestLimit);
      const reqPct = (data.requestsRemaining / data.requestLimit) * 100;
      const reqBar = document.getElementById('rl-req-bar');
      if (reqBar) {
        reqBar.style.width = reqPct + '%';
        reqBar.className = 'context-fill ' + (reqPct > 50 ? 'low' : reqPct > 20 ? 'medium' : 'high');
      }
      setEl('rl-req-reset', data.requestReset || '--');
    }

    if (data.tokenLimit > 0) {
      const tokRemaining = data.tokensRemaining >= 1000 ? Math.round(data.tokensRemaining / 1000) + 'K' : data.tokensRemaining;
      const tokLimit = data.tokenLimit >= 1000 ? Math.round(data.tokenLimit / 1000) + 'K' : data.tokenLimit;
      setEl('rl-tok-remaining', tokRemaining);
      setEl('rl-tok-limit', tokLimit);
      const tokPct = (data.tokensRemaining / data.tokenLimit) * 100;
      const tokBar = document.getElementById('rl-tok-bar');
      if (tokBar) {
        tokBar.style.width = tokPct + '%';
        tokBar.className = 'context-fill ' + (tokPct > 50 ? 'low' : tokPct > 20 ? 'medium' : 'high');
      }
      setEl('rl-tok-reset', data.tokenReset || '--');
    }

    setEl('rl-updated', new Date().toLocaleTimeString());

    // Show warning if running low
    const warning = document.getElementById('rl-warning');
    if (warning) {
      const reqPct = data.requestLimit > 0 ? (data.requestsRemaining / data.requestLimit) * 100 : 100;
      const tokPct = data.tokenLimit > 0 ? (data.tokensRemaining / data.tokenLimit) * 100 : 100;
      if (data.retryAfter) {
        warning.style.display = 'block';
        warning.textContent = 'RATE LIMITED — retry after ' + data.retryAfter + 's';
      } else if (reqPct < 20 || tokPct < 20) {
        warning.style.display = 'block';
        warning.textContent = 'Approaching rate limit — consider spacing requests or stepping down to Haiku';
      } else {
        warning.style.display = 'none';
      }
    }
  },

  // ====================================================================
  // Sound System — disabled
  // ====================================================================
  initSounds() {},
  playSound() {},
  playNotificationSound() {},

  // ====================================================================
  // GSAP UI Micro-Animations
  // ====================================================================
  animateMessageIn(el) {
    if (typeof gsap === 'undefined') return;
    gsap.from(el, { opacity: 0, y: 14, duration: 0.35, ease: 'power2.out' });
  },

  animateSendPress() {
    if (typeof gsap === 'undefined') return;
    const btn = document.getElementById('send-btn');
    if (!btn) return;
    gsap.to(btn, { scale: 0.88, duration: 0.1, yoyo: true, repeat: 1, ease: 'power2.inOut' });
  },

  animateStepsIn(panel) {
    if (typeof gsap === 'undefined') return;
    gsap.from(panel, { height: 0, opacity: 0, duration: 0.4, ease: 'power2.out' });
  },

  animateTabSwitch(incoming) {
    if (typeof gsap === 'undefined') return;
    gsap.from(incoming, { opacity: 0, x: 8, duration: 0.2, ease: 'power2.out' });
  },

  // Kept for backward compat — old Web Audio path
  _legacyNotificationSound() {
    if (!HotConfig.get('notificationSound')) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
      // Second tone (pleasant two-note chime)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 1320;
      osc2.type = 'sine';
      gain2.gain.setValueAtTime(0.1, ctx.currentTime + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc2.start(ctx.currentTime + 0.15);
      osc2.stop(ctx.currentTime + 0.5);
    } catch (e) {}
  },

  handleUpdateStatus(data) {
    const bar = document.getElementById('update-bar');
    const msg = document.getElementById('update-message');
    const restartBtn = document.getElementById('update-restart-btn');
    const cancelBtn = document.getElementById('update-cancel-btn');
    const icon = document.getElementById('update-icon');
    if (!bar || !msg) return;

    bar.style.display = 'flex';
    bar.className = 'update-bar' + (data.status === 'ready' ? ' ready' : data.status === 'downloading' ? ' downloading' : '');

    const icons = { checking: '\u21BB', available: '\u2B07', downloading: '\u2B07', ready: '\u2713', current: '\u2713', error: '\u26A0\uFE0F' };
    if (icon) icon.textContent = icons[data.status] || '\u21BB';
    msg.textContent = data.message || '';

    if (data.status === 'ready') {
      if (restartBtn) restartBtn.style.display = 'inline';
      if (cancelBtn) cancelBtn.style.display = 'inline';
    } else {
      if (restartBtn) restartBtn.style.display = 'none';
      if (cancelBtn) cancelBtn.style.display = 'none';
    }

    // Hide after 5s if up to date
    if (data.status === 'current') {
      setTimeout(() => { bar.style.display = 'none'; }, 5000);
    }
  },

  // ====================================================================
  // License System
  // ====================================================================
  async checkLicense() {
    const stored = await window.avis.checkLicense();
    // If a key exists, always try to validate it — don't rely on stored.valid
    // (fixes race condition where main process hasn't finished async validation yet)
    if (stored.key) {
      const result = await window.avis.validateLicense(stored.key);
      if (result.valid) return true;
    }
    // No valid license — show gate
    document.getElementById('license-gate').style.display = 'flex';
    document.getElementById('license-key-input')?.focus();
    // Enter key to activate
    document.getElementById('license-key-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.activateLicense();
    });
    return false;
  },

  async activateLicense() {
    const input = document.getElementById('license-key-input');
    const errorEl = document.getElementById('license-error');
    const btn = document.getElementById('license-activate-btn');
    const key = input?.value?.trim();

    if (!key) { if (errorEl) errorEl.textContent = 'Please enter a license key'; return; }

    if (btn) { btn.disabled = true; btn.textContent = 'Validating...'; }
    if (errorEl) errorEl.textContent = '';

    const result = await window.avis.validateLicense(key);

    if (result.valid) {
      document.getElementById('license-gate').style.display = 'none';
      this._licenseVerified = true;
      this.init();
    } else {
      if (errorEl) errorEl.textContent = result.reason;
      if (btn) { btn.disabled = false; btn.textContent = 'Activate'; }
    }
  },

  async reactivateLicense() {
    const input = document.getElementById('reactivate-key-input');
    const errorEl = document.getElementById('reactivate-error');
    const key = input?.value?.trim();

    if (!key) { if (errorEl) errorEl.textContent = 'Please enter a license key'; return; }

    const result = await window.avis.validateLicense(key);
    if (result.valid) {
      document.getElementById('license-revoked').style.display = 'none';
    } else {
      if (errorEl) errorEl.textContent = result.reason;
    }
  },

  // Provider health state: { status, reason } per provider
  providerHealth: {},

  async detectProviders() {
    const providers = [
      { key: 'claude', obj: ClaudeProvider }, { key: 'deepseek', obj: DeepSeekProvider }, { key: 'openai', obj: OpenAIProvider },
      { key: 'gemini', obj: GeminiProvider },
      { key: 'mistral', obj: MistralProvider }, { key: 'perplexity', obj: PerplexityProvider },
    ];
    for (const p of providers) {
      const key = await window.avis.getApiKey(p.key);
      p.obj.status = key ? 'active' : 'unconfigured';
      this.providerHealth[p.key] = key
        ? { status: 'active', reason: 'ACTIVE' }
        : { status: 'unconfigured', reason: 'NOT SET' };
    }
    // Firecrawl (tool, not a chat provider — just check key exists)
    const fcKey = await window.avis.getApiKey('firecrawl');
    this.providerHealth['firecrawl'] = fcKey
      ? { status: 'active', reason: 'ACTIVE' }
      : { status: 'unconfigured', reason: 'NOT SET' };
    // Update BOTH panels
    this.updateProviderStatus();
    this.renderMeters();
  },

  // FIX 3: Ping all configured providers to check health
  async healthCheckAll() {
    const providers = ['claude', 'openai', 'gemini', 'mistral', 'deepseek', 'perplexity', 'firecrawl'];
    const checks = providers.map(async (p) => {
      const key = await window.avis.getApiKey(p);
      if (!key) { this.providerHealth[p] = { status: 'unconfigured', reason: 'NOT SET' }; return; }

      // Check cooldown
      if (Orchestrator.rateLimitCooldowns?.[p] > Date.now()) {
        this.providerHealth[p] = { status: 'cooldown', reason: 'RATE LIMITED' }; return;
      }

      try {
        const result = await window.avis.testProvider(p, key);
        if (result.success) {
          this.providerHealth[p] = { status: 'active', reason: 'ACTIVE' };
          const obj = Orchestrator.providerMap[p]?.();
          if (obj) obj.status = 'active';
        } else {
          const reason = this.classifyProviderError(result.error || '');
          this.providerHealth[p] = { status: reason.status, reason: reason.label };
          const obj = Orchestrator.providerMap[p]?.();
          if (obj) obj.status = reason.status;
        }
      } catch (e) {
        this.providerHealth[p] = { status: 'error', reason: 'ERROR' };
      }
    });

    await Promise.allSettled(checks);
    this.updateProviderStatus();
    this.renderMeters();
  },

  classifyProviderError(errMsg) {
    const msg = (errMsg || '').toLowerCase();
    if (msg.includes('payment') || msg.includes('billing') || msg.includes('402') || msg.includes('insufficient')) {
      return { status: 'payment', label: 'PAYMENT REQUIRED' };
    }
    if (msg.includes('rate') || msg.includes('429') || msg.includes('quota')) {
      return { status: 'cooldown', label: 'RATE LIMITED' };
    }
    if (msg.includes('invalid') || msg.includes('401') || msg.includes('auth')) {
      return { status: 'error', label: 'INVALID KEY' };
    }
    if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('enotfound')) {
      return { status: 'error', label: 'UNREACHABLE' };
    }
    return { status: 'error', label: 'ERROR' };
  },

  // Tab switching — uses .nav-tab in titlebar
  setupTabs() {
    const allTabs = document.querySelectorAll('.nav-tab');
    const allSections = document.querySelectorAll('.panel-section');
    const chatCenter = document.getElementById('chat-center');
    const councilCenter = document.getElementById('council-center');

    allTabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        allTabs.forEach(t => t.classList.remove('active'));
        allSections.forEach(s => { s.classList.remove('active'); s.style.display = 'none'; });

        tab.classList.add('active');
        const targetId = `${tab.dataset.tab}-section`;
        const targetSection = document.getElementById(targetId);
        if (targetSection) { targetSection.classList.add('active'); targetSection.style.display = 'block'; AVIS.animateTabSwitch(targetSection); }

        // Toggle center panel: Council gets its own full center view
        if (tab.dataset.tab === 'council') {
          if (chatCenter) chatCenter.style.display = 'none';
          if (councilCenter) councilCenter.style.display = 'flex';
        } else {
          if (chatCenter) chatCenter.style.display = '';
          if (councilCenter) councilCenter.style.display = 'none';
        }
      });
    });
  },

  // FIX 4: Enter = send, Shift+Enter = newline with auto-resize
  setupInput() {
    const input = document.getElementById('chat-input');
    const self = this;

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          // Shift+Enter: allow default newline, then resize after a tick
          setTimeout(() => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 150) + 'px';
          }, 0);
        } else {
          // Enter alone: send message
          e.preventDefault();
          self.sendMessage();
        }
      }
    });

    input.addEventListener('input', function() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 150) + 'px';
    });
    document.getElementById('search-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.doSearch();
    });
    document.getElementById('direct-chat-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.directChatSend();
    });
    // Council input — Enter to send, Shift+Enter newline, auto-resize
    const councilInput = document.getElementById('council-input');
    if (councilInput) {
      councilInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.startCouncil(); }
        if (e.key === 'Enter' && e.shiftKey) {
          setTimeout(() => { councilInput.style.height = 'auto'; councilInput.style.height = Math.min(councilInput.scrollHeight, 150) + 'px'; }, 0);
        }
      });
      // Paste image support
      councilInput.addEventListener('paste', (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            e.preventDefault();
            const blob = item.getAsFile();
            const reader = new FileReader();
            reader.onload = () => {
              this._councilFiles = this._councilFiles || [];
              this._councilFiles.push({ type: 'image', data: reader.result.split(',')[1], name: 'pasted-image.png', mimeType: item.type });
              this._renderCouncilFilePreviews();
            };
            reader.readAsDataURL(blob);
          }
        }
      });
    }
    this._councilFiles = [];
    document.getElementById('browser-url-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.navigateBrowser();
      }
    });

    // BUG 4: STOP button
    document.getElementById('stop-btn')?.addEventListener('click', () => this.stopRequest());
  },

  // ====================================================================
  // BUG 4: Stop / Cancel active request
  // ====================================================================
  stopRequest() {
    Orchestrator.cancelled = true;
    window.avis.abortRequest();
    window.avis.offStreamChunk();  // stop listening for stream chunks
    this.showStopButton(false);

    // Remove typing indicator
    document.querySelectorAll('.typing-indicator').forEach(el => el.closest('.message')?.remove());

    // Finalize any active stream bubble
    if (this._streamBubble) {
      const cursor = this._streamBubble.querySelector('.stream-cursor');
      if (cursor) cursor.remove();
      this._streamBubble = null;
      this._streamRafPending = false;
    }

    // Update step panel
    if (this.activeStepPanel) {
      this.addStepToPanel('stopped', 'Stopped by user', 'error');
      this.finalizeStepPanel('Stopped by user');
    }

    this.isProcessing = false;
    document.getElementById('send-btn').disabled = false;
  },

  showStopButton(show) {
    const stopBtn = document.getElementById('stop-btn');
    const sendBtn = document.getElementById('send-btn');
    if (stopBtn) stopBtn.style.display = show ? 'inline-flex' : 'none';
    if (sendBtn) sendBtn.style.display = show ? 'none' : 'inline-flex';
  },

  // ====================================================================
  // Live Step Display — transparent thinking panel
  // ====================================================================
  createStepPanel() {
    const chatArea = document.getElementById('chat-area');
    const panel = document.createElement('div');
    panel.className = 'step-panel';
    panel.innerHTML = `
      <div class="step-panel-header">
        <span class="step-panel-title"><span class="step-spinner"></span> AVIS is working...</span>
        <span class="step-panel-timer" id="step-timer">0.0s</span>
      </div>
      <div class="step-panel-body" id="step-panel-body"></div>
    `;
    chatArea.appendChild(panel);
    this.animateStepsIn(panel);
    chatArea.scrollTop = chatArea.scrollHeight;

    this.activeStepPanel = panel;
    this.steps = {};

    // Start timer
    const timerEl = panel.querySelector('#step-timer');
    const start = Date.now();
    this._stepTimer = setInterval(() => {
      if (timerEl) timerEl.textContent = ((Date.now() - start) / 1000).toFixed(1) + 's';
    }, 100);

    return panel;
  },

  addStepToPanel(type, message, status = 'running') {
    if (!this.activeStepPanel) return;
    const body = this.activeStepPanel.querySelector('#step-panel-body');
    if (!body) return;

    const icons = { thinking: '\uD83E\uDDE0', route: '\uD83E\uDD16', search: '\uD83D\uDD0D', fetch: '\uD83C\uDF10', tool: '\u2699\uFE0F', read_file: '\uD83D\uDCC4', write_file: '\uD83D\uDCBE', run_code: '\u26A1', computer: '\uD83D\uDDA5\uFE0F', done: '\u2705', stopped: '\u26D4', warn: '\u26A0\uFE0F' };
    const statusIcons = { running: '\u21BB', done: '\u2713', error: '\u2717', warn: '\u26A0\uFE0F' };
    const statusColors = { running: 'var(--accent-blue)', done: 'var(--accent-green)', error: 'var(--accent-red)', warn: 'var(--accent-amber)' };

    const row = document.createElement('div');
    row.className = `step-row step-${status}`;
    row.innerHTML = `<span class="step-status-icon" style="color:${statusColors[status] || statusColors.running}">${statusIcons[status] || '\u21BB'}</span> <span class="step-icon">${icons[type] || '\u2699\uFE0F'}</span> <span class="step-message">${this.escapeHtml(message)}</span>`;
    body.appendChild(row);

    const chatArea = document.getElementById('chat-area');
    chatArea.scrollTop = chatArea.scrollHeight;
    return row;
  },

  updateStepRow(row, message, status) {
    if (!row) return;
    const statusIcons = { running: '\u21BB', done: '\u2713', error: '\u2717', warn: '\u26A0\uFE0F' };
    const statusColors = { running: 'var(--accent-blue)', done: 'var(--accent-green)', error: 'var(--accent-red)', warn: 'var(--accent-amber)' };
    row.className = `step-row step-${status}`;
    const iconEl = row.querySelector('.step-status-icon');
    const msgEl = row.querySelector('.step-message');
    if (iconEl) { iconEl.textContent = statusIcons[status] || '\u21BB'; iconEl.style.color = statusColors[status] || statusColors.running; }
    if (msgEl) msgEl.textContent = message;
  },

  finalizeStepPanel(summaryText) {
    if (this._stepTimer) { clearInterval(this._stepTimer); this._stepTimer = null; }
    if (!this.activeStepPanel) return;

    const header = this.activeStepPanel.querySelector('.step-panel-header');
    const title = this.activeStepPanel.querySelector('.step-panel-title');
    const body = this.activeStepPanel.querySelector('#step-panel-body');

    if (title) title.innerHTML = `\u2705 ${this.escapeHtml(summaryText)}`;

    // Make collapsible
    this.activeStepPanel.classList.add('step-panel-done');
    if (header) {
      header.style.cursor = 'pointer';
      header.onclick = () => { body.style.display = body.style.display === 'none' ? 'block' : 'none'; };
    }

    // Auto-collapse if setting says so
    if (body) body.style.display = 'none';
    this.activeStepPanel = null;
  },

  // Orchestrator calls this for every step
  handleStep(id, type, message, status) {
    this.addTerminalEntry(`[${status?.toUpperCase()}] ${message}`);

    if (!this.activeStepPanel && status === 'running') {
      this.createStepPanel();
    }

    // If updating an existing step (same id, type is null)
    if (!type && this.steps[id]) {
      this.updateStepRow(this.steps[id], message, status);
      return;
    }

    // New step
    const row = this.addStepToPanel(type || 'tool', message, status);
    if (row) this.steps[id] = row;

    // If done/error on a 'done' type, finalize panel
    if (type === 'done') {
      this.finalizeStepPanel(message);
    }
  },

  // Terminal log
  addTerminalEntry(text) {
    const timestamp = new Date().toLocaleTimeString();
    this.terminalLog.push(`[${timestamp}] ${text}`);
    const terminalEl = document.getElementById('terminal-output');
    if (terminalEl) {
      terminalEl.textContent = this.terminalLog.join('\n');
      terminalEl.scrollTop = terminalEl.scrollHeight;
    }
  },

  // FIX 1: Terminal copy/clear/export
  copyTerminal() {
    const text = this.terminalLog.join('\n');
    navigator.clipboard.writeText(text);
    this.showToast('Terminal copied to clipboard');
  },

  copyLastTask() {
    // Find last "Analyzing your request" entry and copy everything from there
    let startIdx = this.terminalLog.length;
    for (let i = this.terminalLog.length - 1; i >= 0; i--) {
      if (this.terminalLog[i].includes('Analyzing your request') || this.terminalLog[i].includes('RUNNING')) {
        startIdx = i;
        break;
      }
    }
    const text = this.terminalLog.slice(startIdx).join('\n');
    navigator.clipboard.writeText(text);
    this.showToast('Last task copied');
  },

  clearTerminal() {
    this.terminalLog = [];
    const el = document.getElementById('terminal-output');
    if (el) el.textContent = '';
    this.addTerminalEntry('Terminal cleared');
  },

  async exportTerminal() {
    const text = this.terminalLog.join('\n');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filePath = `${this._paths?.desktop || ''}/AVIS-Log-${timestamp}.txt`;
    try {
      await window.avis.toolWriteFile(filePath, text);
      this.showToast(`Exported: AVIS-Log-${timestamp}.txt`);
    } catch (e) {
      this.showToast('Export failed: ' + e.message);
    }
  },

  parseTestError(errMsg) {
    const msg = (errMsg || '').toLowerCase();
    if (msg.includes('401') || msg.includes('invalid') || msg.includes('auth')) return 'Invalid API key';
    if (msg.includes('429') || msg.includes('rate')) return 'Rate limited — try later';
    if (msg.includes('404') || msg.includes('not found')) return 'Wrong endpoint or model';
    if (msg.includes('402') || msg.includes('payment') || msg.includes('billing')) return 'Payment required';
    if (msg.includes('403') || msg.includes('forbidden')) return 'Access denied';
    if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('enotfound')) return 'Network error — check connection';
    return errMsg.substring(0, 60) || 'Unknown error';
  },

  // Copy text from any element
  copyText(el) {
    if (!el) return;
    // Get the text content, excluding the copy button itself
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.copy-prompt-btn, .provider-badge').forEach(b => b.remove());
    const text = clone.textContent.trim();
    navigator.clipboard.writeText(text);
    this.showToast('Copied to clipboard');
  },

  // Copy entire chat history as text
  copyChatHistory() {
    const messages = document.querySelectorAll('#chat-area .message');
    if (!messages.length) { this.showToast('No messages to copy'); return; }

    let text = '';
    messages.forEach(msg => {
      const isUser = msg.classList.contains('user');
      const bubble = msg.querySelector('.message-bubble');
      if (!bubble) return;
      const clone = bubble.cloneNode(true);
      clone.querySelectorAll('.copy-prompt-btn, .provider-badge, .code-copy-btn').forEach(b => b.remove());
      const content = clone.textContent.trim();
      if (content) text += `${isUser ? 'YOU' : 'AVIS'}: ${content}\n\n`;
    });

    navigator.clipboard.writeText(text.trim());
    this.showToast(`Chat copied (${messages.length} messages)`);
  },

  // Export conversation to markdown file
  // ====================================================================
  // Claude Code Panel
  // ====================================================================
  _ccRunning: false,
  _ccHistory: [],

  // Check and display Claude Code permission status
  async refreshClaudeCodeLock() {
    try {
      const status = await window.avis.claudeCodeCheckUnlock();
      const badge = document.getElementById('cc-lock-badge');
      const flagSelect = document.getElementById('cc-flags');
      const masterControls = document.getElementById('cc-master-controls');
      const unlockBtn = document.getElementById('cc-unlock-btn');

      if (badge) {
        if (status.unlocked) {
          badge.textContent = 'UNLOCKED';
          badge.style.background = 'rgba(0,255,136,0.15)';
          badge.style.color = 'var(--accent-green)';
        } else {
          badge.textContent = 'LOCKED';
          badge.style.background = 'rgba(255,51,51,0.15)';
          badge.style.color = 'var(--accent-red)';
          // Force safe mode selection for locked users
          if (flagSelect) flagSelect.value = '';
        }
      }

      // Disable the autonomy option for locked non-master users
      if (flagSelect && !status.unlocked && !status.isMaster) {
        const autoOption = flagSelect.querySelector('option[value="--dangerously-skip-permissions"]');
        if (autoOption) autoOption.disabled = true;
      }

      // Show master controls only for master license
      if (masterControls && status.isMaster) {
        masterControls.style.display = 'block';
        if (unlockBtn) {
          unlockBtn.textContent = status.unlocked ? 'Lock Safe Mode' : 'Unlock Full Autonomy';
          unlockBtn.style.borderColor = status.unlocked ? 'var(--accent-red)' : 'var(--accent-green)';
          unlockBtn.style.color = status.unlocked ? 'var(--accent-red)' : 'var(--accent-green)';
        }
      }
    } catch (e) {}
  },

  async toggleClaudeCodeUnlock() {
    const status = await window.avis.claudeCodeCheckUnlock();
    const result = await window.avis.claudeCodeSetUnlock(!status.unlocked);
    if (result.error) { this.showToast(result.error); return; }
    this.showToast(result.unlocked ? 'Claude Code: Full Autonomy UNLOCKED' : 'Claude Code: Locked to Safe Mode');
    this.refreshClaudeCodeLock();
  },

  async browseProjectFolder() {
    const result = await window.avis.openFolderDialog();
    if (result) {
      document.getElementById('cc-project-path').value = result;
    }
  },

  async runClaudeCode() {
    if (this._ccRunning) { this.showToast('Claude Code already running'); return; }

    const projectPath = document.getElementById('cc-project-path')?.value?.trim();
    const task = document.getElementById('cc-task-input')?.value?.trim();
    let flags = document.getElementById('cc-flags')?.value || '--dangerously-skip-permissions';

    // Check unlock status — main process will also enforce this, but update UI
    const unlockStatus = await window.avis.claudeCodeCheckUnlock();
    if (!unlockStatus.unlocked && flags.includes('--dangerously-skip-permissions')) {
      flags = ''; // force safe mode
    }

    if (!projectPath) { this.showToast('Set a project path first'); return; }
    if (!task) { this.showToast('Describe what Claude Code should do'); return; }

    this._ccRunning = true;
    const statusEl = document.getElementById('cc-status');
    const output = document.getElementById('cc-output');
    const runBtn = document.getElementById('cc-run-btn');

    if (statusEl) { statusEl.textContent = 'RUNNING'; statusEl.style.color = 'var(--accent-green)'; statusEl.style.background = 'rgba(0,255,136,0.1)'; }
    if (runBtn) runBtn.textContent = 'Running...';
    if (output) output.textContent = `$ claude ${flags} -p "${task}"\nProject: ${projectPath}\n\n`;

    // Track in Mission Control
    if (typeof MissionControl !== 'undefined') MissionControl.setAgentWorking('claude', 'Claude Code: ' + task.substring(0, 30));

    // Set up live streaming
    const chunkHandler = (chunk) => {
      if (output) {
        output.textContent += chunk;
        output.scrollTop = output.scrollHeight;
      }
    };
    window.avis.onClaudeCodeChunk(chunkHandler);

    try {
      const result = await window.avis.runClaudeCode({ task, projectPath, flags });

      if (result.error) {
        output.textContent += '\n\nSTDERR:\n' + result.error;
      }
      output.textContent += '\n\n' + (result.success ? '=== COMPLETED ===' : '=== FAILED (exit ' + result.exitCode + ') ===');

      // Save to history
      this._ccHistory.unshift({
        task,
        project: projectPath,
        time: new Date().toLocaleTimeString(),
        success: result.success
      });
      if (this._ccHistory.length > 10) this._ccHistory.pop();
      this.renderClaudeCodeHistory();

    } catch (err) {
      if (output) output.textContent += '\n\nError: ' + err.message;
    }

    // Cleanup
    window.avis.offStreamChunk && window.avis.offStreamChunk();
    if (typeof MissionControl !== 'undefined') MissionControl.setAgentIdle('claude');
    if (statusEl) { statusEl.textContent = 'IDLE'; statusEl.style.color = 'var(--text-secondary)'; statusEl.style.background = 'var(--bg-card)'; }
    if (runBtn) runBtn.textContent = 'Run';
    this._ccRunning = false;
    this.playNotificationSound();
  },

  copyClaudeCodeOutput() {
    const output = document.getElementById('cc-output');
    if (output) { navigator.clipboard.writeText(output.textContent); this.showToast('Output copied'); }
  },

  clearClaudeCodeOutput() {
    const output = document.getElementById('cc-output');
    if (output) output.textContent = 'Ready. Set a project path and describe your task.';
  },

  sendClaudeCodeToChat() {
    const output = document.getElementById('cc-output');
    if (!output || !output.textContent.trim()) return;
    this.addMessageToChat('ai', '**Claude Code Output:**\n```\n' + output.textContent.substring(0, 5000) + '\n```', 'claude', 'Claude Code');
  },

  renderClaudeCodeHistory() {
    const container = document.getElementById('cc-history');
    if (!container) return;
    if (this._ccHistory.length === 0) { container.textContent = 'No tasks yet'; return; }
    container.innerHTML = this._ccHistory.map(h =>
      '<div style="padding:4px 8px;background:var(--bg-panel);border-radius:4px;margin-bottom:4px;display:flex;gap:8px;align-items:center;">' +
        '<span style="color:' + (h.success ? 'var(--accent-green)' : 'var(--accent-red)') + ';">' + (h.success ? '\u2713' : '\u2717') + '</span>' +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + h.task + '">' + h.task.substring(0, 40) + '</span>' +
        '<span style="color:#445566;font-size:9px;">' + h.time + '</span>' +
      '</div>'
    ).join('');
  },

  // ====================================================================
  // Workflow Builder
  // ====================================================================
  async runWorkflow() {
    const output = document.getElementById('wf-output');
    if (!output) return;
    output.style.display = 'block';
    output.textContent = 'Starting workflow...\n';

    const steps = [];
    for (let i = 1; i <= 3; i++) {
      const provider = document.getElementById(`wf-provider-${i}`)?.value;
      const prompt = document.getElementById(`wf-prompt-${i}`)?.value?.trim();
      if (provider && prompt) steps.push({ provider, prompt });
    }

    if (steps.length === 0) { output.textContent = 'Add at least one step with a prompt.'; return; }

    let previousOutput = '';

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepNum = i + 1;
      const fullPrompt = previousOutput
        ? `${step.prompt}\n\nContext from previous step:\n${previousOutput}`
        : step.prompt;

      output.textContent += `\n--- Step ${stepNum}: ${step.provider.toUpperCase()} ---\n`;
      output.textContent += `Prompt: ${step.prompt.substring(0, 80)}...\n`;
      output.textContent += 'Working...\n';

      try {
        if (typeof MissionControl !== 'undefined') MissionControl.setAgentWorking(step.provider, step.prompt.substring(0, 40));

        const result = await Orchestrator.callProvider(step.provider, fullPrompt);

        if (typeof MissionControl !== 'undefined') MissionControl.setAgentIdle(step.provider);

        previousOutput = result || '';
        output.textContent += previousOutput.substring(0, 2000) + '\n';
      } catch (err) {
        if (typeof MissionControl !== 'undefined') MissionControl.setAgentIdle(step.provider);
        output.textContent += `Error: ${err.message}\n`;
        break;
      }
    }

    output.textContent += '\n=== WORKFLOW COMPLETE ===\n';

    // Also add final result to chat
    if (previousOutput) {
      this.addMessageToChat('ai', `**Workflow Result (${steps.length} steps):**\n\n${previousOutput}`, steps[steps.length - 1].provider, 'workflow');
    }
  },

  // Context window indicator
  updateContextIndicator() {
    const conv = MemoryManager.currentConversation;
    if (!conv) return;
    const totalChars = conv.messages.reduce((sum, m) => sum + (m.content || '').length, 0);
    // Rough token estimate: ~4 chars per token, Claude context ~200k tokens
    const estimatedTokens = Math.round(totalChars / 4);
    const maxTokens = 200000;
    const pct = Math.min(100, Math.round((estimatedTokens / maxTokens) * 100));

    const indicator = document.getElementById('context-indicator');
    const fill = document.getElementById('context-fill');
    const label = document.getElementById('context-pct');
    if (!indicator || !fill || !label) return;

    indicator.style.display = pct > 5 ? 'flex' : 'none';
    fill.style.width = pct + '%';
    fill.className = 'context-fill ' + (pct < 50 ? 'low' : pct < 80 ? 'medium' : 'high');
    label.textContent = pct + '%';

    if (pct >= 80) {
      label.textContent = pct + '% (consider New Chat)';
    }
  },

  async exportConversation() {
    const conv = MemoryManager.currentConversation;
    if (!conv || conv.messages.length === 0) { this.showToast('No conversation to export'); return; }

    const title = conv.title || 'AVIS Conversation';
    const date = new Date().toISOString().slice(0, 10);
    let md = `# ${title}\n**Date:** ${date}\n**Messages:** ${conv.messages.length}\n\n---\n\n`;

    for (const msg of conv.messages) {
      const role = msg.role === 'user' ? 'You' : `AVIS (${msg.provider || 'claude'} / ${msg.model || ''})`;
      const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '';
      md += `### ${role}${time ? ' \u2014 ' + time : ''}\n\n${msg.content}\n\n---\n\n`;
    }

    md += `\n*Exported from AVIS v${await window.avis.getAppVersion()} by Avel Productions LLC*\n`;

    // Save to Desktop
    const paths = await window.avis.getPaths();
    const filename = `AVIS-Chat-${date}-${Date.now().toString(36)}.md`;
    const savePath = `${paths.desktop}/${filename}`;
    await window.avis.toolWriteFile(savePath, md);
    this.showToast(`Exported: ${filename}`);
  },

  startClock() {
    const update = () => {
      const el = document.getElementById('live-clock');
      if (!el) return;
      const now = new Date();
      const date = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      el.innerHTML = `<span class="clock-date">${date}</span><span class="clock-time">${time}</span>`;
    };
    update();
    setInterval(update, 15000);
  },

  // Chrome extension status polling
  async updateChromeStatus() {
    try {
      const connected = await window.avis.chromeIsConnected();
      const dot = document.getElementById('chrome-dot');
      const badge = document.getElementById('chrome-badge');
      if (!dot || !badge) return;
      if (connected) {
        dot.className = 'chrome-dot connected';
        badge.textContent = 'CONNECTED';
        badge.className = 'chrome-badge connected';
      } else {
        dot.className = 'chrome-dot';
        badge.textContent = 'DISCONNECTED';
        badge.className = 'chrome-badge';
      }
    } catch (e) {}
  },

  setBrowserWorking(isWorking) {
    const dot = document.getElementById('chrome-dot');
    if (dot) dot.className = isWorking ? 'chrome-dot working' : 'chrome-dot connected';
  },

  manualUpdateCheck() {
    const btn = document.getElementById('btn-check-update');
    if (btn) { btn.textContent = '\u21BB Checking...'; btn.disabled = true; }
    window.avis.checkForUpdates();
    // Reset button after 8s (update-status handler will show result in the update bar)
    setTimeout(() => { if (btn) { btn.textContent = '\u21BB Check for Updates'; btn.disabled = false; } }, 8000);
  },

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'avis-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  },

  // Trigger theme-aware glow on input wrap when sending
  _triggerSendGlow(mode) {
    const wrapId = mode === 'council' ? 'council-input-wrap' : null;
    const wrap = wrapId ? document.getElementById(wrapId) : document.querySelector('#chat-center .input-wrap');
    const btn = mode === 'council' ? document.getElementById('council-send-btn') : document.getElementById('send-btn');

    if (wrap) {
      wrap.classList.remove('glow-active');
      void wrap.offsetWidth; // force reflow to restart animation
      wrap.classList.add('glow-active');
      setTimeout(() => wrap.classList.remove('glow-active'), 1300);
    }
    if (btn) {
      btn.classList.remove('glow-pulse');
      void btn.offsetWidth;
      btn.classList.add('glow-pulse');
      setTimeout(() => btn.classList.remove('glow-pulse'), 500);
    }
  },

  // ====================================================================
  // CLIENT MODE — enter/exit client experience
  // ====================================================================
  async enterClientMode(clientCode) {
    if (!clientCode) return;
    await ClientManager.setActiveClient(clientCode);
    const profile = await ClientManager.getProfile(clientCode);
    if (!profile) { this.showToast('Client not found', 'error'); return; }

    this._clientModeActive = true;
    this._operatorState = {
      title: document.title,
      titleText: document.getElementById('app-title')?.textContent
    };

    // Hide operator chrome
    document.body.classList.add('client-mode');

    // Update title
    document.title = `${profile.display_name}'s Coach`;
    const titleEl = document.getElementById('app-title');
    if (titleEl) titleEl.textContent = `${profile.display_name}'s Coach`;

    // Hide operator tabs
    const titleCenter = document.querySelector('.titlebar-center');
    if (titleCenter) titleCenter.style.display = 'none';

    // Hide left panel
    const leftPanel = document.querySelector('.left-panel');
    if (leftPanel) leftPanel.style.display = 'none';

    // Apply theme
    if (typeof ThemeManager !== 'undefined' && profile.theme) {
      ThemeManager.applyTheme(profile.theme);
    }

    // Show client mode UI
    this.renderClientUI(profile);

    // Load last conversation session (will auto-continue or start fresh)
    const convLog = await ClientManager.getConversationLog(clientCode);
    const sessions = ClientManager.getSessions(convLog);
    const chatArea = document.getElementById('chat-area');
    if (chatArea) {
      chatArea.innerHTML = '';
      if (sessions.length > 0) {
        // Resume the most recent session
        const latest = sessions[0];
        ClientManager.setActiveSessionId(latest.id);
        for (const msg of latest.messages) {
          this.addMessageToChat(msg.role === 'user' ? 'user' : 'ai', msg.text, 'claude', 'Coach');
        }
        // Rebuild Orchestrator conversation history
        if (typeof Orchestrator !== 'undefined') {
          Orchestrator.conversationHistory = latest.messages.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.text
          }));
        }
      } else {
        ClientManager.startNewSession();
      }
    }
    // Mark chat as loaded so tab switching doesn't reload
    this._coachChatLoaded = true;

    // Check for pending recommendations
    const pending = await ClientManager.getRecommendations(clientCode, 'pending');
    if (pending.length > 0) {
      this.showClientNotification(`💌 ${pending.length} new from Coach`, pending);
    }

    // Clean up operator artifacts from chat input
    const chatInput = document.getElementById('chat-input');
    if (chatInput) chatInput.placeholder = 'Ask your coach anything...';
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) sendBtn.textContent = '💕';

    // Restore persisted settings (dark mode, sound, notifications)
    this.restoreClientSettings();

    // Welcome flow for first-time
    if (!profile.welcome_completed) {
      this.showWelcomeFlow(profile);
    }

    this.showToast(`Client mode: ${profile.display_name}`, 'success');
  },

  async exitClientMode(password) {
    const correctPassword = await window.avis.storeGet('operatorPassword', 'avis2026');
    if (password !== correctPassword) {
      this.showToast('Incorrect password', 'error');
      return false;
    }

    this._clientModeActive = false;
    await ClientManager.setActiveClient(null);
    await window.avis.storeSet('bootMode', 'operator');

    // Restore operator chrome
    document.body.classList.remove('client-mode');

    // Restore title
    document.title = this._operatorState?.title || 'AVIS - Avel Intelligence Services';
    const titleEl = document.getElementById('app-title');
    if (titleEl) titleEl.textContent = this._operatorState?.titleText || 'AVIS';

    // Show operator tabs
    const titleCenter = document.querySelector('.titlebar-center');
    if (titleCenter) titleCenter.style.display = '';

    // Show left panel
    const leftPanel = document.querySelector('.left-panel');
    if (leftPanel) leftPanel.style.display = '';

    // Reset main layout
    const mainLayout = document.querySelector('.main-layout');
    if (mainLayout) mainLayout.style.cssText = '';

    // Remove client UI
    const clientUI = document.getElementById('client-mode-container');
    if (clientUI) clientUI.remove();

    // Reset theme
    if (typeof ThemeManager !== 'undefined') {
      ThemeManager.resetTheme();
    }
    document.body.style.backgroundImage = '';

    // Hide client elements
    const clientNav = document.getElementById('client-nav');
    if (clientNav) clientNav.style.display = '';
    const clientFab = document.getElementById('client-fab');
    if (clientFab) clientFab.style.display = '';

    // Restore operator chat input
    const chatInput = document.getElementById('chat-input');
    if (chatInput) chatInput.placeholder = 'Type your message... (search, navigate, run code, open files)';
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) sendBtn.textContent = 'SEND';

    // Clear chat and reload operator view
    const chatArea = document.getElementById('chat-area');
    if (chatArea) chatArea.innerHTML = '';

    // Boot into operator mode
    await this._operatorBoot();

    this.showToast('Operator mode restored', 'success');
    return true;
  },

  // ================================================================
  // PREVIEW MODE — reskin AVIS as client, keep dev menu
  // ================================================================
  _previewModeCode: null,
  _previewSavedState: null,

  async enterPreviewMode(clientCode) {
    const profile = await ClientManager.getProfile(clientCode);
    if (!profile) { this.showToast('Client not found', 'error'); return; }

    this._previewModeCode = clientCode;

    // Save current state
    this._previewSavedState = {
      title: document.title,
      titleText: document.getElementById('app-title')?.textContent,
      bodyBg: document.body.style.backgroundImage
    };

    // Apply client theme to AVIS
    if (typeof ThemeManager !== 'undefined' && profile.theme) {
      ThemeManager.applyTheme(profile.theme);
      const bgCSS = ThemeManager.getBackgroundCSS(profile.theme);
      if (bgCSS) document.body.style.backgroundImage = bgCSS;
    }

    // Apply client-mode class for themed styling but keep nav visible
    document.body.classList.add('client-mode');

    // Override: show titlebar tabs again (client-mode CSS hides them)
    const titleCenter = document.querySelector('.titlebar-center');
    if (titleCenter) titleCenter.style.cssText = 'display:flex !important;';

    // Override: show left panel (client-mode CSS hides it)
    const leftPanel = document.querySelector('.left-panel');
    if (leftPanel) leftPanel.style.cssText = 'display:block !important;';

    // Override: remove max-width constraint on main layout
    const mainLayout = document.querySelector('.main-layout');
    if (mainLayout) mainLayout.style.cssText = 'max-width:none !important; grid-template-columns: 260px 1fr !important;';

    // Update title
    document.title = `Preview: ${profile.display_name}'s Coach`;
    const titleEl = document.getElementById('app-title');
    if (titleEl) titleEl.textContent = `${profile.display_name}'s Coach`;

    // Hide client-only elements that shouldn't show in preview
    const clientNav = document.getElementById('client-nav');
    if (clientNav) clientNav.style.display = 'none';
    const clientFab = document.getElementById('client-fab');
    if (clientFab) clientFab.style.display = 'none';
    const clientHeader = document.getElementById('client-header');
    if (clientHeader) clientHeader.style.display = 'none';

    // Show a preview banner at top of chat
    const chatArea = document.getElementById('chat-area');
    if (chatArea) {
      const banner = document.createElement('div');
      banner.id = 'preview-banner';
      banner.style.cssText = `padding:10px 16px;background:${profile.theme?.color_primary || '#ff69b4'};color:#fff;font-size:12px;font-weight:600;text-align:center;border-radius:12px;margin:8px;`;
      banner.innerHTML = `Previewing as ${profile.display_name} (${clientCode}) — <a href="#" onclick="AVIS.exitPreviewMode();return false;" style="color:#fff;text-decoration:underline;">Exit Preview</a>`;
      chatArea.prepend(banner);
    }

    this.showToast(`Preview: ${profile.display_name}'s theme applied`, 'success');

    // Refresh cockpit detail if open
    if (this._cockpitDetailCode === clientCode) {
      this.switchCockpitTab('preview');
    }
  },

  exitPreviewMode() {
    if (!this._previewModeCode) return;

    // Remove client-mode class
    document.body.classList.remove('client-mode');

    // Reset theme
    if (typeof ThemeManager !== 'undefined') ThemeManager.resetTheme();

    // Restore overrides
    const titleCenter = document.querySelector('.titlebar-center');
    if (titleCenter) titleCenter.style.cssText = '';
    const leftPanel = document.querySelector('.left-panel');
    if (leftPanel) leftPanel.style.cssText = '';
    const mainLayout = document.querySelector('.main-layout');
    if (mainLayout) mainLayout.style.cssText = '';

    // Restore title
    document.title = this._previewSavedState?.title || 'AVIS - Avel Intelligence Services';
    const titleEl = document.getElementById('app-title');
    if (titleEl) titleEl.textContent = this._previewSavedState?.titleText || 'AVIS';

    // Restore background
    document.body.style.backgroundImage = this._previewSavedState?.bodyBg || '';

    // Remove preview banner
    const banner = document.getElementById('preview-banner');
    if (banner) banner.remove();

    // Hide client elements
    const clientNav = document.getElementById('client-nav');
    if (clientNav) clientNav.style.display = '';
    const clientFab = document.getElementById('client-fab');
    if (clientFab) clientFab.style.display = '';

    const prevCode = this._previewModeCode;
    this._previewModeCode = null;
    this._previewSavedState = null;

    this.showToast('Preview ended — operator theme restored', 'success');

    // Refresh cockpit if open
    if (this._cockpitDetailCode === prevCode) {
      this.switchCockpitTab('preview');
    }
  },

  renderClientUI(profile) {
    // Apply theme
    if (typeof ThemeManager !== 'undefined' && profile.theme) {
      ThemeManager.applyTheme(profile.theme);
      // Set background pattern
      const bgCSS = ThemeManager.getBackgroundCSS(profile.theme);
      if (bgCSS) document.body.style.backgroundImage = bgCSS;
    }

    // Set mascot
    const mascotEl = document.getElementById('client-mascot');
    if (mascotEl && typeof ThemeManager !== 'undefined') {
      mascotEl.innerHTML = ThemeManager.getMascotSVG(profile.theme);
      // Short click → open recommendations, long-press 5s → operator escape
      let pressTimer = null;
      let isLongPress = false;
      mascotEl.addEventListener('mousedown', () => {
        isLongPress = false;
        pressTimer = setTimeout(() => {
          isLongPress = true;
          document.getElementById('operator-escape-modal').classList.add('active');
          document.getElementById('operator-escape-password').focus();
        }, 5000);
      });
      mascotEl.addEventListener('mouseup', () => {
        clearTimeout(pressTimer);
        if (!isLongPress) this.openRecommendations();
      });
      mascotEl.addEventListener('mouseleave', () => clearTimeout(pressTimer));
    }

    // Render category grid in spending modal
    this.renderCategoryGrid(profile.theme);

    // Update dashboard with live data
    this.refreshClientDashboard();

    // Generate greeting
    this.generateClientGreeting(profile);

    // Default to dashboard view
    this.clientSwitchView('dashboard');
  },

  async refreshClientDashboard() {
    if (!ClientManager.isClientMode()) return;

    // Check recommendation badges
    this.checkRecommendationBadge();

    const finances = await ClientManager.getFinances();
    const monthSpending = await ClientManager.getMonthSpending();
    const remaining = await ClientManager.getRemainingBudget();

    if (!finances) return;

    // This Month card
    const totalBudget = Object.values(finances.monthly_budget).reduce((s, v) => s + v, 0);
    document.getElementById('client-month-spent').textContent = `$${monthSpending.total.toFixed(2)}`;
    document.getElementById('client-month-budget').textContent = `/ $${totalBudget.toFixed(0)} budget`;
    const remTotal = remaining?._total?.remaining || 0;
    const now = new Date();
    const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
    document.getElementById('client-month-remaining').textContent =
      remTotal >= 0 ? `$${remTotal.toFixed(2)} left for ${daysLeft} days` : `$${Math.abs(remTotal).toFixed(2)} over budget`;
    const barPct = totalBudget > 0 ? Math.min(100, (monthSpending.total / totalBudget) * 100) : 0;
    document.getElementById('client-budget-bar').style.width = `${barPct}%`;
    if (barPct > 100) document.getElementById('client-budget-bar').classList.add('over');

    // Savings card
    const savings = finances.accounts.find(a => a.purpose === 'house_savings');
    if (savings) {
      document.getElementById('client-savings-detail').textContent = `$${savings.balance.toFixed(0)} / $${savings.target_balance.toLocaleString()}`;
      const savPct = (savings.balance / savings.target_balance) * 100;
      document.getElementById('client-savings-bar').style.width = `${savPct}%`;
      document.getElementById('client-savings-remaining').textContent = `$${(savings.target_balance - savings.balance).toLocaleString()} to go ✨`;
    }

    // All debts
    this.renderDebtsCards(finances);

    // Credit score
    document.getElementById('client-score-detail').textContent = `${finances.credit_score} → ${finances.credit_score_target}`;

    // Weekly progress graph
    this.renderWeeklyProgressGraph();

    // Streak tracker
    this.renderStreakTracker();

    // Savings house visualizer
    this.renderHouseVisualizer(finances);

    // Partner goals
    this.renderPartnerGoals(finances);

    // Payday check
    this.checkPayday();

    // Monthly milestone check
    this.checkMonthlyMilestone();

    // Spending breakdown by category
    this.renderSpendingBreakdown(finances, monthSpending, remaining);

    // Recent activity
    this.renderRecentActivity();
  },

  async renderWeeklyProgressGraph() {
    const graphEl = document.getElementById('client-weekly-graph');
    if (!graphEl) return;

    const log = await ClientManager.getSpendingLog();
    const finances = await ClientManager.getFinances();
    const theme = ThemeManager?.getTheme();
    const primary = theme?.color_primary || '#ff69b4';
    const accent = theme?.color_accent || '#ff1493';
    const success = theme?.color_success || '#ff77aa';

    // Calculate weekly spending for last 4 weeks
    const weeks = [];
    const totalBudget = finances ? Object.values(finances.monthly_budget).reduce((s, v) => s + v, 0) : 0;
    const weeklyBudget = totalBudget / 4;

    for (let w = 3; w >= 0; w--) {
      const start = new Date(); start.setDate(start.getDate() - (w + 1) * 7);
      const end = new Date(); end.setDate(end.getDate() - w * 7);
      const startStr = start.toISOString().split('T')[0];
      const endStr = end.toISOString().split('T')[0];
      const total = log.entries.filter(e => e.date >= startStr && e.date < endStr).reduce((s, e) => s + e.amount, 0);
      const underBudget = total <= weeklyBudget;
      weeks.push({ label: w === 0 ? 'This Week' : `${w}w ago`, total, underBudget });
    }

    const max = Math.max(...weeks.map(w => w.total), weeklyBudget, 1);

    graphEl.innerHTML = `
      <div style="display:flex;align-items:flex-end;gap:16px;height:100px;padding:8px 0;">
        ${weeks.map(w => `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;">
            <div style="font-size:10px;font-weight:700;margin-bottom:4px;color:${w.underBudget ? success : 'var(--client-danger, #dc143c)'};">
              ${w.total > 0 ? '$' + w.total.toFixed(0) : '-'}
            </div>
            <div style="width:100%;background:${w.underBudget ? `linear-gradient(180deg,${primary},${accent})` : 'var(--client-danger, #dc143c)'};border-radius:10px 10px 0 0;height:${Math.max(6, (w.total / max) * 80)}px;transition:height 0.4s ease;"></div>
            <div style="font-size:9px;color:var(--client-text-secondary);margin-top:4px;font-weight:600;">${w.label}</div>
          </div>
        `).join('')}
      </div>
      ${weeklyBudget > 0 ? `<div style="text-align:center;font-size:10px;color:var(--client-text-secondary);margin-top:4px;">Weekly target: $${weeklyBudget.toFixed(0)}</div>` : ''}
    `;
  },

  // ================================================================
  // ALL DEBTS — dynamic rendering + add/remove
  // ================================================================
  renderDebtsCards(finances) {
    const listEl = document.getElementById('client-debts-list');
    if (!listEl || !finances) return;

    if (!finances.debts || finances.debts.length === 0) {
      listEl.innerHTML = '<div class="client-empty" style="padding:12px;"><p>No debts — you\'re debt free! 🎉</p></div>';
      return;
    }

    const icons = { credit_card: '💳', personal_loan: '📋', car_loan: '🚗', student_loan: '🎓' };

    listEl.innerHTML = finances.debts.map((debt, i) => {
      const icon = icons[debt.id] || '💰';
      const startBalance = debt.start_balance || debt.balance * 1.5; // estimate if not tracked
      const paidPct = Math.max(0, Math.min(100, ((startBalance - debt.balance) / startBalance) * 100));
      const monthsLeft = debt.minimum_payment > 0 ? Math.ceil(debt.balance / (debt.attack_amount || debt.minimum_payment)) : 0;

      return `
        <div class="client-goal-card" style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--client-secondary,#fce7f3);">
          <div class="client-goal-icon">${icon}</div>
          <div class="client-goal-info" style="flex:1;">
            <div class="client-goal-name">${debt.name}</div>
            <div class="client-goal-detail">$${debt.balance.toFixed(2)} left · $${(debt.attack_amount || debt.minimum_payment).toFixed(2)}/mo</div>
            <div class="client-progress-bar">
              <div class="client-progress-fill" style="width:${paidPct}%"></div>
            </div>
            <div class="client-card-sub">${monthsLeft > 0 ? `~${monthsLeft} months to go` : ''} ${debt.status === 'auto_grinding' ? '(auto-pay)' : ''}</div>
          </div>
          <button onclick="AVIS.removeDebt(${i})" style="background:none;border:none;color:var(--client-text-secondary);cursor:pointer;font-size:16px;padding:4px;flex-shrink:0;" title="Remove">🗑️</button>
        </div>
      `;
    }).join('');
  },

  showAddDebtForm() {
    const form = document.getElementById('client-add-debt-form');
    if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
  },

  async addDebt() {
    const name = document.getElementById('new-debt-name')?.value.trim();
    const balance = parseFloat(document.getElementById('new-debt-balance')?.value);
    const payment = parseFloat(document.getElementById('new-debt-payment')?.value);
    if (!name || !balance || balance <= 0 || !payment || payment <= 0) {
      this.showToast('Fill in all fields'); return;
    }

    const finances = await ClientManager.getFinances();
    if (!finances) return;
    if (!finances.debts) finances.debts = [];

    const id = name.toLowerCase().replace(/\s+/g, '_');
    finances.debts.push({
      id,
      name,
      balance,
      start_balance: balance,
      minimum_payment: payment,
      status: 'active',
      target_payoff_date: ''
    });

    await ClientManager.updateFinances(null, { debts: finances.debts });

    // Clear form
    document.getElementById('new-debt-name').value = '';
    document.getElementById('new-debt-balance').value = '';
    document.getElementById('new-debt-payment').value = '';
    document.getElementById('client-add-debt-form').style.display = 'none';

    this.refreshClientDashboard();
    this.showToast(`${name} added 💕`);
  },

  async removeDebt(index) {
    const finances = await ClientManager.getFinances();
    if (!finances || !finances.debts) return;
    const name = finances.debts[index]?.name || 'Debt';
    finances.debts.splice(index, 1);
    await ClientManager.updateFinances(null, { debts: finances.debts });
    this.refreshClientDashboard();
    this.showToast(`${name} removed`);
  },

  // ================================================================
  // FEATURE 1: STREAK TRACKER
  // ================================================================
  async renderStreakTracker() {
    const card = document.getElementById('client-streak-card');
    if (!card) return;

    const log = await ClientManager.getSpendingLog();
    if (log.entries.length === 0) { card.style.display = 'none'; return; }

    // Count consecutive days with logging (going backwards from today)
    const today = new Date();
    let streak = 0;
    for (let d = 0; d < 365; d++) {
      const checkDate = new Date(today);
      checkDate.setDate(today.getDate() - d);
      const dateStr = checkDate.toISOString().split('T')[0];
      const hasEntry = log.entries.some(e => e.date === dateStr);
      if (hasEntry) { streak++; } else if (d > 0) { break; } // allow today to not have entry yet
    }

    if (streak > 0) {
      card.style.display = 'block';
      document.getElementById('streak-count').textContent = `${streak} day streak`;
      const fireEl = document.getElementById('streak-fire');
      const subEl = document.getElementById('streak-sub');
      if (streak >= 7) {
        fireEl.textContent = '🔥🔥🔥';
        subEl.textContent = 'You\'re on FIRE! Keep it up queen! 💅';
      } else if (streak >= 3) {
        fireEl.textContent = '🔥🔥';
        subEl.textContent = 'Building that habit! 💕';
      } else {
        fireEl.textContent = '🔥';
        subEl.textContent = 'Keep logging to build your streak!';
      }
    } else {
      card.style.display = 'none';
    }
  },

  // ================================================================
  // FEATURE 2: SAVINGS HOUSE VISUALIZER
  // ================================================================
  renderHouseVisualizer(finances) {
    const el = document.getElementById('client-house-visual');
    const subEl = document.getElementById('client-house-sub');
    if (!el || !finances) return;

    const savings = finances.accounts.find(a => a.purpose === 'house_savings');
    if (!savings) return;

    const pct = Math.min(100, (savings.balance / savings.target_balance) * 100);
    const primary = ThemeManager?.getTheme()?.color_primary || '#ff69b4';
    const accent = ThemeManager?.getTheme()?.color_accent || '#ff1493';
    const secondary = ThemeManager?.getTheme()?.color_secondary || '#ffb6d5';

    // SVG house that builds progressively
    const showFoundation = pct >= 5;
    const showWalls = pct >= 25;
    const showWindows = pct >= 50;
    const showRoof = pct >= 75;
    const showChimney = pct >= 90;
    const complete = pct >= 100;

    el.innerHTML = `
      <svg viewBox="0 0 200 160" width="180" height="140" style="margin:0 auto;display:block;">
        <!-- Ground -->
        <rect x="20" y="135" width="160" height="8" rx="4" fill="${secondary}" opacity="0.5"/>

        <!-- Foundation -->
        <rect x="40" y="120" width="120" height="18" rx="3" fill="${showFoundation ? primary : secondary}" opacity="${showFoundation ? 1 : 0.2}"
          style="transition:all 0.6s ease;"/>

        <!-- Walls -->
        <rect x="45" y="60" width="110" height="62" rx="2" fill="${showWalls ? accent : secondary}" opacity="${showWalls ? 0.85 : 0.15}"
          style="transition:all 0.6s ease;"/>

        <!-- Door -->
        ${showWalls ? `<rect x="85" y="88" width="30" height="34" rx="15 15 0 0" fill="${primary}" opacity="0.9"/>` : ''}

        <!-- Windows -->
        ${showWindows ? `
          <rect x="55" y="72" width="22" height="22" rx="3" fill="#fff" opacity="0.85"/>
          <rect x="123" y="72" width="22" height="22" rx="3" fill="#fff" opacity="0.85"/>
          <line x1="66" y1="72" x2="66" y2="94" stroke="${accent}" stroke-width="1.5" opacity="0.4"/>
          <line x1="55" y1="83" x2="77" y2="83" stroke="${accent}" stroke-width="1.5" opacity="0.4"/>
          <line x1="134" y1="72" x2="134" y2="94" stroke="${accent}" stroke-width="1.5" opacity="0.4"/>
          <line x1="123" y1="83" x2="145" y2="83" stroke="${accent}" stroke-width="1.5" opacity="0.4"/>
        ` : ''}

        <!-- Roof -->
        <polygon points="30,62 100,15 170,62" fill="${showRoof ? primary : secondary}" opacity="${showRoof ? 1 : 0.15}"
          style="transition:all 0.6s ease;"/>

        <!-- Chimney -->
        ${showChimney ? `<rect x="130" y="20" width="16" height="30" rx="2" fill="${accent}"/>` : ''}

        <!-- Heart on complete -->
        ${complete ? `<text x="100" y="50" text-anchor="middle" font-size="20">💕</text>` : ''}

        <!-- Progress label -->
        <text x="100" y="155" text-anchor="middle" font-size="10" fill="${primary}" font-weight="700">${pct.toFixed(0)}%</text>
      </svg>
    `;

    subEl.textContent = complete ? 'You did it!! 🎉🏠💕' : `$${savings.balance.toFixed(0)} / $${savings.target_balance.toLocaleString()} saved`;
  },

  // ================================================================
  // FEATURE 3: CAN I AFFORD THIS? CALCULATOR
  // ================================================================
  _affordAmount: '',

  openAffordCalculator() {
    this._affordAmount = '';
    document.getElementById('afford-amount-display').textContent = '0.00';
    document.getElementById('afford-result').style.display = 'none';
    document.getElementById('client-afford-modal').classList.add('active');
  },

  affordNumpad(key) {
    if (key === 'del') {
      this._affordAmount = this._affordAmount.slice(0, -1);
    } else if (key === '.' && this._affordAmount.includes('.')) {
      return;
    } else {
      this._affordAmount += key;
    }
    const val = parseFloat(this._affordAmount) || 0;
    document.getElementById('afford-amount-display').textContent = val.toFixed(2);
  },

  async checkAffordability() {
    const amount = parseFloat(this._affordAmount) || 0;
    if (amount <= 0) return;

    const category = document.getElementById('afford-category').value;
    const remaining = await ClientManager.getRemainingBudget();
    const resultEl = document.getElementById('afford-result');
    if (!remaining || !resultEl) return;

    const catBudget = remaining[category];
    const totalBudget = remaining._total;
    const catName = this._formatCategoryName(category);
    const theme = ThemeManager?.getTheme();

    let verdict, color, emoji;
    if (catBudget && amount <= catBudget.remaining) {
      verdict = `Yes! You have $${catBudget.remaining.toFixed(2)} left in ${catName}. Go for it!`;
      color = theme?.color_success || '#ff77aa';
      emoji = '✅';
    } else if (catBudget && amount <= catBudget.remaining + 20) {
      verdict = `It's tight — you'd have only $${(catBudget.remaining - amount).toFixed(2)} left in ${catName}. Maybe wait a few days?`;
      color = theme?.color_warning || '#ffa500';
      emoji = '🤔';
    } else {
      const over = catBudget ? Math.abs(catBudget.remaining - amount).toFixed(2) : amount.toFixed(2);
      verdict = `That would put you $${over} over your ${catName} budget. Skip it this time babe — your goals are worth it! 💪`;
      color = theme?.color_danger || '#dc143c';
      emoji = '❌';
    }

    resultEl.style.display = 'block';
    resultEl.innerHTML = `
      <div style="background:${color}15;border:1.5px solid ${color};border-radius:14px;padding:14px;text-align:center;">
        <div style="font-size:24px;margin-bottom:6px;">${emoji}</div>
        <div style="font-size:13px;font-weight:600;color:var(--client-text);line-height:1.5;">${verdict}</div>
      </div>
    `;
  },

  // ================================================================
  // FEATURE 4: PAYDAY AUTO-PROMPT
  // ================================================================
  async checkPayday() {
    const banner = document.getElementById('client-payday-banner');
    if (!banner) return;

    const profile = await ClientManager.getProfile();
    if (!profile) return;

    // Check if dismissed today
    const dismissKey = `payday_dismissed_${new Date().toISOString().split('T')[0]}`;
    const dismissed = await window.avis.storeGet(dismissKey, false);
    if (dismissed) { banner.style.display = 'none'; return; }

    // Biweekly pay — show banner 1 day before and on payday
    // Approximate: 1st and 15th of each month
    const today = new Date().getDate();
    const isNearPayday = (today >= 14 && today <= 15) || (today >= 28 || today <= 1);

    if (isNearPayday) {
      banner.style.display = 'block';
      const title = document.getElementById('payday-title');
      const sub = document.getElementById('payday-sub');
      if (today === 15 || today === 1) {
        title.textContent = 'It\'s payday! 💰';
        sub.textContent = 'Let\'s set aside savings before spending!';
      } else {
        title.textContent = 'Payday\'s tomorrow! 💰';
        sub.textContent = 'Want to plan your paycheck allocation?';
      }
    } else {
      banner.style.display = 'none';
    }
  },

  async dismissPayday() {
    const dismissKey = `payday_dismissed_${new Date().toISOString().split('T')[0]}`;
    await window.avis.storeSet(dismissKey, true);
    document.getElementById('client-payday-banner').style.display = 'none';
  },

  // ================================================================
  // FEATURE 5: MONTHLY MILESTONE CARD
  // ================================================================
  async checkMonthlyMilestone() {
    const card = document.getElementById('client-milestone-card');
    if (!card) return;

    const profile = await ClientManager.getProfile();
    if (!profile) return;

    const now = new Date();
    const planStart = new Date(profile.plan_start_date);
    const monthsIn = (now.getFullYear() - planStart.getFullYear()) * 12 + (now.getMonth() - planStart.getMonth());

    // Only show on first 3 days of a new plan month
    if (now.getDate() > 3 || monthsIn < 1) return;

    // Check if already dismissed this month
    const milestoneKey = `milestone_${now.getFullYear()}_${now.getMonth()}`;
    const dismissed = await window.avis.storeGet(milestoneKey, false);
    if (dismissed) return;

    const finances = await ClientManager.getFinances();
    if (!finances) return;

    const savings = finances.accounts.find(a => a.purpose === 'house_savings');
    const cc = finances.debts.find(d => d.id === 'credit_card');

    const emojiEl = document.getElementById('milestone-emoji');
    const titleEl = document.getElementById('milestone-title');
    const bodyEl = document.getElementById('milestone-body');

    emojiEl.textContent = '🎉';
    titleEl.textContent = `Month ${monthsIn} Complete!`;

    let body = '<div style="text-align:left;font-size:13px;line-height:1.8;color:var(--client-text-secondary);">';
    if (savings) body += `<div>🏠 Savings: <strong>$${savings.balance.toFixed(0)}</strong> / $${savings.target_balance.toLocaleString()}</div>`;
    if (cc) body += `<div>💳 Credit Card: <strong>$${cc.balance.toFixed(2)}</strong> remaining</div>`;
    body += `<div>📈 Credit Score: <strong>${finances.credit_score}</strong></div>`;
    body += '</div>';

    bodyEl.innerHTML = body;
    card.style.display = 'block';

    // Auto-dismiss when closed
    const originalOnClick = card.querySelector('.client-submit-btn').onclick;
    card.querySelector('.client-submit-btn').onclick = async () => {
      card.style.display = 'none';
      await window.avis.storeSet(milestoneKey, true);
    };
  },

  // ================================================================
  // FEATURE 6: PARTNER GOALS VIEW
  // ================================================================
  async renderPartnerGoals(finances) {
    const card = document.getElementById('client-partner-card');
    if (!card || !finances) return;

    const savings = finances.accounts.find(a => a.purpose === 'house_savings');
    if (!savings) return;

    // Operator savings (stored in electron-store, operator updates this)
    const operatorSavings = await window.avis.storeGet('operator_savings', 0);
    const combined = savings.balance + operatorSavings;
    const goal = savings.target_balance;

    document.getElementById('partner-combined').textContent = `$${combined.toLocaleString()}`;
    document.getElementById('partner-goal').textContent = `$${goal.toLocaleString()}`;
    const pct = Math.min(100, (combined / goal) * 100);
    document.getElementById('partner-progress-bar').style.width = `${pct}%`;

    const remaining = goal - combined;
    if (remaining <= 0) {
      document.getElementById('partner-sub').textContent = 'You both did it!! 🏠💕🎉';
    } else {
      document.getElementById('partner-sub').textContent = `$${remaining.toLocaleString()} to go together ✨`;
    }
  },

  // ================================================================
  // FEATURE 7: SUBSCRIPTION AUDIT
  // ================================================================
  async renderSubscriptionAudit() {
    const listEl = document.getElementById('client-sub-list');
    if (!listEl) return;

    const finances = await ClientManager.getFinances();
    if (!finances) return;

    // Get subscriptions from finances or a dedicated list
    const subs = finances.subscriptions || [];
    const theme = ThemeManager?.getTheme();

    if (subs.length === 0) {
      listEl.innerHTML = '<div class="client-empty"><p>No subscriptions tracked yet. Add yours below! 🌸</p></div>';
      document.getElementById('client-sub-savings').style.display = 'none';
      return;
    }

    listEl.innerHTML = subs.map((sub, i) => `
      <div class="client-spending-row" style="padding:10px 0;">
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:600;color:var(--client-text);">${sub.name}</div>
          <div style="font-size:11px;color:var(--client-text-secondary);">$${sub.cost.toFixed(2)}/month</div>
        </div>
        <button onclick="AVIS.toggleSubFlag(${i})" style="padding:6px 12px;border-radius:10px;border:1.5px solid ${sub.flagged ? 'var(--client-danger, #dc143c)' : 'var(--client-secondary)'};background:${sub.flagged ? 'var(--client-danger, #dc143c)15' : 'transparent'};color:${sub.flagged ? 'var(--client-danger, #dc143c)' : 'var(--client-text-secondary)'};font-size:11px;font-weight:600;cursor:pointer;">
          ${sub.flagged ? '✂️ Cut' : 'Flag to cut'}
        </button>
        <button onclick="AVIS.removeSub(${i})" style="padding:6px 8px;border:none;background:none;color:var(--client-text-secondary);cursor:pointer;font-size:14px;">🗑️</button>
      </div>
    `).join('');

    // Calculate savings
    const flaggedTotal = subs.filter(s => s.flagged).reduce((s, sub) => s + sub.cost, 0);
    const savingsEl = document.getElementById('client-sub-savings');
    if (flaggedTotal > 0) {
      savingsEl.style.display = 'block';
      document.getElementById('client-sub-save-amount').textContent = `$${flaggedTotal.toFixed(2)}/month`;
      document.getElementById('client-sub-save-yearly').textContent = `$${(flaggedTotal * 12).toFixed(0)}/year toward your goals`;
    } else {
      savingsEl.style.display = 'none';
    }
  },

  async toggleSubFlag(index) {
    const finances = await ClientManager.getFinances();
    if (!finances || !finances.subscriptions) return;
    finances.subscriptions[index].flagged = !finances.subscriptions[index].flagged;
    await ClientManager.updateFinances(null, { subscriptions: finances.subscriptions });
    this.renderSubscriptionAudit();
  },

  async removeSub(index) {
    const finances = await ClientManager.getFinances();
    if (!finances || !finances.subscriptions) return;
    finances.subscriptions.splice(index, 1);
    await ClientManager.updateFinances(null, { subscriptions: finances.subscriptions });
    this.renderSubscriptionAudit();
  },

  async addSubscription() {
    const nameEl = document.getElementById('sub-add-name');
    const costEl = document.getElementById('sub-add-cost');
    const name = nameEl?.value?.trim();
    const cost = parseFloat(costEl?.value);
    if (!name || !cost || cost <= 0) { this.showToast('Enter name and cost'); return; }

    const finances = await ClientManager.getFinances();
    if (!finances) return;
    if (!finances.subscriptions) finances.subscriptions = [];
    finances.subscriptions.push({ name, cost, flagged: false });
    await ClientManager.updateFinances(null, { subscriptions: finances.subscriptions });
    nameEl.value = '';
    costEl.value = '';
    this.renderSubscriptionAudit();
    this.showToast(`Added ${name} 💕`);
  },

  // ================================================================
  // FEATURE 8: EXPORT / SHARE PROGRESS CARD
  // ================================================================
  async openExportCard() {
    const cardEl = document.getElementById('client-export-card');
    if (!cardEl) return;

    const profile = await ClientManager.getProfile();
    const finances = await ClientManager.getFinances();
    const monthSpending = await ClientManager.getMonthSpending();
    const remaining = await ClientManager.getRemainingBudget();
    if (!profile || !finances) return;

    const savings = finances.accounts.find(a => a.purpose === 'house_savings');
    const cc = finances.debts.find(d => d.id === 'credit_card');
    const totalBudget = Object.values(finances.monthly_budget).reduce((s, v) => s + v, 0);
    const theme = profile.theme || {};
    const now = new Date();
    const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const planMonth = ClientManager.getPlanMonth(profile);

    cardEl.innerHTML = `
      <div style="background:linear-gradient(135deg, ${theme.color_primary || '#ff69b4'}, ${theme.color_accent || '#ff1493'});border-radius:20px;padding:24px;color:#fff;font-family:${theme.font_heading || 'Quicksand'},sans-serif;">
        <div style="text-align:center;margin-bottom:16px;">
          <div style="font-size:12px;opacity:0.8;text-transform:uppercase;letter-spacing:2px;">Monthly Summary</div>
          <div style="font-size:22px;font-weight:700;margin-top:4px;">${profile.display_name}'s Progress</div>
          <div style="font-size:11px;opacity:0.7;">${monthName} — Month ${planMonth} of ${profile.plan_duration_months}</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
          <div style="background:rgba(255,255,255,0.15);border-radius:14px;padding:12px;text-align:center;">
            <div style="font-size:10px;opacity:0.8;">Spent</div>
            <div style="font-size:20px;font-weight:700;">$${monthSpending.total.toFixed(0)}</div>
            <div style="font-size:9px;opacity:0.7;">of $${totalBudget} budget</div>
          </div>
          <div style="background:rgba(255,255,255,0.15);border-radius:14px;padding:12px;text-align:center;">
            <div style="font-size:10px;opacity:0.8;">Saved</div>
            <div style="font-size:20px;font-weight:700;">$${savings ? savings.balance.toFixed(0) : 0}</div>
            <div style="font-size:9px;opacity:0.7;">of $${savings ? savings.target_balance.toLocaleString() : 0} goal</div>
          </div>
        </div>

        <div style="background:rgba(255,255,255,0.15);border-radius:14px;padding:12px;margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:6px;">
            <span>💳 Credit Card</span>
            <span style="font-weight:700;">$${cc ? cc.balance.toFixed(2) : '0'}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;">
            <span>📈 Credit Score</span>
            <span style="font-weight:700;">${finances.credit_score} → ${finances.credit_score_target}</span>
          </div>
        </div>

        <div style="text-align:center;font-size:9px;opacity:0.5;">
          Powered by AVIS — Avel Productions LLC
        </div>
      </div>
    `;

    document.getElementById('client-export-modal').classList.add('active');
  },

  async copyExportCardAsImage() {
    const cardEl = document.getElementById('client-export-card');
    if (!cardEl) return;

    try {
      const canvas = await html2canvas(cardEl, {
        backgroundColor: null,
        scale: 2, // retina quality
        useCORS: true,
        borderRadius: 20
      });

      canvas.toBlob(async (blob) => {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          this.showToast('Image copied! Paste it anywhere 📸');
        } catch (e) {
          // Fallback: save to file instead
          this.showToast('Could not copy image — try Save to Desktop instead');
        }
      }, 'image/png');
    } catch (e) {
      this.showToast('Could not capture card');
    }
  },

  async saveExportCardAsImage() {
    const cardEl = document.getElementById('client-export-card');
    if (!cardEl) return;

    try {
      const canvas = await html2canvas(cardEl, {
        backgroundColor: null,
        scale: 2,
        useCORS: true
      });

      const dataUrl = canvas.toDataURL('image/png');
      const profile = await ClientManager.getProfile();
      const name = profile?.display_name || 'Client';
      const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).replace(' ', '-');
      const filename = `${name}-Progress-${month}.png`;

      // Use Electron's save dialog via IPC or download trick
      const link = document.createElement('a');
      link.download = filename;
      link.href = dataUrl;
      link.click();

      this.showToast(`Saved as ${filename} 💾`);
    } catch (e) {
      this.showToast('Could not save image');
    }
  },

  async copyExportCard() {
    const cardEl = document.getElementById('client-export-card');
    if (!cardEl) return;

    // Copy the text content as formatted summary
    const profile = await ClientManager.getProfile();
    const finances = await ClientManager.getFinances();
    const monthSpending = await ClientManager.getMonthSpending();
    if (!profile || !finances) return;

    const savings = finances.accounts.find(a => a.purpose === 'house_savings');
    const cc = finances.debts.find(d => d.id === 'credit_card');
    const totalBudget = Object.values(finances.monthly_budget).reduce((s, v) => s + v, 0);
    const now = new Date();
    const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const text = `✨ ${profile.display_name}'s Monthly Progress — ${monthName} ✨

💰 Spent: $${monthSpending.total.toFixed(0)} / $${totalBudget} budget
🏠 Saved: $${savings ? savings.balance.toFixed(0) : 0} / $${savings ? savings.target_balance.toLocaleString() : 0}
💳 Credit Card: $${cc ? cc.balance.toFixed(2) : '0'} left
📈 Credit Score: ${finances.credit_score} → ${finances.credit_score_target}

Powered by AVIS 💕`;

    try {
      await navigator.clipboard.writeText(text);
      this.showToast('Copied to clipboard! 📋');
    } catch (e) {
      this.showToast('Could not copy — try selecting text manually');
    }
  },

  renderSpendingBreakdown(finances, monthSpending, remaining) {
    const list = document.getElementById('client-spending-list');
    if (!list) return;
    list.innerHTML = '';

    const theme = ThemeManager?.getTheme();
    const categories = Object.entries(finances.monthly_budget).filter(([_, v]) => v > 0);

    for (const [cat, limit] of categories) {
      const spent = monthSpending.byCategory[cat] || 0;
      const pct = Math.min(150, (spent / limit) * 100);
      const isOver = spent > limit;

      const row = document.createElement('div');
      row.className = 'client-spending-row';
      row.innerHTML = `
        <div class="client-spending-icon">${ThemeManager?.getCategoryIcon(cat, theme) || ''}</div>
        <div class="client-spending-info">
          <div class="client-spending-cat">${this._formatCategoryName(cat)}</div>
          <div class="client-spending-bar"><div class="client-spending-bar-fill ${isOver ? 'over' : ''}" style="width:${pct}%"></div></div>
        </div>
        <div class="client-spending-amount" style="${isOver ? 'color:var(--client-danger)' : ''}">$${spent.toFixed(0)} / $${limit}</div>
      `;
      list.appendChild(row);
    }
  },

  _formatCategoryName(cat) {
    return cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  },

  async renderRecentActivity() {
    const log = await ClientManager.getSpendingLog();
    const list = document.getElementById('client-recent-list');
    if (!list) return;

    const recent = log.entries.slice(-5).reverse();
    if (recent.length === 0) {
      list.innerHTML = '<div class="client-empty"><p>No spending logged yet — let\'s get started! 🌸</p></div>';
      return;
    }

    list.innerHTML = '';
    for (const entry of recent) {
      const row = document.createElement('div');
      row.className = 'client-spending-row';
      row.innerHTML = `
        <div class="client-spending-icon">${ThemeManager?.getCategoryIcon(entry.category, ThemeManager.getTheme()) || ''}</div>
        <div class="client-spending-info">
          <div class="client-spending-cat">$${entry.amount.toFixed(2)} — ${this._formatCategoryName(entry.category)}</div>
          <div style="font-size:11px;color:var(--client-text-secondary)">${entry.date}${entry.note ? ' · ' + entry.note : ''}</div>
        </div>
      `;
      list.appendChild(row);
    }
  },

  generateClientGreeting(profile) {
    const hour = new Date().getHours();
    const name = profile.display_name;
    const day = new Date().getDay();
    let greeting, sub;

    // Girly greetings for Amber-style themes
    const isGirly = profile.theme?.id === 'pink-kitty';

    if (isGirly) {
      if (hour < 12) {
        const mornings = [
          [`Good morning gorgeous! 🌸`, `Let's get this bread today 💅`],
          [`Rise and shine ${name}! 🌺`, `You're glowing today ✨`],
          [`Morning babe! 💕`, `Ready to slay your goals?`],
          [`Hey pretty girl! 🌷`, `Let's check in on your money 💰`]
        ];
        const pick = mornings[Math.floor(Math.random() * mornings.length)];
        greeting = pick[0]; sub = pick[1];
      } else if (hour < 17) {
        const afts = [
          [`Hey ${name}! 💕`, `How's your day going babe?`],
          [`Hi cutie! 🌸`, `Let's see how you're doing 💅`],
          [`Hey girl! 🌺`, `Quick check-in? ✨`],
          [`What's up ${name}! 💖`, `You're doing amazing`]
        ];
        const pick = afts[Math.floor(Math.random() * afts.length)];
        greeting = pick[0]; sub = pick[1];
      } else if (hour < 21) {
        const eves = [
          [`Hey ${name} 🌙`, `How was your day babe?`],
          [`Evening gorgeous! ✨`, `Time to wind down 🌸`],
          [`Hi ${name}! 💕`, `Let's see today's wins`],
          [`Hey girl 🌺`, `Almost done for the day!`]
        ];
        const pick = eves[Math.floor(Math.random() * eves.length)];
        greeting = pick[0]; sub = pick[1];
      } else {
        greeting = `Night night ${name} 🌙💕`;
        sub = 'Quick peek before bed? 😴';
      }

      // Special days
      if (day === 5) { greeting = `It's Friday ${name}!! 🎉`; sub = 'You made it through the week 💅'; }
      if (day === 6) { greeting = `Happy Saturday ${name}! 🌸`; sub = 'Self-care day? 💕'; }
      if (day === 0 && hour >= 17) { greeting = `Sunday vibes ${name} ✨`; sub = 'Want to see your week recap? 🌺'; }
    } else {
      if (hour < 12) {
        greeting = `Good morning, ${name}! 🌸`;
        sub = 'Let\'s check in on your goals';
      } else if (hour < 17) {
        greeting = `Hey ${name}! 💕`;
        sub = 'How\'s your day going?';
      } else if (hour < 21) {
        greeting = `Hi ${name} 🌙`;
        sub = 'How was your day?';
      } else {
        greeting = `Night, ${name} ✨`;
        sub = 'Quick check before bed?';
      }
      if (day === 0 && hour >= 17) {
        greeting = `Hi ${name}! ✨`;
        sub = 'Want to see your week recap?';
      }
    }

    document.getElementById('client-greeting').textContent = greeting;
    document.getElementById('client-subgreeting').textContent = sub;

    // Date line under greeting
    const dateLineEl = document.getElementById('client-date-line');
    if (dateLineEl) {
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      dateLineEl.textContent = `${dateStr} · ${timeStr}`;
    }
  },

  // ================================================================
  // CLIENT VIEW SWITCHING
  // ================================================================
  _clientView: 'dashboard',

  clientSwitchView(view) {
    this._clientView = view;

    // Update nav highlights
    document.querySelectorAll('.client-nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });

    // All hideable views
    const views = ['client-dashboard', 'chat-center', 'client-quick-prompts', 'client-header', 'client-fab',
      'client-history-view', 'client-trends-view', 'client-more-view', 'client-reports-view',
      'client-debt-view', 'client-budget-view', 'client-profile-view', 'client-settings-view',
      'client-subscriptions-view', 'client-payday-banner', 'client-milestone-card', 'client-streak-card',
      'client-chat-toolbar', 'client-chat-archive'];
    views.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });

    const show = id => { const el = document.getElementById(id); if (el) el.style.display = 'block'; };
    const showFlex = id => { const el = document.getElementById(id); if (el) el.style.display = 'flex'; };

    switch (view) {
      case 'dashboard':
        show('client-dashboard'); show('client-header'); showFlex('client-fab');
        this.refreshClientDashboard();
        break;
      case 'chat':
        showFlex('chat-center'); showFlex('client-quick-prompts');
        showFlex('client-chat-toolbar');
        // Only load from disk on first visit — after that, keep live DOM
        if (!this._coachChatLoaded) {
          this.loadCoachChatSession();
        }
        break;
      case 'history':
        show('client-history-view');
        this.renderTransactionHistory();
        break;
      case 'trends':
        show('client-trends-view');
        this.renderTrends('weekly');
        break;
      case 'goals':
        show('client-dashboard'); show('client-header');
        this.refreshClientDashboard();
        // Show debt calculator below goals
        show('client-debt-view');
        this.renderDebtCalculator();
        setTimeout(() => {
          const sc = document.getElementById('client-savings-card');
          if (sc) sc.scrollIntoView({ behavior: 'smooth' });
        }, 100);
        break;
      case 'more':
        show('client-more-view');
        break;
      case 'budget':
        show('client-budget-view');
        this.renderBudgetEditor();
        break;
      case 'reports':
        show('client-reports-view');
        this.renderReports();
        break;
      case 'profile':
        show('client-profile-view');
        this.renderProfileEditor();
        break;
      case 'settings':
        show('client-settings-view');
        this.restoreClientSettings();
        break;
      case 'subscriptions':
        show('client-subscriptions-view');
        this.renderSubscriptionAudit();
        break;
    }
  },

  // ================================================================
  // SPENDING LOGGER
  // ================================================================
  _spendAmount: '',
  _spendCategory: 'food',

  openSpendingLogger() {
    this._spendAmount = '';
    this._spendCategory = 'food';
    document.getElementById('spend-amount-display').textContent = '0.00';
    document.getElementById('spend-note').value = '';
    // Reset category selection
    document.querySelectorAll('.client-cat-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cat === 'food');
    });
    document.getElementById('client-spend-modal').classList.add('active');
    // Sound disabled
  },

  closeSpendingLogger() {
    document.getElementById('client-spend-modal').classList.remove('active');
  },

  numpadPress(key) {
    if (key === 'del') {
      this._spendAmount = this._spendAmount.slice(0, -1);
    } else if (key === '.') {
      if (!this._spendAmount.includes('.')) this._spendAmount += '.';
    } else {
      // Max 2 decimal places
      const parts = this._spendAmount.split('.');
      if (parts[1] && parts[1].length >= 2) return;
      this._spendAmount += key;
    }
    const display = this._spendAmount || '0.00';
    document.getElementById('spend-amount-display').textContent = display;
  },

  selectSpendCategory(cat, el) {
    this._spendCategory = cat;
    document.querySelectorAll('.client-cat-btn').forEach(btn => btn.classList.remove('active'));
    if (el) el.classList.add('active');
  },

  async submitSpending() {
    const amount = parseFloat(this._spendAmount);
    if (!amount || amount <= 0) {
      this.showToast('Enter an amount', 'warning');
      return;
    }

    const note = document.getElementById('spend-note').value.trim();
    const entry = await ClientManager.logSpending(null, {
      amount,
      category: this._spendCategory,
      note
    });

    if (entry) {
      this.closeSpendingLogger();

      // Get remaining budget for this category + totals
      const remaining = await ClientManager.getRemainingBudget();
      const finances = await ClientManager.getFinances();
      const catRemaining = remaining?.[this._spendCategory]?.remaining || 0;
      const totalBudget = finances ? Object.values(finances.monthly_budget).reduce((s, v) => s + v, 0) : 0;
      const totalRemaining = remaining?._total?.remaining || 0;
      const catName = this._formatCategoryName(this._spendCategory);

      // Sound + confetti
      const theme = ThemeManager?.getTheme();
      if (catRemaining >= 0) {
        ThemeManager?.burst(theme, window.innerWidth / 2, window.innerHeight / 2);
      }

      // Show detailed budget summary popup
      this.showSpendingConfirmation(amount, catName, catRemaining, totalBudget, totalRemaining);

      // Refresh dashboard
      this.refreshClientDashboard();
    }
  },

  showSpendingConfirmation(amount, catName, catRemaining, totalBudget, totalRemaining) {
    // Create a confirmation overlay showing budget impact
    const isOver = catRemaining < 0;
    const totalOver = totalRemaining < 0;

    let overlay = document.getElementById('spend-confirm-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'spend-confirm-overlay';
      document.body.appendChild(overlay);
    }

    overlay.style.cssText = `
      position:fixed;inset:0;z-index:15000;background:rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;
      backdrop-filter:blur(4px);animation:fadeIn 0.2s ease;
    `;

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:24px;max-width:340px;width:90%;text-align:center;animation:sheet-up 0.3s ease-out;">
        <div style="font-size:32px;margin-bottom:8px;">${isOver ? '⚠️' : '✅'}</div>
        <div style="font-size:16px;font-weight:700;font-family:var(--client-font-heading,Quicksand);color:#4a1942;margin-bottom:4px;">
          $${amount.toFixed(2)} logged to ${catName}
        </div>
        <div style="font-size:12px;color:${isOver ? '#dc143c' : '#9d5c8a'};margin-bottom:16px;">
          ${isOver ? `⚠️ ${catName} is $${Math.abs(catRemaining).toFixed(2)} over budget` : `$${catRemaining.toFixed(2)} left in ${catName}`}
        </div>

        <div style="background:#fdf2f8;border-radius:14px;padding:14px;margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:11px;color:#9d5c8a;">Monthly Budget</span>
            <span style="font-size:13px;font-weight:700;color:#4a1942;">$${totalBudget.toFixed(0)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="font-size:11px;color:#9d5c8a;">Remaining</span>
            <span style="font-size:13px;font-weight:700;color:${totalOver ? '#dc143c' : '#4a1942'};">
              ${totalOver ? '-' : ''}$${Math.abs(totalRemaining).toFixed(2)}
            </span>
          </div>
          <div style="height:6px;background:#fce7f3;border-radius:3px;overflow:hidden;margin-top:8px;">
            <div style="height:100%;width:${Math.min(100, ((totalBudget - totalRemaining) / totalBudget) * 100)}%;background:${totalOver ? '#dc143c' : 'linear-gradient(90deg,#f472b6,#ec4899)'};border-radius:3px;"></div>
          </div>
        </div>

        <div style="font-size:10px;color:#b89aaa;margin-bottom:12px;">🔒 Entry locked — resets end of month</div>

        <button onclick="document.getElementById('spend-confirm-overlay').remove()" style="
          width:100%;padding:12px;border-radius:16px;border:none;
          background:linear-gradient(135deg,#f472b6,#ec4899);color:#fff;
          font-size:14px;font-weight:700;cursor:pointer;
          font-family:var(--client-font-heading,Quicksand);
        ">Got it 💕</button>
      </div>
    `;
  },

  renderCategoryGrid(theme) {
    const grid = document.getElementById('spend-category-grid');
    if (!grid) return;

    const categories = [
      { id: 'food', label: 'Food' },
      { id: 'gas_transport', label: 'Gas' },
      { id: 'subscriptions', label: 'Subs' },
      { id: 'shopping_personal', label: 'Shopping' },
      { id: 'entertainment', label: 'Fun' },
      { id: 'bills_utilities', label: 'Bills' },
      { id: 'health_beauty', label: 'Beauty' },
      { id: 'gifts', label: 'Gifts' },
      { id: 'pets', label: 'Cat 🐱' },
      { id: 'other', label: 'Other' }
    ];

    grid.innerHTML = '';
    for (const cat of categories) {
      const btn = document.createElement('button');
      btn.className = `client-cat-btn${cat.id === 'food' ? ' active' : ''}`;
      btn.dataset.cat = cat.id;
      btn.innerHTML = `${ThemeManager?.getCategoryIcon(cat.id, theme) || ''}${cat.label}`;
      btn.onclick = () => this.selectSpendCategory(cat.id, btn);
      grid.appendChild(btn);
    }
  },

  // ================================================================
  // CLIENT QUICK PROMPTS
  // ================================================================
  clientQuickPrompt(text) {
    // If archive is open, close it first
    const archive = document.getElementById('client-chat-archive');
    if (archive) archive.style.display = 'none';

    const input = document.getElementById('chat-input');
    if (input) {
      input.value = text;
      this.sendMessage();
    }
  },

  _coachChatLoaded: false,

  async loadCoachChatSession(sessionId) {
    const convLog = await ClientManager.getConversationLog();
    const sessions = ClientManager.getSessions(convLog);
    const chatArea = document.getElementById('chat-area');
    if (!chatArea) return;

    // Close archive if open
    const archive = document.getElementById('client-chat-archive');
    if (archive) archive.style.display = 'none';

    if (sessions.length === 0) {
      chatArea.innerHTML = '';
      ClientManager.startNewSession();
      this._coachChatLoaded = true;
      return;
    }

    // Load specific session or latest
    const targetSession = sessionId
      ? sessions.find(s => s.id === sessionId)
      : sessions[0]; // most recent

    if (!targetSession) {
      chatArea.innerHTML = '';
      ClientManager.startNewSession();
      this._coachChatLoaded = true;
      return;
    }

    // Set this as active session
    ClientManager.setActiveSessionId(targetSession.id);

    // Clear and render messages
    chatArea.innerHTML = '';
    for (const msg of targetSession.messages) {
      this.addMessageToChat(msg.role === 'user' ? 'user' : 'ai', msg.text, 'claude', 'Coach');
    }

    // Also rebuild Orchestrator conversation history so Claude has context
    if (typeof Orchestrator !== 'undefined') {
      Orchestrator.conversationHistory = targetSession.messages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.text
      }));
    }

    // Scroll to bottom
    chatArea.scrollTop = chatArea.scrollHeight;
    this._coachChatLoaded = true;
  },

  async startNewCoachChat() {
    const chatArea = document.getElementById('chat-area');
    if (chatArea) chatArea.innerHTML = '';

    // Start a new session
    ClientManager.startNewSession();

    // Close archive if open
    const archive = document.getElementById('client-chat-archive');
    if (archive) archive.style.display = 'none';

    // Reset Orchestrator conversation history so Claude starts fresh
    if (typeof Orchestrator !== 'undefined') {
      Orchestrator.conversationHistory = [];
    }

    // Focus input
    const input = document.getElementById('chat-input');
    if (input) input.focus();

    this.showToast('New conversation started ✨');
  },

  async toggleChatArchive() {
    const archive = document.getElementById('client-chat-archive');
    if (!archive) return;

    const isVisible = archive.style.display !== 'none';
    if (isVisible) {
      archive.style.display = 'none';
      return;
    }

    // Load and render sessions
    const convLog = await ClientManager.getConversationLog();
    const sessions = ClientManager.getSessions(convLog);
    const listEl = document.getElementById('client-chat-archive-list');
    if (!listEl) return;

    if (sessions.length === 0) {
      listEl.innerHTML = '<div class="client-empty"><p>No conversations yet 🌸</p></div>';
      archive.style.display = 'block';
      return;
    }

    const activeSession = ClientManager.getActiveSessionId();

    listEl.innerHTML = sessions.map(session => {
      const date = new Date(session.started);
      const timeStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
        ' at ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const msgCount = session.messages.length;
      const isActive = session.id === activeSession;
      const preview = session.preview || 'No messages';

      return `
        <div class="client-archive-row ${isActive ? 'active' : ''}" onclick="AVIS.loadArchivedSession('${session.id}')">
          <div class="archive-row-top">
            <span class="archive-date">${timeStr}</span>
            <span class="archive-count">${msgCount} msg${msgCount !== 1 ? 's' : ''}</span>
          </div>
          <div class="archive-preview">${this.escapeHtml(preview)}</div>
          ${isActive ? '<div class="archive-active-badge">Current</div>' : ''}
        </div>
      `;
    }).join('');

    archive.style.display = 'block';
  },

  async loadArchivedSession(sessionId) {
    // Force reload from disk for the specific session
    this._coachChatLoaded = false;
    await this.loadCoachChatSession(sessionId);
    this._coachChatLoaded = true;
  },

  // ================================================================
  // CLIENT SETTINGS TOGGLES
  // ================================================================
  toggleClientSetting(setting) {
    const toggleId = setting === 'notifications' ? 'notif' : setting;
    const toggle = document.getElementById(`toggle-settings-${toggleId}`);
    if (!toggle) return;
    toggle.classList.toggle('on');
    const isOn = toggle.classList.contains('on');

    // Persist setting
    const code = ClientManager.getActiveClient();
    if (code) {
      window.avis.storeSet(`client_${code}_${setting}`, isOn);
    }

    switch (setting) {
      case 'sound':
        const theme = ThemeManager?.getTheme();
        if (theme) theme.sound_effects = isOn;
        break;
      case 'dark':
        document.body.classList.toggle('client-dark', isOn);
        break;
      case 'notifications':
        break;
    }
  },

  async restoreClientSettings() {
    const code = ClientManager.getActiveClient();
    if (!code) return;
    const settings = ['notifications', 'sound', 'dark'];
    for (const setting of settings) {
      const isOn = await window.avis.storeGet(`client_${code}_${setting}`, false);
      const toggleId = setting === 'notifications' ? 'notif' : setting;
      const toggle = document.getElementById(`toggle-settings-${toggleId}`);
      if (toggle) toggle.classList.toggle('on', isOn);
      if (isOn) {
        if (setting === 'dark') document.body.classList.add('client-dark');
        if (setting === 'sound') {
          const theme = ThemeManager?.getTheme();
          if (theme) theme.sound_effects = true;
        }
      }
    }
  },

  // ================================================================
  // TRANSACTION HISTORY
  // ================================================================
  async renderTransactionHistory(filter) {
    const log = await ClientManager.getSpendingLog();
    const list = document.getElementById('client-history-list');
    if (!list) return;

    let entries = [...log.entries].reverse();
    if (filter && filter !== 'all') entries = entries.filter(e => e.category === filter);

    if (entries.length === 0) {
      list.innerHTML = '<div class="client-empty"><p>No transactions yet 🌸</p></div>';
      return;
    }

    // Group by date
    const groups = {};
    for (const e of entries) {
      const d = e.date || 'Unknown';
      if (!groups[d]) groups[d] = [];
      groups[d].push(e);
    }

    const theme = ThemeManager?.getTheme();
    list.innerHTML = Object.entries(groups).map(([date, items]) => {
      const dayTotal = items.reduce((s, e) => s + e.amount, 0);
      const rows = items.map(e => {
        const isLocked = e.locked !== false;
        return `
        <div class="txn-row" onclick="AVIS.toggleTxnActions('${e.id}')" style="cursor:pointer;">
          <div style="display:flex;align-items:center;gap:10px;padding:8px 0;">
            <div style="width:28px;flex-shrink:0;">${ThemeManager?.getCategoryIcon(e.category, theme) || ''}</div>
            <div style="flex:1;">
              <div style="font-size:12px;font-weight:600;">${this._formatCategoryName(e.category)}</div>
              ${e.note ? `<div style="font-size:10px;color:var(--client-text-secondary);margin-top:1px;">${e.note}</div>` : ''}
            </div>
            <div style="font-size:13px;font-weight:700;">-$${e.amount.toFixed(2)}</div>
            <div style="font-size:10px;flex-shrink:0;">${isLocked ? '🔒' : '🔓'}</div>
          </div>
          <div id="txn-actions-${e.id}" style="display:none;padding:6px 0 8px;border-bottom:1px solid var(--client-secondary,#fce7f3);">
            <div style="display:flex;gap:6px;">
              ${isLocked ? `
                <button onclick="event.stopPropagation();AVIS.unlockTxn('${e.id}')" style="flex:1;padding:7px;border-radius:10px;border:1.5px solid var(--client-secondary,#fce7f3);background:none;color:var(--client-text-secondary);font-size:11px;font-weight:600;cursor:pointer;">🔓 Unlock</button>
              ` : `
                <button onclick="event.stopPropagation();AVIS.editTxn('${e.id}')" style="flex:1;padding:7px;border-radius:10px;border:1.5px solid #f472b6;background:none;color:#f472b6;font-size:11px;font-weight:600;cursor:pointer;">✏️ Edit</button>
                <button onclick="event.stopPropagation();AVIS.deleteTxn('${e.id}')" style="flex:1;padding:7px;border-radius:10px;border:1.5px solid #dc143c;background:none;color:#dc143c;font-size:11px;font-weight:600;cursor:pointer;">🗑️ Delete</button>
                <button onclick="event.stopPropagation();AVIS.relockTxn('${e.id}')" style="flex:1;padding:7px;border-radius:10px;border:1.5px solid var(--client-secondary,#fce7f3);background:none;color:var(--client-text-secondary);font-size:11px;font-weight:600;cursor:pointer;">🔒 Lock</button>
              `}
            </div>
          </div>
        </div>`;
      }).join('');
      return `
        <div style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:600;color:var(--client-text-secondary);margin-bottom:4px;">
            <span>${new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            <span>$${dayTotal.toFixed(2)}</span>
          </div>
          ${rows}
        </div>`;
    }).join('');
  },

  filterTransactions() {
    const filter = document.getElementById('client-history-filter')?.value;
    this.renderTransactionHistory(filter);
  },

  toggleTxnActions(id) {
    const el = document.getElementById(`txn-actions-${id}`);
    if (!el) return;
    // Close all other open action panels
    document.querySelectorAll('[id^="txn-actions-"]').forEach(panel => {
      if (panel.id !== `txn-actions-${id}`) panel.style.display = 'none';
    });
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  },

  async unlockTxn(id) {
    await ClientManager.unlockSpendingEntry(null, id);
    this.renderTransactionHistory();
    this.showToast('Entry unlocked — you can now edit or delete it');
  },

  async relockTxn(id) {
    const log = await ClientManager.getSpendingLog();
    const entry = log.entries.find(e => e.id === id);
    if (entry) {
      entry.locked = true;
      await ClientManager._writeClientFile(
        ClientManager.getActiveClient(),
        'spending_log.json',
        log
      );
    }
    this.renderTransactionHistory();
    this.showToast('Entry locked 🔒');
  },

  async deleteTxn(id) {
    const ok = await ClientManager.deleteSpendingEntry(null, id);
    if (ok) {
      this.renderTransactionHistory();
      this.refreshClientDashboard();
      this.showToast('Entry deleted');
    } else {
      this.showToast('Unlock the entry first');
    }
  },

  async editTxn(id) {
    const log = await ClientManager.getSpendingLog();
    const entry = log.entries.find(e => e.id === id);
    if (!entry) return;
    if (entry.locked) { this.showToast('Unlock the entry first'); return; }

    // Show edit modal
    let overlay = document.getElementById('txn-edit-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'txn-edit-overlay';
      document.body.appendChild(overlay);
    }

    const categories = ['food','gas_transport','subscriptions','shopping_personal','entertainment','bills_utilities','health_beauty','gifts','pets','other'];

    overlay.style.cssText = `
      position:fixed;inset:0;z-index:15000;background:rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;
      backdrop-filter:blur(4px);
    `;

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:20px;padding:24px;max-width:340px;width:90%;animation:sheet-up 0.3s ease-out;">
        <div style="font-size:16px;font-weight:700;font-family:var(--client-font-heading,Quicksand);color:#4a1942;margin-bottom:16px;text-align:center;">Edit Entry ✏️</div>

        <label style="font-size:11px;font-weight:600;color:#9d5c8a;display:block;margin-bottom:4px;">Amount ($)</label>
        <input type="number" id="edit-txn-amount" value="${entry.amount}" step="0.01" style="width:100%;padding:10px 14px;border-radius:12px;border:1.5px solid #fce7f3;background:#fdf2f8;color:#4a1942;font-size:15px;font-weight:600;margin-bottom:10px;outline:none;">

        <label style="font-size:11px;font-weight:600;color:#9d5c8a;display:block;margin-bottom:4px;">Category</label>
        <select id="edit-txn-category" style="width:100%;padding:10px 14px;border-radius:12px;border:1.5px solid #fce7f3;background:#fdf2f8;color:#4a1942;font-size:13px;margin-bottom:10px;">
          ${categories.map(c => `<option value="${c}" ${c === entry.category ? 'selected' : ''}>${this._formatCategoryName(c)}</option>`).join('')}
        </select>

        <label style="font-size:11px;font-weight:600;color:#9d5c8a;display:block;margin-bottom:4px;">Note</label>
        <input type="text" id="edit-txn-note" value="${entry.note || ''}" placeholder="Optional" style="width:100%;padding:10px 14px;border-radius:12px;border:1.5px solid #fce7f3;background:#fdf2f8;color:#4a1942;font-size:13px;margin-bottom:14px;outline:none;">

        <button onclick="AVIS.saveEditTxn('${id}')" style="width:100%;padding:12px;border-radius:16px;border:none;background:linear-gradient(135deg,#f472b6,#ec4899);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:var(--client-font-heading,Quicksand);">Save Changes 💕</button>
        <button onclick="document.getElementById('txn-edit-overlay').remove()" style="width:100%;padding:10px;border:none;background:none;color:#9d5c8a;font-size:13px;cursor:pointer;margin-top:4px;">Cancel</button>
      </div>
    `;
  },

  async saveEditTxn(id) {
    const amount = parseFloat(document.getElementById('edit-txn-amount')?.value);
    const category = document.getElementById('edit-txn-category')?.value;
    const note = document.getElementById('edit-txn-note')?.value?.trim() || '';

    if (!amount || amount <= 0) { this.showToast('Enter a valid amount'); return; }

    const log = await ClientManager.getSpendingLog();
    const entry = log.entries.find(e => e.id === id);
    if (!entry || entry.locked) { this.showToast('Entry is locked'); return; }

    entry.amount = amount;
    entry.category = category;
    entry.note = note;
    entry.edited_at = new Date().toISOString();

    await ClientManager._writeClientFile(
      ClientManager.getActiveClient(),
      'spending_log.json',
      log
    );

    document.getElementById('txn-edit-overlay')?.remove();
    this.renderTransactionHistory();
    this.refreshClientDashboard();
    this.showToast('Entry updated 💕');
  },

  // ================================================================
  // SPENDING TRENDS CHART (pure CSS bars)
  // ================================================================
  async renderTrends(mode) {
    // Highlight active button
    ['weekly', 'category', 'daily'].forEach(m => {
      const btn = document.getElementById(`trend-btn-${m}`);
      if (btn) btn.style.background = m === mode ? 'var(--client-primary, #ff69b4)' : '';
      if (btn) btn.style.color = m === mode ? '#fff' : '';
    });

    const chart = document.getElementById('client-trends-chart');
    const compEl = document.getElementById('client-month-comparison');
    if (!chart) return;

    const log = await ClientManager.getSpendingLog();
    const finances = await ClientManager.getFinances();
    const theme = ThemeManager?.getTheme();
    const primary = theme?.color_primary || '#ff69b4';
    const accent = theme?.color_accent || '#ff1493';

    if (mode === 'category') {
      // Spending by category for current month
      const monthSpending = await ClientManager.getMonthSpending();
      const cats = Object.entries(monthSpending.byCategory).sort((a, b) => b[1] - a[1]);
      const max = cats.length > 0 ? cats[0][1] : 1;
      chart.innerHTML = cats.length === 0 ? '<div style="text-align:center;opacity:0.5;padding:16px;">No spending data yet</div>' :
        cats.map(([cat, amount]) => `
          <div style="margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
              <span style="font-weight:600;">${this._formatCategoryName(cat)}</span>
              <span>$${amount.toFixed(2)}</span>
            </div>
            <div style="height:20px;background:var(--client-secondary, #ffb6d5)30;border-radius:10px;overflow:hidden;">
              <div style="height:100%;width:${(amount / max) * 100}%;background:linear-gradient(90deg,${primary},${accent});border-radius:10px;"></div>
            </div>
          </div>
        `).join('');
    } else if (mode === 'weekly') {
      // Last 4 weeks
      const weeks = [];
      for (let w = 3; w >= 0; w--) {
        const start = new Date(); start.setDate(start.getDate() - (w + 1) * 7);
        const end = new Date(); end.setDate(end.getDate() - w * 7);
        const startStr = start.toISOString().split('T')[0];
        const endStr = end.toISOString().split('T')[0];
        const total = log.entries.filter(e => e.date >= startStr && e.date < endStr).reduce((s, e) => s + e.amount, 0);
        weeks.push({ label: `Week ${4 - w}`, total });
      }
      const max = Math.max(...weeks.map(w => w.total), 1);
      chart.innerHTML = `<div style="display:flex;align-items:flex-end;gap:12px;height:140px;padding:8px 0;">
        ${weeks.map(w => `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;">
            <div style="font-size:10px;font-weight:600;margin-bottom:4px;">$${w.total.toFixed(0)}</div>
            <div style="width:100%;background:linear-gradient(180deg,${primary},${accent});border-radius:8px 8px 0 0;height:${Math.max(4, (w.total / max) * 100)}px;"></div>
            <div style="font-size:9px;color:var(--client-text-secondary);margin-top:4px;">${w.label}</div>
          </div>
        `).join('')}
      </div>`;
    } else if (mode === 'daily') {
      // Last 7 days
      const days = [];
      for (let d = 6; d >= 0; d--) {
        const date = new Date(); date.setDate(date.getDate() - d);
        const dateStr = date.toISOString().split('T')[0];
        const total = log.entries.filter(e => e.date === dateStr).reduce((s, e) => s + e.amount, 0);
        days.push({ label: date.toLocaleDateString('en-US', { weekday: 'short' }), total, date: dateStr });
      }
      const max = Math.max(...days.map(d => d.total), 1);
      chart.innerHTML = `<div style="display:flex;align-items:flex-end;gap:6px;height:120px;padding:8px 0;">
        ${days.map(d => `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;">
            <div style="font-size:8px;font-weight:600;margin-bottom:3px;">${d.total > 0 ? '$' + d.total.toFixed(0) : ''}</div>
            <div style="width:100%;background:${d.total > 0 ? `linear-gradient(180deg,${primary},${accent})` : 'var(--client-secondary, #ffb6d5)30'};border-radius:6px 6px 0 0;height:${Math.max(4, (d.total / max) * 100)}px;"></div>
            <div style="font-size:8px;color:var(--client-text-secondary);margin-top:3px;">${d.label}</div>
          </div>
        `).join('')}
      </div>`;
    }

    // Month comparison
    if (compEl && finances) {
      const monthSpending = await ClientManager.getMonthSpending();
      const budget = finances.monthly_budget;
      compEl.innerHTML = Object.entries(budget).filter(([_, v]) => v > 0).map(([cat, limit]) => {
        const spent = monthSpending.byCategory[cat] || 0;
        const pct = Math.min(100, (spent / limit) * 100);
        const over = spent > limit;
        return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;">
          <div style="width:80px;font-size:10px;font-weight:600;flex-shrink:0;">${this._formatCategoryName(cat)}</div>
          <div style="flex:1;height:8px;background:var(--client-secondary,#ffb6d5)25;border-radius:4px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${over ? 'var(--client-danger,#dc143c)' : primary};border-radius:4px;"></div>
          </div>
          <div style="font-size:10px;font-weight:600;width:70px;text-align:right;${over ? 'color:var(--client-danger,#dc143c)' : ''}">$${spent.toFixed(0)} / $${limit}</div>
        </div>`;
      }).join('');
    }
  },

  // ================================================================
  // WEEKLY REPORTS
  // ================================================================
  async renderReports() {
    // --- Live This Week Summary ---
    const liveEl = document.getElementById('client-live-week-summary');
    if (liveEl) {
      const finances = await ClientManager.getFinances();
      const weekSpending = await ClientManager.getWeekSpending();
      const monthSpending = await ClientManager.getMonthSpending();
      const remaining = await ClientManager.getRemainingBudget();
      const profile = await ClientManager.getProfile();

      if (finances && profile) {
        const totalBudget = Object.values(finances.monthly_budget).reduce((s, v) => s + v, 0);
        const weeklyBudget = totalBudget / 4;
        const savings = finances.accounts?.find(a => a.purpose === 'house_savings');
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0=Sun
        const daysLeft = 7 - dayOfWeek;

        // Category breakdown for the week
        const catBreakdown = Object.entries(weekSpending.byCategory)
          .sort((a, b) => b[1] - a[1])
          .map(([cat, amount]) => {
            const budget = finances.monthly_budget[cat] || 0;
            const weekBudget = budget / 4;
            const pct = weekBudget > 0 ? Math.round((amount / weekBudget) * 100) : 0;
            return `<div style="display:flex;justify-content:space-between;padding:3px 0;">
              <span>${this._formatCategoryName(cat)}</span>
              <span style="font-weight:600;${pct > 100 ? 'color:var(--client-danger,#dc143c)' : ''}">$${amount.toFixed(2)} ${weekBudget > 0 ? `(${pct}%)` : ''}</span>
            </div>`;
          }).join('');

        const weekStatus = weekSpending.total <= weeklyBudget ? 'on track' : 'over budget';
        const statusColor = weekSpending.total <= weeklyBudget ? 'var(--client-success,#ff77aa)' : 'var(--client-danger,#dc143c)';
        const statusEmoji = weekSpending.total <= weeklyBudget ? '✅' : '⚠️';

        liveEl.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div>
              <div style="font-size:22px;font-weight:700;font-family:var(--client-font-heading);">$${weekSpending.total.toFixed(2)}</div>
              <div style="font-size:11px;color:var(--client-text-secondary);">spent this week</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:13px;font-weight:600;color:${statusColor};">${statusEmoji} ${weekStatus}</div>
              <div style="font-size:11px;color:var(--client-text-secondary);">${daysLeft} days left</div>
            </div>
          </div>
          <div style="height:6px;background:var(--client-secondary,#fce7f3);border-radius:3px;overflow:hidden;margin-bottom:12px;">
            <div style="height:100%;width:${Math.min(100, (weekSpending.total / weeklyBudget) * 100)}%;background:${statusColor};border-radius:3px;transition:width 0.4s;"></div>
          </div>
          <div style="font-size:11px;color:var(--client-text-secondary);margin-bottom:6px;">Weekly target: $${weeklyBudget.toFixed(0)}</div>
          ${weekSpending.entries.length > 0 ? `
            <div style="font-size:12px;margin-top:8px;">
              <div style="font-weight:600;margin-bottom:4px;font-size:11px;color:var(--client-text-secondary);">BREAKDOWN</div>
              ${catBreakdown}
            </div>
            <div style="font-size:11px;color:var(--client-text-secondary);margin-top:8px;">${weekSpending.entries.length} transaction${weekSpending.entries.length !== 1 ? 's' : ''} logged</div>
          ` : '<div style="font-size:12px;color:var(--client-text-secondary);text-align:center;padding:8px 0;">No spending logged this week yet 🌸</div>'}
        `;
      }
    }

    // --- Past Recaps ---
    const list = document.getElementById('client-reports-list');
    if (!list) return;

    const progress = await ClientManager.getProgressLog();
    const checkins = progress.events.filter(e => e.type === 'weekly_checkin').reverse();

    if (checkins.length === 0) {
      list.innerHTML = '<div class="client-empty"><p>No weekly recaps yet — your first one arrives Sunday! 🌸</p></div>';
      return;
    }

    list.innerHTML = checkins.map(e => `
      <div style="padding:12px 0;border-bottom:1px solid var(--client-secondary, #ffb6d5)20;">
        <div style="font-size:10px;color:var(--client-text-secondary);margin-bottom:4px;">${new Date(e.timestamp || e.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        <div style="font-size:12px;line-height:1.6;">${e.note}</div>
      </div>
    `).join('');
  },

  // ================================================================
  // DEBT PAYOFF CALCULATOR
  // ================================================================
  async renderDebtCalculator() {
    const el = document.getElementById('client-debt-calculator');
    if (!el) return;

    const finances = await ClientManager.getFinances();
    if (!finances || !finances.debts || finances.debts.length === 0) {
      el.innerHTML = '<div class="client-empty"><p>No debts — you\'re debt free! 🎉</p></div>';
      return;
    }

    el.innerHTML = finances.debts.map(debt => {
      const monthlyPayment = debt.attack_amount || debt.minimum_payment;
      const monthsLeft = Math.ceil(debt.balance / monthlyPayment);
      const payoffDate = new Date();
      payoffDate.setMonth(payoffDate.getMonth() + monthsLeft);

      // Scenario: what if they pay extra?
      const extraPayments = [0, 25, 50, 100];
      const scenarios = extraPayments.map(extra => {
        const total = monthlyPayment + extra;
        const months = Math.ceil(debt.balance / total);
        const d = new Date(); d.setMonth(d.getMonth() + months);
        return { extra, months, date: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) };
      });

      return `
        <div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--client-secondary, #ffb6d5)20;">
          <div style="font-size:14px;font-weight:700;margin-bottom:6px;">${debt.name}</div>
          <div style="display:flex;gap:12px;margin-bottom:8px;">
            <div>
              <div style="font-size:9px;text-transform:uppercase;opacity:0.5;">Balance</div>
              <div style="font-size:16px;font-weight:700;">$${debt.balance.toFixed(2)}</div>
            </div>
            <div>
              <div style="font-size:9px;text-transform:uppercase;opacity:0.5;">Payment</div>
              <div style="font-size:16px;font-weight:700;">$${monthlyPayment}/mo</div>
            </div>
            <div>
              <div style="font-size:9px;text-transform:uppercase;opacity:0.5;">Payoff</div>
              <div style="font-size:16px;font-weight:700;">${payoffDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>
            </div>
          </div>
          <div style="font-size:11px;font-weight:600;margin-bottom:6px;">What if you paid more?</div>
          ${scenarios.map(s => `
            <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:11px;">
              <div style="width:60px;font-weight:600;">${s.extra === 0 ? 'Current' : '+$' + s.extra + '/mo'}</div>
              <div style="flex:1;height:6px;background:var(--client-secondary, #ffb6d5)25;border-radius:3px;overflow:hidden;">
                <div style="height:100%;width:${Math.max(5, 100 - (s.months / scenarios[0].months) * 100 + 30)}%;background:var(--client-primary, #ff69b4);border-radius:3px;"></div>
              </div>
              <div style="width:80px;text-align:right;font-size:10px;">${s.months} mo → ${s.date}</div>
            </div>
          `).join('')}
        </div>
      `;
    }).join('');
  },

  // ================================================================
  // BUDGET EDITOR
  // ================================================================
  async renderBudgetEditor() {
    const el = document.getElementById('client-budget-editor');
    if (!el) return;

    const finances = await ClientManager.getFinances();
    if (!finances) return;

    const theme = ThemeManager?.getTheme();
    const totalBudget = Object.values(finances.monthly_budget).reduce((s, v) => s + v, 0);

    el.innerHTML = `
      <div style="text-align:center;margin-bottom:12px;">
        <div style="font-size:11px;color:var(--client-text-secondary);">Total Monthly Budget</div>
        <div style="font-size:24px;font-weight:700;" id="budget-total-display">$${totalBudget}</div>
      </div>
      ${Object.entries(finances.monthly_budget).map(([cat, amount]) => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--client-secondary, #ffb6d5)15;">
          <div style="width:28px;flex-shrink:0;">${ThemeManager?.getCategoryIcon(cat, theme) || ''}</div>
          <div style="flex:1;font-size:12px;font-weight:600;">${this._formatCategoryName(cat)}</div>
          <div style="display:flex;align-items:center;gap:4px;">
            <span style="font-size:13px;color:var(--client-text-secondary);">$</span>
            <input type="number" data-budget-cat="${cat}" value="${amount}" min="0" step="5"
              style="width:60px;padding:6px 8px;border-radius:10px;border:1px solid var(--client-secondary, #ffb6d5);background:var(--client-bg, #fff0f7);color:var(--client-text, #3d1f2e);font-size:13px;font-weight:600;font-family:var(--client-font-body);text-align:right;"
              oninput="AVIS.updateBudgetTotal()">
          </div>
        </div>
      `).join('')}
    `;
  },

  updateBudgetTotal() {
    const inputs = document.querySelectorAll('[data-budget-cat]');
    let total = 0;
    inputs.forEach(input => total += parseFloat(input.value) || 0);
    const display = document.getElementById('budget-total-display');
    if (display) display.textContent = '$' + total;
  },

  async saveClientBudget() {
    const inputs = document.querySelectorAll('[data-budget-cat]');
    const newBudget = {};
    inputs.forEach(input => {
      newBudget[input.dataset.budgetCat] = parseFloat(input.value) || 0;
    });
    const finances = await ClientManager.getFinances();
    if (finances) {
      finances.monthly_budget = newBudget;
      await ClientManager.updateFinances(null, { monthly_budget: newBudget });
      this.showToast('Budget updated! 💕', 'success');
      ThemeManager?.burst(ThemeManager.getTheme(), window.innerWidth / 2, window.innerHeight / 2);
    }
  },

  // ================================================================
  // PROFILE / AVATAR CUSTOMIZATION
  // ================================================================
  _profileEmoji: '😊',
  _profileColor: '#ff69b4',

  async renderProfileEditor() {
    const profile = await ClientManager.getProfile();
    if (!profile) return;

    const nameInput = document.getElementById('profile-edit-name');
    if (nameInput) nameInput.value = profile.display_name;

    const avatar = document.getElementById('client-profile-avatar');
    this._profileEmoji = profile.avatar_emoji || '😊';
    this._profileColor = profile.avatar_color || profile.theme?.color_primary || '#ff69b4';
    if (avatar) {
      avatar.style.background = this._profileColor;
      avatar.textContent = this._profileEmoji;
    }

    const nameEl = document.getElementById('client-profile-name');
    if (nameEl) nameEl.textContent = profile.display_name;

    const sinceEl = document.getElementById('client-profile-since');
    if (sinceEl) sinceEl.textContent = new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // Emoji grid
    const emojiGrid = document.getElementById('profile-emoji-grid');
    const emojis = ['😊', '💕', '🌸', '✨', '💪', '🎯', '🏠', '💰', '🔥', '🦋', '🌙', '👑', '💎', '🐱', '🌺', '⭐'];
    if (emojiGrid) {
      emojiGrid.innerHTML = emojis.map(e => `
        <button onclick="AVIS.selectProfileEmoji('${e}', this)" style="width:36px;height:36px;border-radius:10px;border:2px solid ${e === this._profileEmoji ? 'var(--client-primary)' : 'transparent'};background:var(--client-bg);font-size:18px;cursor:pointer;">${e}</button>
      `).join('');
    }

    // Color grid
    const colorGrid = document.getElementById('profile-color-grid');
    const colors = ['#ff69b4', '#ff1493', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#00bcd4', '#4caf50', '#ff9800', '#f44336', '#795548'];
    if (colorGrid) {
      colorGrid.innerHTML = colors.map(c => `
        <button onclick="AVIS.selectProfileColor('${c}', this)" style="width:28px;height:28px;border-radius:50%;border:2px solid ${c === this._profileColor ? '#fff' : 'transparent'};background:${c};cursor:pointer;"></button>
      `).join('');
    }
  },

  selectProfileEmoji(emoji, btn) {
    this._profileEmoji = emoji;
    document.querySelectorAll('#profile-emoji-grid button').forEach(b => b.style.borderColor = 'transparent');
    if (btn) btn.style.borderColor = 'var(--client-primary)';
    const avatar = document.getElementById('client-profile-avatar');
    if (avatar) avatar.textContent = emoji;
  },

  selectProfileColor(color, btn) {
    this._profileColor = color;
    document.querySelectorAll('#profile-color-grid button').forEach(b => b.style.borderColor = 'transparent');
    if (btn) btn.style.borderColor = '#fff';
    const avatar = document.getElementById('client-profile-avatar');
    if (avatar) avatar.style.background = color;
  },

  async saveClientProfile() {
    const name = document.getElementById('profile-edit-name')?.value.trim();
    if (!name) { this.showToast('Name is required', 'warning'); return; }
    await ClientManager.updateProfile(null, {
      display_name: name,
      avatar_emoji: this._profileEmoji,
      avatar_color: this._profileColor
    });
    this.showToast('Profile saved! 💕', 'success');
    ThemeManager?.burst(ThemeManager.getTheme(), window.innerWidth / 2, window.innerHeight / 2);
    // Update greeting
    const greetEl = document.getElementById('client-greeting');
    if (greetEl) {
      const hour = new Date().getHours();
      greetEl.textContent = hour < 12 ? `Good morning, ${name}! 🌸` : hour < 17 ? `Hey ${name}! 💕` : `Hi ${name} 🌙`;
    }
  },

  // ================================================================
  // RECOMMENDATION NOTIFICATIONS
  // ================================================================
  async checkRecommendationBadge() {
    if (!ClientManager.isClientMode()) return;
    const pending = await ClientManager.getRecommendations(null, 'pending');
    const viewed = await ClientManager.getRecommendations(null, 'viewed');
    const unread = [...pending, ...viewed.filter(r => !r.responded_at)];

    // Badge on header mascot
    const badge = document.getElementById('client-rec-badge');
    if (badge) {
      if (unread.length > 0) {
        badge.textContent = unread.length;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }
  },

  async openRecommendations() {
    const recs = await ClientManager.getRecommendations();
    const pending = recs.filter(r => r.status === 'pending' || r.status === 'viewed');
    const list = document.getElementById('client-rec-list');
    if (!list) return;

    if (pending.length === 0) {
      list.innerHTML = '<div class="client-empty"><p>No new messages from coach 🌸</p></div>';
    } else {
      list.innerHTML = pending.map(r => `
        <div class="client-rec-card" style="margin:0 0 10px;border:1px solid var(--client-secondary);">
          <div class="client-rec-badge">💌 From Coach</div>
          <div class="client-rec-title">${r.title}</div>
          <div class="client-rec-body">${r.body}</div>
          <div class="client-rec-actions">
            <button class="client-rec-btn accept" onclick="AVIS.respondRec('${r.id}','accepted')">Got it! 💕</button>
            <button class="client-rec-btn snooze" onclick="AVIS.respondRec('${r.id}','snoozed')">Later</button>
          </div>
        </div>
      `).join('');

      // Mark as viewed
      for (const r of pending) {
        if (r.status === 'pending') await ClientManager.markRecommendationViewed(null, r.id);
      }
    }

    document.getElementById('client-rec-modal').classList.add('active');
  },

  async respondRec(recId, response) {
    await ClientManager.respondToRecommendation(null, recId, response);
    this.showToast(response === 'accepted' ? 'Noted! 💕' : 'Snoozed', 'success');
    this.openRecommendations(); // Refresh
    this.checkRecommendationBadge();
  },

  // ================================================================
  // OPERATOR ESCAPE
  // ================================================================
  async signOut() {
    // Clear persisted state
    this._clientModeActive = false;
    this._coachChatLoaded = false;
    await ClientManager.setActiveClient(null);
    await window.avis.storeSet('bootMode', null);
    await window.avis.storeSet('activeClient', null);

    // Remove client mode styling
    document.body.classList.remove('client-mode');
    document.body.style.backgroundImage = '';
    if (typeof ThemeManager !== 'undefined') ThemeManager.resetTheme();

    // Hide everything
    document.querySelector('.titlebar')?.style.setProperty('display', 'none');
    document.querySelector('.main-layout')?.style.setProperty('display', 'none');

    // Hide client-only elements
    ['client-nav', 'client-fab', 'client-header', 'client-dashboard',
     'client-history-view', 'client-trends-view', 'client-more-view',
     'client-reports-view', 'client-debt-view', 'client-budget-view',
     'client-profile-view', 'client-settings-view', 'client-subscriptions-view',
     'client-payday-banner', 'client-milestone-card', 'client-quick-prompts'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    // Reset titlebar
    const titleCenter = document.querySelector('.titlebar-center');
    if (titleCenter) titleCenter.style.cssText = '';
    const leftPanel = document.querySelector('.left-panel');
    if (leftPanel) leftPanel.style.cssText = '';
    const mainLayout = document.querySelector('.main-layout');
    if (mainLayout) mainLayout.style.cssText = '';

    // Show code entry screen (empty — no prefill so they enter fresh)
    this._showCodeEntryScreen(null);
  },

  async attemptOperatorEscape() {
    const pw = document.getElementById('operator-escape-password').value;
    const success = await this.exitClientMode(pw);
    if (success) {
      document.getElementById('operator-escape-modal').classList.remove('active');
      document.getElementById('operator-escape-password').value = '';
    }
  },

  showClientNotification(message, recs) {
    const badge = document.getElementById('client-rec-badge');
    if (badge && recs.length > 0) {
      badge.textContent = recs.length;
      badge.style.display = 'flex';
    }
    this.showToast(message, 'info');
  },

  showWelcomeFlow(profile) {
    const overlay = document.createElement('div');
    overlay.className = 'client-welcome-overlay';
    overlay.id = 'client-welcome-overlay';

    const mascotSVG = ThemeManager?.getMascotSVG(profile.theme) || '';

    const isGirly = profile.theme?.id === 'pink-kitty';
    overlay.innerHTML = isGirly ? `
      <div class="mascot-welcome" style="transform:scale(1.5);margin-bottom:30px;">${mascotSVG}</div>
      <h1>Hiii ${profile.display_name}! 💕🌸</h1>
      <p style="font-size:15px;">Welcome to your glow-up bestie ✨</p>
      <p style="margin-top:16px;font-size:13px;">We're saving for that dream house together! 🏠💅<br>$2,100 by December — you got this girl</p>
      <p style="margin-top:12px;font-size:12px;opacity:0.7;">🌺 Tap + to log when you spend<br>💬 Chat with me anytime — I got you<br>💌 Coach will send you tips too</p>
      <button class="client-welcome-btn" onclick="AVIS.dismissWelcome()">Let's slay! 💅🌸</button>
    ` : `
      <div class="mascot-welcome" style="transform:scale(1.5);margin-bottom:30px;">${mascotSVG}</div>
      <h1>Hi ${profile.display_name}! 💕</h1>
      <p>Welcome to your personal coach</p>
      <p style="margin-top:16px;font-size:13px;">Let's build something great together ✨</p>
      <p style="margin-top:8px;font-size:12px;opacity:0.7;">Tap the + button to log spending<br>Chat with me anytime for help<br>Your coach will check in too 💌</p>
      <button class="client-welcome-btn" onclick="AVIS.dismissWelcome()">Let's do this!</button>
    `;

    document.body.appendChild(overlay);
    if (typeof gsap !== 'undefined') {
      gsap.from(overlay, { opacity: 0, duration: 0.5 });
      gsap.from(overlay.querySelector('.mascot-welcome'), { scale: 0, duration: 0.6, delay: 0.2, ease: 'back.out(1.7)' });
      gsap.from(overlay.querySelector('h1'), { y: 20, opacity: 0, duration: 0.4, delay: 0.4 });
    }
  },

  async dismissWelcome() {
    const overlay = document.getElementById('client-welcome-overlay');
    if (overlay) {
      if (typeof gsap !== 'undefined') {
        gsap.to(overlay, { opacity: 0, duration: 0.3, onComplete: () => overlay.remove() });
      } else {
        overlay.remove();
      }
    }
    await ClientManager.updateProfile(null, { welcome_completed: true });
  },

  // ====================================================================
  // Send message — with STOP button + retry support
  // ====================================================================
  async sendMessage(retryText = null) {
    if (this.isProcessing) return;

    const input = document.getElementById('chat-input');
    const text = retryText || input.value.trim();
    if (!text && !FileHandler.hasFiles()) return;

    // Trigger send glow + GSAP press animation + sound
    this._triggerSendGlow('chat');
    this.animateSendPress();
    this.playSound('send');

    this.isProcessing = true;
    this.showStopButton(true);

    const welcome = document.getElementById('welcome-msg');
    if (welcome) welcome.remove();

    const files = retryText ? [] : FileHandler.consumeFiles();
    this.lastUserMessage = text;
    this.lastUserFiles = files;

    if (!retryText) {
      this.addMessageToChat('user', text, null, null, files);
      MemoryManager.addMessage('user', text);
      if (typeof MissionControl !== 'undefined') MissionControl.recordMessage();
      input.value = '';
      input.style.height = 'auto';
    }

    const typingEl = this.showTyping();

    try {
      const result = await Orchestrator.process(text, files);

      // BUG 4: Clean up ALL typing indicators
      typingEl.remove();
      document.querySelectorAll('.typing-msg').forEach(el => el.remove());

      // Finalize step panel if not already done
      if (this.activeStepPanel) {
        const elapsed = ((Date.now() - (Orchestrator._loopStart || Date.now())) / 1000).toFixed(1);
        this.finalizeStepPanel(`Done in ${elapsed}s`);
      }

      if (result.image) this.addImageToChat(result.image, result.provider, result.model);

      // Check if orchestrator generated an image via tool call
      if (Orchestrator._lastGeneratedImage) {
        this.addImageToChat(Orchestrator._lastGeneratedImage, 'openai', 'DALL-E 3');
        Orchestrator._lastGeneratedImage = null;
      }

      if (result.timedOut) {
        this.addRetryMessage('Response timed out. Click to retry.');
      } else if (result.paused) {
        this.addMessageToChat('ai', result.text, result.provider, result.model);
        this.addContinueCard(result.pauseInfo);
      } else if (result.error && result.friendlyError) {
        this.addErrorCard(result.text, result.provider);
      } else if (result.streamed) {
        this.finalizeStreamBubble(result.provider, result.model);
      } else if (result.failover) {
        // Show failover notice then the response
        this.addMessageToChat('ai', `\u26A0\uFE0F *Claude unavailable — response from ${result.activeOrchestrator}:*\n\n${result.text}`, result.provider, result.model);
      } else if (result.text) {
        this.addMessageToChat('ai', result.text, result.provider, result.model);
      } else if (!result.image && !result.error && !result.paused) {
        this.addMessageToChat('ai', '(No response generated)', 'avis', 'system');
      }

      if (result.citations?.length > 0) this.addCitationsToChat(result.citations);

      MemoryManager.addMessage('assistant', result.text || '[No response]', result.provider, result.model);
      await MemoryManager.saveCurrentConversation();
      this.updateContextIndicator();
      this.playNotificationSound();

    } catch (err) {
      typingEl.remove();
      if (this.activeStepPanel) this.finalizeStepPanel(`Error: ${err.message}`);
      this.addMessageToChat('ai', `Error: ${err.message}`, 'avis', 'system');
    }

    this.isProcessing = false;
    this.showStopButton(false);
    this.updateProviderStatus();
    this.renderMeters();
  },

  addRetryMessage(text) {
    const chatArea = document.getElementById('chat-area');
    const div = document.createElement('div');
    div.className = 'message ai';
    div.innerHTML = `<div class="message-bubble retry-bubble" onclick="AVIS.retryLast()" style="cursor:pointer;border-color:var(--accent-amber);color:var(--accent-amber);">
      <span>\u26A0\uFE0F ${this.escapeHtml(text)}</span>
      <button class="retry-btn">Retry</button>
    </div>`;
    chatArea.appendChild(div);
    chatArea.scrollTop = chatArea.scrollHeight;
  },

  retryLast() {
    if (this.lastUserMessage) {
      this.sendMessage(this.lastUserMessage);
    }
  },

  async retryWithProvider(providerName) {
    if (!this.lastUserMessage || this.isProcessing) return;
    this.isProcessing = true;
    this.showStopButton(true);
    this.emitStep && Orchestrator.emitStep('route', `Retrying with ${providerName}...`);

    try {
      const result = await Orchestrator.callProvider(providerName, this.lastUserMessage);
      this.addMessageToChat('ai', result, providerName, providerName);
      MemoryManager.addMessage('assistant', result, providerName, providerName);
      await MemoryManager.saveCurrentConversation();
    } catch (err) {
      this.addMessageToChat('ai', `Error: ${err.message}`, 'avis', 'system');
    }

    this.isProcessing = false;
    this.showStopButton(false);
  },

  // BUG 4: Continue card for paused tasks
  addContinueCard(pauseInfo) {
    const chatArea = document.getElementById('chat-area');
    const div = document.createElement('div');
    div.className = 'message ai';
    div.innerHTML = `<div class="continue-card">
      <div class="continue-card-header">\u26A0\uFE0F Task paused — reached step limit (${pauseInfo.iteration}/${pauseInfo.maxIterations} steps, type: ${pauseInfo.taskType})</div>
      <div class="continue-card-actions">
        <button class="continue-btn" onclick="AVIS.continueTask()">&#9654; Continue</button>
        <button class="retry-btn" style="background:var(--bg-card);color:var(--text-secondary);border:1px solid var(--border);" onclick="AVIS.newConversation()">&#10005; Cancel</button>
      </div>
    </div>`;
    chatArea.appendChild(div);
    chatArea.scrollTop = chatArea.scrollHeight;
  },

  async continueTask() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.showStopButton(true);

    const typingEl = this.showTyping();
    try {
      const result = await Orchestrator.continueTask();
      typingEl.remove();
      if (this.activeStepPanel) this.finalizeStepPanel('Done');

      if (result.paused) {
        this.addMessageToChat('ai', result.text, result.provider, result.model);
        this.addContinueCard(result.pauseInfo);
      } else if (result.text) {
        this.addMessageToChat('ai', result.text, result.provider, result.model);
      }

      MemoryManager.addMessage('assistant', result.text || '', result.provider, result.model);
      await MemoryManager.saveCurrentConversation();
    } catch (err) {
      typingEl.remove();
      this.addMessageToChat('ai', `Error: ${err.message}`, 'avis', 'system');
    }

    this.isProcessing = false;
    this.showStopButton(false);
    this.updateProviderStatus();
    this.renderMeters();
  },

  // BUG 3: Clean error card display
  addErrorCard(message, provider) {
    const chatArea = document.getElementById('chat-area');
    const div = document.createElement('div');
    div.className = 'message ai';
    div.innerHTML = `<div class="error-card">
      <div class="error-card-header">\u26A0\uFE0F AVIS / ${this.escapeHtml((provider || 'system').toUpperCase())} ERROR</div>
      <div class="error-card-body">${this.escapeHtml(message)}</div>
      <div class="error-card-actions">
        <button class="retry-btn" onclick="AVIS.retryLast()">Retry</button>
        <button class="retry-btn" style="background:var(--bg-card);color:var(--text-secondary);border:1px solid var(--border);" onclick="AVIS.newConversation()">New Chat</button>
      </div>
    </div>`;
    chatArea.appendChild(div);
    chatArea.scrollTop = chatArea.scrollHeight;
  },

  // ====================================================================
  // Message display (unchanged from v2 minus tool callbacks — steps replace them)
  // ====================================================================
  addMessageToChat(role, content, provider, model, files = []) {
    const chatArea = document.getElementById('chat-area');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;

    let html = '<div class="message-bubble" style="position:relative;">';
    if (role === 'ai' && provider) html += `<div class="provider-badge ${provider}">${provider}${model ? ' / ' + model : ''}</div>`;
    // Copy prompt button on user messages
    if (role === 'user') html += `<button class="copy-prompt-btn" onclick="AVIS.copyText(this.parentElement)" title="Copy prompt">&#128203;</button>`;
    if (files.length > 0) {
      html += '<div style="margin-bottom:8px;">';
      files.forEach(f => {
        html += f.type === 'image'
          ? `<img src="data:${f.mimeType};base64,${f.data}" style="max-width:200px;border-radius:8px;margin:4px;">`
          : `<div class="file-attachment">&#128196; ${f.name}</div>`;
      });
      html += '</div>';
    }
    html += role === 'ai' ? this.renderMarkdown(content) : this.escapeHtml(content);

    // Add retry-with-provider buttons on AI responses
    if (role === 'ai' && provider && provider !== 'avis') {
      const others = ['claude', 'openai', 'deepseek', 'mistral', 'perplexity'].filter(p => p !== provider);
      const names = { claude: 'Claude', openai: 'GPT-4o', deepseek: 'DeepSeek', mistral: 'Mistral', perplexity: 'Perplexity' };
      html += `<div class="retry-provider-bar">`;
      html += others.map(p =>
        `<button class="retry-provider-btn" onclick="AVIS.retryWithProvider('${p}')" title="Retry with ${names[p]}">${names[p]}</button>`
      ).join('');
      html += `</div>`;
    }

    html += '</div>';
    msgDiv.innerHTML = html;
    chatArea.appendChild(msgDiv);

    msgDiv.querySelectorAll('pre').forEach(pre => {
      const btn = document.createElement('button');
      btn.className = 'code-copy-btn'; btn.textContent = 'Copy';
      btn.onclick = () => {
        navigator.clipboard.writeText(pre.querySelector('code')?.textContent || pre.textContent);
        btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 2000);
      };
      pre.style.position = 'relative'; pre.appendChild(btn);
    });
    msgDiv.querySelectorAll('pre code').forEach(block => { if (typeof hljs !== 'undefined') hljs.highlightElement(block); });
    this.animateMessageIn(msgDiv);
    chatArea.scrollTop = chatArea.scrollHeight;
  },

  addImageToChat(image, provider, model) {
    const chatArea = document.getElementById('chat-area');
    const msgDiv = document.createElement('div');
    const imgId = `img-${Date.now()}`;
    const b64 = image.data;
    const mime = image.mimeType || 'image/png';
    const prompt = image.prompt || '';
    const isWallpaper = image.isWallpaper || false;

    msgDiv.className = 'message ai';
    msgDiv.innerHTML = `
      <div class="image-message">
        <div class="provider-badge openai">${provider || 'openai'} / ${model || 'DALL-E 3'}</div>
        <div class="image-container">
          <img id="${imgId}" src="data:${mime};base64,${b64}" alt="${this.escapeHtml(prompt)}" class="generated-image">
          <div class="image-actions">
            <button class="img-btn" onclick="AVIS.saveGeneratedImage('${imgId}')">&#128190; Save</button>
            ${isWallpaper ? `<button class="img-btn" onclick="AVIS.setGeneratedWallpaper('${imgId}')">&#128444; Set Wallpaper</button>` : ''}
            <button class="img-btn" onclick="AVIS.copyGeneratedImage('${imgId}')">&#128203; Copy</button>
          </div>
          ${prompt ? `<div class="image-prompt-label">${this.escapeHtml(prompt)}</div>` : ''}
        </div>
      </div>`;
    chatArea.appendChild(msgDiv);
    chatArea.scrollTop = chatArea.scrollHeight;

    // Store base64 on the img element for later retrieval
    const imgEl = document.getElementById(imgId);
    if (imgEl) imgEl.dataset.base64 = b64;
  },

  async saveGeneratedImage(imgId) {
    const imgEl = document.getElementById(imgId);
    if (!imgEl?.dataset.base64) return;
    const filename = `AVIS_Image_${Date.now()}.png`;
    const savePath = `${this._paths?.desktop || ''}/${filename}`;
    const result = await window.avis.saveImage({ base64: imgEl.dataset.base64, savePath });
    this.showToast(result.success ? `Saved: ${filename}` : `Save failed: ${result.error}`);
  },

  async setGeneratedWallpaper(imgId) {
    const imgEl = document.getElementById(imgId);
    if (!imgEl?.dataset.base64) return;
    const tmpPath = `${this._paths?.temp || ''}/avis_wallpaper.png`;
    await window.avis.saveImage({ base64: imgEl.dataset.base64, savePath: tmpPath });
    const result = await window.avis.setWallpaper(tmpPath);
    this.showToast(result.success ? 'Wallpaper set!' : `Failed: ${result.error}`);
  },

  async copyGeneratedImage(imgId) {
    const imgEl = document.getElementById(imgId);
    if (!imgEl?.dataset.base64) return;
    const result = await window.avis.copyImageClipboard(imgEl.dataset.base64);
    this.showToast(result.success ? 'Image copied to clipboard' : `Copy failed: ${result.error}`);
  },

  addCitationsToChat(citations) {
    const chatArea = document.getElementById('chat-area');
    const div = document.createElement('div');
    div.className = 'message ai';
    div.innerHTML = '<div class="message-bubble" style="font-size:12px;opacity:0.7;"><strong>Sources:</strong><br>' +
      citations.map((c, i) => `${i + 1}. <a href="${c}" target="_blank" style="color:var(--accent-blue);">${c}</a><br>`).join('') + '</div>';
    chatArea.appendChild(div);
  },

  showTyping() {
    const chatArea = document.getElementById('chat-area');
    const div = document.createElement('div');
    div.className = 'message ai typing-msg';
    div.innerHTML = '<div class="message-bubble"><div class="typing-indicator"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>';
    chatArea.appendChild(div);
    chatArea.scrollTop = chatArea.scrollHeight;
    return div;
  },

  // Streaming — live text display
  _streamBubble: null,

  createStreamBubble(provider) {
    const chatArea = document.getElementById('chat-area');
    // Remove typing indicator
    document.querySelectorAll('.typing-msg').forEach(el => el.remove());

    const div = document.createElement('div');
    div.className = 'message ai';
    div.innerHTML = `<div class="message-bubble"><div class="provider-badge claude">claude / streaming</div><div class="stream-content"></div><span class="stream-cursor">\u2588</span></div>`;
    chatArea.appendChild(div);
    this._streamBubble = div;
    chatArea.scrollTop = chatArea.scrollHeight;
    return div;
  },

  handleStreamChunk(chunk, fullText) {
    if (!this._streamBubble) this.createStreamBubble('claude');

    // Throttle DOM updates to ~60fps — batch rapid chunks into one render frame
    this._streamFullText = fullText;
    if (this._streamRafPending) return;
    this._streamRafPending = true;

    requestAnimationFrame(() => {
      this._streamRafPending = false;
      const contentEl = this._streamBubble?.querySelector('.stream-content');
      if (contentEl) {
        contentEl.innerHTML = this.renderMarkdown(this._streamFullText);
        this._streamBubble.querySelectorAll('pre code').forEach(block => {
          if (typeof hljs !== 'undefined' && !block.dataset.highlighted) {
            hljs.highlightElement(block);
            block.dataset.highlighted = 'true';
          }
        });
      }
      const chatArea = document.getElementById('chat-area');
      chatArea.scrollTop = chatArea.scrollHeight;
    });
  },

  finalizeStreamBubble(provider, model) {
    if (!this._streamBubble) return;
    // Remove cursor
    const cursor = this._streamBubble.querySelector('.stream-cursor');
    if (cursor) cursor.remove();
    // Update provider badge
    const badge = this._streamBubble.querySelector('.provider-badge');
    if (badge) badge.textContent = `${provider || 'claude'} / ${model || 'sonnet'}`;
    // Add copy buttons to code blocks
    this._streamBubble.querySelectorAll('pre').forEach(pre => {
      if (pre.querySelector('.code-copy-btn')) return;
      const btn = document.createElement('button');
      btn.className = 'code-copy-btn'; btn.textContent = 'Copy';
      btn.onclick = () => {
        navigator.clipboard.writeText(pre.querySelector('code')?.textContent || pre.textContent);
        btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 2000);
      };
      pre.style.position = 'relative'; pre.appendChild(btn);
    });
    this._streamBubble = null;
  },

  renderMarkdown(text) {
    if (typeof marked !== 'undefined') { marked.setOptions({ breaks: true, gfm: true }); return marked.parse(text); }
    return this.escapeHtml(text).replace(/\n/g, '<br>');
  },

  escapeHtml(text) { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; },

  // ====================================================================
  // Direct Chat — talk to any provider directly, bypassing orchestrator
  // ====================================================================
  _directChatResponse: '',

  async directChatSend() {
    const providerSelect = document.getElementById('direct-chat-provider');
    const input = document.getElementById('direct-chat-input');
    const statusEl = document.getElementById('direct-chat-status');
    const responseEl = document.getElementById('direct-chat-response');

    const prompt = input?.value?.trim();
    if (!prompt) return;

    const selected = providerSelect?.value || 'claude';
    if (statusEl) statusEl.textContent = `Asking ${selected}...`;
    if (responseEl) responseEl.innerHTML = '<span style="color:var(--text-secondary);">Thinking...</span>';

    // Map selection to provider name and model
    const map = {
      'claude': { provider: 'claude', model: 'claude-sonnet-4-20250514' },
      'claude-opus': { provider: 'claude', model: 'claude-opus-4-20250514' },
      'claude-haiku': { provider: 'claude', model: 'claude-haiku-4-5-20251001' },
      'openai': { provider: 'openai', model: 'gpt-4o' },
      'deepseek': { provider: 'deepseek', model: 'deepseek-chat' },
      'gemini': { provider: 'gemini', model: 'gemini-2.5-flash' },
      'mistral': { provider: 'mistral', model: 'mistral-large-latest' },
      'perplexity': { provider: 'perplexity', model: 'sonar-pro' }
    };

    const target = map[selected] || map['claude'];
    const start = Date.now();

    try {
      const result = await window.avis.apiCall({
        provider: target.provider,
        model: target.model,
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: 'You are a helpful AI assistant. Answer directly and concisely.',
        options: {}
      });

      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      if (result.error) {
        if (statusEl) statusEl.textContent = `\u2717 ${selected} error (${elapsed}s)`;
        if (responseEl) responseEl.textContent = Orchestrator.parseError(result.message);
      } else {
        this._directChatResponse = result.text;
        if (statusEl) statusEl.textContent = `\u2713 ${selected} / ${result.model || target.model} (${elapsed}s)`;
        if (responseEl) responseEl.innerHTML = this.renderMarkdown(result.text);
        if (result.inputTokens) {
          UsageMeter.record(target.provider, result.inputTokens, result.outputTokens || 0,
            Orchestrator.providerMap[target.provider]?.());
          this.renderMeters();
        }
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = `\u2717 ${err.message}`;
      if (responseEl) responseEl.textContent = err.message;
    }
  },

  // ====================================================================
  // Council Mode — Full center-panel multi-agent workspace
  // ====================================================================
  _councilRunning: false,

  async startCouncil() {
    const input = document.getElementById('council-input');
    const prompt = input?.value?.trim();
    if (!prompt || this._councilRunning) return;

    // Trigger council glow animation
    this._triggerSendGlow('council');

    this._councilRunning = true;
    input.value = '';

    const agents = document.getElementById('council-agents');
    const sendBtn = document.getElementById('council-send-btn');
    const stopBtn = document.getElementById('council-stop-btn');
    if (sendBtn) sendBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-flex';

    // Build the agent cards UI
    agents.innerHTML = `
      <div style="font-size:11px;color:var(--text-secondary);padding:4px 0;margin-bottom:4px;">
        <strong style="color:var(--accent-amber);">★ Task:</strong> ${prompt}
      </div>
      <div class="agent-card coordinator" id="agent-coordinator">
        <div class="agent-card-header">
          <span class="agent-card-name">Claude (Coordinator)</span>
          <span class="agent-card-status working" id="status-coordinator">PLANNING</span>
        </div>
        <div class="agent-card-output" id="output-coordinator">Analyzing task and assigning agents...</div>
      </div>
      <div id="agent-cards-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;"></div>
      <div class="agent-card synthesis" id="agent-synthesis" style="display:none;">
        <div class="agent-card-header">
          <span class="agent-card-name">★ Final Synthesis</span>
          <span class="agent-card-status working" id="status-synthesis">WAITING</span>
        </div>
        <div class="synthesis-output" id="output-synthesis"></div>
      </div>`;

    const start = Date.now();
    const statusEl = null; const responseEl = null; // not used in new UI
    // Reuse councilSend logic but with live card updates
    await this._runCouncilPipeline(prompt, start);
  },

  stopCouncil() {
    this._councilRunning = false;
    const sendBtn = document.getElementById('council-send-btn');
    const stopBtn = document.getElementById('council-stop-btn');
    if (sendBtn) sendBtn.style.display = '';
    if (stopBtn) stopBtn.style.display = 'none';
  },

  _updateAgentCard(id, status, output) {
    const statusEl = document.getElementById(`status-${id}`);
    const outputEl = document.getElementById(`output-${id}`);
    if (statusEl) { statusEl.className = `agent-card-status ${status}`; statusEl.textContent = status.toUpperCase(); }
    if (outputEl && output !== undefined) outputEl.innerHTML = output;
    const card = document.getElementById(`agent-${id}`);
    if (card) { card.className = card.className.replace(/working|done|error/g, '').trim() + ` ${status}`; }
  },

  _councilMaxRounds: 3,
  _councilQualityThreshold: 8,
  _councilProviderMap: {
    'GPT4': { provider: 'openai', model: 'gpt-4o', label: 'GPT-4o', color: '#10a37f' },
    'DEEPSEEK': { provider: 'deepseek', model: 'deepseek-chat', label: 'DeepSeek', color: '#4d6bfe' },
    'GEMINI': { provider: 'gemini', model: 'gemini-2.5-flash', label: 'Gemini', color: '#4285f4' },
    'PERPLEXITY': { provider: 'perplexity', model: 'sonar-pro', label: 'Perplexity', color: '#20b2aa' },
    'DALLE': { provider: 'openai', model: 'dall-e-3', label: 'DALL-E 3', color: '#ff6b6b' }
  },

  // Council file handling
  async councilAttachFile() {
    const filePath = await window.avis.openFileDialog();
    if (!filePath) return;
    try {
      const file = await window.avis.readFile(filePath);
      this._councilFiles = this._councilFiles || [];
      this._councilFiles.push(file);
      this._renderCouncilFilePreviews();
    } catch (err) { this.showToast(`Failed to read file: ${err.message}`); }
  },

  _renderCouncilFilePreviews() {
    const container = document.getElementById('council-file-preview');
    if (!container) return;
    container.innerHTML = (this._councilFiles || []).map((f, i) => {
      if (f.type === 'image') {
        return `<div style="position:relative;display:inline-block;">
          <img src="data:${f.mimeType || 'image/png'};base64,${f.data}" style="height:48px;border-radius:4px;border:1px solid var(--border);">
          <span onclick="AVIS._councilFiles.splice(${i},1);AVIS._renderCouncilFilePreviews();" style="position:absolute;top:-4px;right:-4px;background:var(--accent-red);color:#fff;width:14px;height:14px;border-radius:50%;font-size:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;">✕</span>
        </div>`;
      }
      return `<div style="padding:4px 8px;background:var(--bg-card);border-radius:4px;font-size:10px;color:var(--text-secondary);display:flex;align-items:center;gap:4px;">
        📄 ${f.name} <span onclick="AVIS._councilFiles.splice(${i},1);AVIS._renderCouncilFilePreviews();" style="color:var(--accent-red);cursor:pointer;">✕</span>
      </div>`;
    }).join('');
    container.style.display = this._councilFiles.length > 0 ? 'flex' : 'none';
  },

  // Copy agent card output
  copyAgentOutput(cardId) {
    const el = document.getElementById(`output-${cardId}`);
    if (el) {
      navigator.clipboard.writeText(el.innerText);
      this.showToast('Copied');
    }
  },

  // Dispatch a single agent task (reusable across rounds)
  async _dispatchAgent(key, task, prompt) {
    const p = this._councilProviderMap[key];
    if (!p) return { key, label: key, text: `[Unknown agent ${key}]`, error: true };

    if (key === 'DALLE') {
      try {
        const result = await window.avis.apiCall({
          provider: 'dalle', model: 'dall-e-3',
          messages: [{ role: 'user', content: task }],
          systemPrompt: '', options: { isDalle: true, prompt: task }
        });
        if (result.error) return { key, label: p.label, text: `[Image failed: ${result.message}]`, error: true };
        const b64 = result.image?.data || result.base64;
        return { key, label: p.label, text: `[Generated image: ${result.revisedPrompt || task}]`, imageData: b64, error: false };
      } catch (err) { return { key, label: p.label, text: `[Error: ${err.message}]`, error: true }; }
    }

    try {
      const apiKey = await window.avis.getApiKey(p.provider);
      if (!apiKey) return { key, label: p.label, text: `[${p.label} not configured]`, error: true };

      const result = await window.avis.apiCall({
        provider: p.provider, model: p.model,
        messages: [{ role: 'user', content: `Original task: ${prompt}\n\nYour assignment: ${task}\n\nProvide your contribution. Be thorough and detailed.` }],
        systemPrompt: `You are ${p.label}, part of an AI council. Focus on your assignment and deliver your best work.`,
        options: {}
      });

      if (result.error) return { key, label: p.label, text: `[Error: ${result.message}]`, error: true };
      return { key, label: p.label, text: result.text, error: false };
    } catch (err) { return { key, label: p.label, text: `[Error: ${err.message}]`, error: true }; }
  },

  // Create an agent card in the grid
  _addAgentCard(container, key, task, round) {
    const p = this._councilProviderMap[key];
    if (!p) return;
    const id = `${key.toLowerCase()}-r${round}`;
    container.insertAdjacentHTML('beforeend', `
      <div class="agent-card" id="agent-${id}">
        <div class="agent-card-header">
          <span style="width:8px;height:8px;border-radius:50%;background:${p.color};display:inline-block;"></span>
          <span class="agent-card-name">${p.label}</span>
          <span style="font-size:9px;color:var(--text-secondary);">R${round}</span>
          <span class="agent-card-status waiting" id="status-${id}">WAITING</span>
          <span onclick="AVIS.copyAgentOutput('${id}')" style="margin-left:auto;cursor:pointer;font-size:12px;opacity:0.5;transition:opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.5" title="Copy output">📋</span>
        </div>
        <div style="font-size:10px;color:var(--text-secondary);margin-bottom:6px;font-style:italic;">${task}</div>
        <div class="agent-card-output" id="output-${id}">Waiting...</div>
      </div>`);
    return id;
  },

  async _runCouncilPipeline(prompt, start) {
    this._councilPrompt = prompt;
    this._councilResults = [];
    const agents = document.getElementById('council-agents');

    // ===== ROUND 1: Plan + Execute =====
    const planResult = await window.avis.apiCall({
      provider: 'claude', model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: `You are the lead coordinator of an AI council. Specialists available:
- GPT4: Code, structured output, math, creative writing, formatting
- DEEPSEEK: Fast reasoning, logic, analysis, data processing
- GEMINI: Multimodal, long context, research synthesis
- PERPLEXITY: LIVE web access — current/real-time information, fact-checking
- DALLE: Image generation (DALL-E 3) — visuals, diagrams, illustrations

Analyze the task. Assign sub-tasks. Format EXACTLY:
PLAN: [overview]
ASSIGN_GPT4: [task or SKIP]
ASSIGN_DEEPSEEK: [task or SKIP]
ASSIGN_GEMINI: [task or SKIP]
ASSIGN_PERPLEXITY: [task or SKIP]
ASSIGN_DALLE: [image description or SKIP]

Assign 2+ AIs. For presentations/reports/visual tasks, always assign DALLE.`,
      options: {}
    });

    if (planResult.error) {
      this._updateAgentCard('coordinator', 'error', `Failed: ${planResult.message}`);
      this.stopCouncil();
      return;
    }

    this._updateAgentCard('coordinator', 'done', this.renderMarkdown(planResult.text));

    // Parse initial assignments
    const parseAssignments = (text, prefix) => {
      const a = {};
      for (const line of text.split('\n')) {
        const match = line.match(new RegExp(`^${prefix}(GPT4|DEEPSEEK|GEMINI|PERPLEXITY|DALLE):\\s*(.+)`, 'i'));
        if (match && match[2].trim().toUpperCase() !== 'SKIP') a[match[1].toUpperCase()] = match[2].trim();
      }
      return a;
    };

    let assignments = parseAssignments(planResult.text, 'ASSIGN_');
    if (Object.keys(assignments).length === 0) {
      document.getElementById('agent-synthesis').style.display = '';
      this._updateAgentCard('synthesis', 'done', this.renderMarkdown(planResult.text));
      this.stopCouncil();
      return;
    }

    let allResults = [];
    let synthesisText = '';
    let round = 1;
    let score = 0;

    // ===== MULTI-ROUND LOOP =====
    while (round <= this._councilMaxRounds && score < this._councilQualityThreshold) {
      // Add round header
      agents.insertAdjacentHTML('beforeend', `
        <div style="font-size:11px;font-weight:700;color:var(--accent-blue);padding:8px 0 4px;border-top:1px solid var(--border);margin-top:8px;">
          ROUND ${round}${round > 1 ? ' — Auto-fixing gaps' : ' — Initial execution'}
        </div>`);

      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;';
      agents.appendChild(grid);

      // Create cards and dispatch agents
      const dispatchPromises = Object.entries(assignments).map(async ([key, task]) => {
        const cardId = this._addAgentCard(grid, key, task, round);
        this._updateAgentCard(cardId, 'working', '<span style="color:var(--accent-blue);">Working...</span>');
        const result = await this._dispatchAgent(key, task, prompt);
        if (result.error) {
          this._updateAgentCard(cardId, 'error', result.text);
        } else if (result.imageData || result.imageUrl) {
          const src = result.imageUrl || `data:image/png;base64,${result.imageData}`;
          this._updateAgentCard(cardId, 'done', `<img src="${src}" style="max-width:100%;border-radius:6px;"><div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">${result.text}</div>`);
        } else {
          this._updateAgentCard(cardId, 'done', this.renderMarkdown(result.text));
        }
        return result;
      });

      const roundResults = (await Promise.allSettled(dispatchPromises)).map(r => r.value).filter(Boolean);
      allResults = [...allResults, ...roundResults];

      // Synthesize — cap each contribution, try/catch everything, live status
      const synthCard = document.getElementById('agent-synthesis');
      if (synthCard) synthCard.style.display = '';
      const synthStart = Date.now();
      const synthTimer = setInterval(() => {
        const sec = Math.round((Date.now() - synthStart) / 1000);
        this._updateAgentCard('synthesis', 'working', `<span style="color:var(--accent-blue);">Synthesizing (Round ${round})... ${sec}s</span>`);
      }, 1000);

      let synthResult;
      try {
        const contributions = allResults.filter(r => !r.error && r.text && !r.text.startsWith('[Generated image')).map(r => `=== ${r.label} ===\n${r.text.substring(0, 3000)}`).join('\n\n');
        const prevContext = round > 1 ? `\n\nPrevious draft (improve upon this — keep what works, fix what was flagged):\n${synthesisText.substring(0, 4000)}` : '';

        synthResult = await window.avis.apiCall({
          provider: 'claude', model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: `Task: ${prompt}\n\nSpecialist contributions:\n\n${contributions}${prevContext}\n\nSynthesize into a polished final response. Use markdown. Take the best from each contributor — don't repeat or pad. If contributors disagree, use the strongest-supported position.` }],
          systemPrompt: round > 1
            ? 'You are improving a draft. The review identified specific gaps — the new contributions address those gaps. Integrate fixes precisely without re-explaining unchanged sections. Be surgical.'
            : 'Synthesize multiple AI contributions into one authoritative response. Eliminate redundancy, resolve conflicts, preserve unique insights from each contributor. Quality over length.',
          options: {}
        });
      } catch (err) {
        synthResult = { error: true, message: err.message };
      }

      clearInterval(synthTimer);
      if (synthResult.error) {
        this._updateAgentCard('synthesis', 'error', `Synthesis failed: ${synthResult.message}`);
        break;
      }

      synthesisText = synthResult.text;
      this._councilLastResult = synthesisText;
      this._updateAgentCard('synthesis', 'done', `<span style="color:var(--accent-green);">Draft ready (Round ${round}) — ${Math.round((Date.now() - synthStart) / 1000)}s</span>`);

      // Review with Claude Opus
      const reviewerId = `reviewer-r${round}`;
      agents.insertAdjacentHTML('beforeend', `
        <div class="agent-card coordinator" id="agent-${reviewerId}" style="border-color:var(--accent-amber);">
          <div class="agent-card-header">
            <span class="agent-card-name">Claude Opus (Review — Round ${round})</span>
            <span class="agent-card-status working" id="status-${reviewerId}">REVIEWING</span>
          </div>
          <div class="agent-card-output" id="output-${reviewerId}"><span style="color:var(--accent-amber);">Evaluating quality... 0s</span></div>
        </div>`);

      const revStart = Date.now();
      const revTimer = setInterval(() => {
        const sec = Math.round((Date.now() - revStart) / 1000);
        const el = document.getElementById(`output-${reviewerId}`);
        if (el) el.innerHTML = `<span style="color:var(--accent-amber);">Evaluating quality... ${sec}s</span>`;
      }, 1000);

      let reviewResult;
      try {
        reviewResult = await window.avis.apiCall({
          provider: 'claude', model: 'claude-opus-4-20250514',
          messages: [{ role: 'user', content: `Task: ${prompt}\n\nDraft (Round ${round}):\n${synthesisText.substring(0, 6000)}\n\nScore 1-10. If below 8, assign fixes.\n\nSCORE: [1-10]\nSTRENGTHS: [brief]\nGAPS: [brief]\nFIX_GPT4: [task or NONE]\nFIX_DEEPSEEK: [task or NONE]\nFIX_GEMINI: [task or NONE]\nFIX_PERPLEXITY: [task or NONE]\nFIX_DALLE: [task or NONE]\nSUGGESTION_1: [improvement]\nSUGGESTION_2: [improvement]\nSUGGESTION_3: [improvement]` }],
          systemPrompt: `Quality reviewer, round ${round}/${this._councilMaxRounds}. Score honestly. Below 8 = assign FIX_ tasks. Be brief and structured.`,
          options: {}
        });
      } catch (err) {
        reviewResult = { error: true, message: err.message };
      }

      clearInterval(revTimer);
      let lastSuggestions = [];
      score = 8;

      if (reviewResult.error) {
        this._updateAgentCard(reviewerId, 'error', `Review failed: ${reviewResult.message} — proceeding with current draft`);
      } else {
        const reviewText = reviewResult.text;
        const scoreMatch = reviewText.match(/SCORE:\s*(\d+)/i);
        if (scoreMatch) score = parseInt(scoreMatch[1]);
        const suggMatches = reviewText.matchAll(/SUGGESTION_\d+:\s*(.+)/gi);
        for (const m of suggMatches) lastSuggestions.push(m[1].trim());

        const scoreColor = score >= 8 ? 'var(--accent-green)' : score >= 6 ? 'var(--accent-amber)' : 'var(--accent-red)';
        this._updateAgentCard(reviewerId, 'done',
          `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="font-size:20px;font-weight:700;color:${scoreColor};">${score}/10</span>
            <span style="font-size:11px;color:var(--text-secondary);">Round ${round} — ${Math.round((Date.now() - revStart) / 1000)}s</span>
          </div>` +
          `<div style="font-size:12px;color:var(--text-secondary);">${this.renderMarkdown(reviewText)}</div>`);

        this.terminalLog.push(`[COUNCIL] Round ${round} — Score: ${score}/10`);
        this.updateTerminal();

        // If score >= threshold or max rounds, break
        if (score >= this._councilQualityThreshold || round >= this._councilMaxRounds) break;

        // Parse FIX_ assignments for next round
        assignments = {};
        for (const line of reviewText.split('\n')) {
          const match = line.match(/^FIX_(GPT4|DEEPSEEK|GEMINI|PERPLEXITY|DALLE):\s*(.+)/i);
          if (match && match[2].trim().toUpperCase() !== 'NONE') {
            assignments[match[1].toUpperCase()] = match[2].trim();
          }
        }

        if (Object.keys(assignments).length === 0) break;

        // Pause and let the user choose: auto-apply fixes or manually amend
        const fixDescriptions = Object.entries(assignments).map(([k, v]) => `${k}: ${v}`);
        this._councilPendingAssignments = assignments;
        this._councilLoopState = { round, allResults, synthesisText, score, prompt, start };

        // Show fix options with Apply/Amend/Skip buttons
        const fixChoiceId = `fix-choice-r${round}`;
        agents.insertAdjacentHTML('beforeend', `
          <div class="agent-card" id="${fixChoiceId}" style="border-color:var(--accent-amber);background:rgba(255,180,0,0.04);">
            <div class="agent-card-header">
              <span class="agent-card-name" style="color:var(--accent-amber);">Fixes Recommended (${fixDescriptions.length})</span>
            </div>
            <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">
              ${fixDescriptions.map(f => `<div style="padding:3px 0;">• ${f}</div>`).join('')}
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button onclick="AVIS._councilContinueWithFixes()" style="flex:1;padding:10px;font-size:12px;font-weight:600;background:var(--accent-amber);color:#000;border:none;border-radius:6px;cursor:pointer;font-family:'JetBrains Mono',monospace;">APPLY FIXES</button>
              <button onclick="AVIS.councilForceAmend()" style="flex:1;padding:10px;font-size:12px;font-weight:600;background:var(--bg-card);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-family:'JetBrains Mono',monospace;">FORCE AMEND</button>
              <button onclick="AVIS._councilSkipFixes()" style="padding:10px 16px;font-size:12px;background:var(--bg-card);color:var(--text-secondary);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-family:'JetBrains Mono',monospace;">SKIP</button>
            </div>
          </div>`);

        // Stop the loop — user must click a button to continue
        this.stopCouncil();
        return;
      }

      break; // review failed, exit loop with current draft
    }

    // ===== FINAL PRESENTATION =====
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const aiNames = [...new Set(allResults.filter(r => !r.error).map(r => r.label))];
    const finalScoreColor = score >= 8 ? 'var(--accent-green)' : score >= 6 ? 'var(--accent-amber)' : 'var(--accent-red)';

    // Collect DALL-E images for gallery — with individual viewer
    const dalleImages = allResults.filter(r => !r.error && (r.imageData || r.imageUrl));
    this._councilImages = dalleImages; // store for viewer
    let imageGalleryHtml = '';
    if (dalleImages.length > 0) {
      imageGalleryHtml = `<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">
        <div style="font-size:11px;font-weight:600;color:var(--accent-blue);margin-bottom:8px;">Generated Images (click to view/analyze):</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(150px, 1fr));gap:8px;">
          ${dalleImages.map((img, i) => {
            const src = img.imageUrl || `data:image/png;base64,${img.imageData}`;
            return `<div style="position:relative;border-radius:6px;overflow:hidden;border:1px solid var(--border);cursor:pointer;transition:border-color 0.2s;" onclick="AVIS.councilViewImage(${i})" onmouseover="this.style.borderColor='var(--accent-blue)'" onmouseout="this.style.borderColor='var(--border)'">
              <img src="${src}" style="width:100%;display:block;">
              <div style="position:absolute;bottom:0;left:0;right:0;padding:6px 8px;background:rgba(0,0,0,0.8);display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:9px;color:#ccc;">${(img.text || 'Image').substring(0, 40)}</span>
                <span style="font-size:9px;color:var(--accent-blue);">View</span>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }

    // Collect suggestions from last reviewer output
    const reviewOutputs = document.querySelectorAll('[id^="output-reviewer-"]');
    let suggestions = [];
    if (reviewOutputs.length > 0) {
      const lastReview = reviewOutputs[reviewOutputs.length - 1].innerText || '';
      const suggMatches = lastReview.matchAll(/SUGGESTION_\d+:\s*(.+)/gi);
      for (const m of suggMatches) suggestions.push(m[1].trim());
    }

    // Build action buttons: Apply Fixes (if suggestions exist) + Force Amend (always)
    let actionButtonsHtml = `<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">`;

    // Apply All Fixes button — sends all suggestions back to coordinator
    if (suggestions.length > 0) {
      this._councilPendingFixes = suggestions;
      actionButtonsHtml += `
        <div style="font-size:11px;font-weight:600;color:var(--accent-amber);margin-bottom:8px;">Recommended Fixes (${suggestions.length}):</div>
        ${suggestions.map((s, i) => `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <button onclick="AVIS.councilRevise('${s.replace(/'/g, "\\'").substring(0, 200)}')" style="flex:1;text-align:left;padding:8px 10px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--accent-amber)'" onmouseout="this.style.borderColor='var(--border)'">${i+1}. ${s}</div>`).join('')}
        <button onclick="AVIS.councilApplyAllFixes()" style="width:100%;margin-top:8px;padding:10px;font-size:12px;font-weight:600;background:var(--accent-amber);color:#000;border:none;border-radius:6px;cursor:pointer;font-family:'JetBrains Mono',monospace;letter-spacing:0.5px;transition:opacity 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">APPLY ALL FIXES</button>`;
    }

    // Force Amend button — always available
    actionButtonsHtml += `
      <button onclick="AVIS.councilForceAmend()" style="width:100%;margin-top:8px;padding:10px;font-size:12px;font-weight:600;background:var(--bg-card);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-family:'JetBrains Mono',monospace;letter-spacing:0.5px;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--accent-blue)'" onmouseout="this.style.borderColor='var(--border)'">FORCE AMEND</button>
    </div>`;

    const suggestionsHtml = actionButtonsHtml;

    this._updateAgentCard('synthesis', 'done',
      `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <span style="font-size:11px;color:var(--text-secondary);">Claude + ${aiNames.join(' + ')}</span>
        <span style="font-size:11px;color:var(--text-secondary);">${round} round${round > 1 ? 's' : ''} — ${elapsed}s</span>
        <span style="font-size:13px;font-weight:700;color:${finalScoreColor};">${score}/10</span>
      </div>` +
      `<div class="synthesis-output">${this.renderMarkdown(synthesisText)}</div>` +
      imageGalleryHtml +
      suggestionsHtml +
      `<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">
        <div style="font-size:11px;font-weight:600;color:var(--accent-green);margin-bottom:8px;">📦 Ship It — Export Options:</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;" id="ship-buttons">
          ${['pptx|📊|PowerPoint','docx|📄|Word Doc','xlsx|📈|Excel','md|📝|Markdown','txt|📋|Plain Text','copy|📎|Clipboard'].map(s => {
            const [fmt, icon, label] = s.split('|');
            return `<div id="ship-${fmt}" style="padding:10px 8px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;text-align:center;transition:border-color 0.2s;" onclick="AVIS.councilShip('${fmt}')" onmouseover="this.style.borderColor='var(--accent-green)'" onmouseout="this.style.borderColor='var(--border)'">
              <div style="font-size:18px;">${icon}</div><div>${label}</div>
              <div id="ship-status-${fmt}" style="font-size:9px;margin-top:2px;min-height:12px;"></div>
            </div>`;
          }).join('')}
        </div>
      </div>`);

    // Terminal + history
    this.terminalLog.push(`[COUNCIL] Final: ${round} rounds, Score ${score}/10, ${elapsed}s`);
    this.updateTerminal();

    const histList = document.getElementById('council-history-list');
    if (histList) {
      const ts = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      histList.innerHTML = `<div style="padding:6px 8px;background:var(--bg-card);border-radius:4px;margin-bottom:4px;">
        <div style="font-size:11px;color:var(--text-primary);font-weight:600;">${prompt.substring(0, 40)}${prompt.length > 40 ? '...' : ''}</div>
        <div style="font-size:10px;color:var(--text-secondary);">${ts} — <span style="color:${finalScoreColor}">${score}/10</span> — ${round}R — ${elapsed}s</div>
      </div>` + (histList.innerHTML === 'No council tasks yet' ? '' : histList.innerHTML);
    }

    this.stopCouncil();
  },

  async councilRevise(suggestion) {
    if (this._councilRunning) return;
    this._councilRunning = true;
    const sendBtn = document.getElementById('council-send-btn');
    const stopBtn = document.getElementById('council-stop-btn');
    if (sendBtn) sendBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-flex';

    const agents = document.getElementById('council-agents');
    agents.insertAdjacentHTML('beforeend', `
      <div style="font-size:11px;font-weight:700;color:var(--accent-amber);padding:8px 0 4px;border-top:1px solid var(--border);margin-top:8px;">
        USER REVISION REQUEST
      </div>
      <div class="agent-card coordinator" id="agent-revision" style="border-color:var(--accent-blue);">
        <div class="agent-card-header">
          <span class="agent-card-name">Claude (Revision)</span>
          <span class="agent-card-status working" id="status-revision">REVISING</span>
        </div>
        <div class="agent-card-output" id="output-revision"><span style="color:var(--accent-blue);">Revising: ${suggestion.substring(0, 100)}...</span></div>
      </div>`);

    const revResult = await window.avis.apiCall({
      provider: 'claude', model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: `Original task: ${this._councilPrompt}\n\nCurrent output:\n${this._councilLastResult}\n\nRevision: ${suggestion}` }],
      systemPrompt: 'Produce the complete improved version incorporating the revision request. Use markdown.',
      options: {}
    });

    if (!revResult.error) {
      this._councilLastResult = revResult.text;
      this._updateAgentCard('revision', 'done', `<div class="synthesis-output">${this.renderMarkdown(revResult.text)}</div>
        <div style="display:flex;gap:6px;margin-top:10px;">
          <button onclick="AVIS.councilCopyResult()" style="flex:1;padding:8px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;">Copy</button>
          <button onclick="AVIS.councilExportResult()" style="flex:1;padding:8px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;">Export</button>
        </div>`);
    } else {
      this._updateAgentCard('revision', 'error', `Failed: ${revResult.message}`);
    }
    this.stopCouncil();
  },

  // Resume council loop after user chose to apply fixes
  async _councilContinueWithFixes() {
    if (this._councilRunning) return;
    const state = this._councilLoopState;
    const assignments = this._councilPendingAssignments;
    if (!state || !assignments) { this.showToast('No pending fixes'); return; }

    this._councilRunning = true;
    const sendBtn = document.getElementById('council-send-btn');
    const stopBtn = document.getElementById('council-stop-btn');
    if (sendBtn) sendBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-flex';

    // Resume the pipeline from where we left off
    let { round, allResults, synthesisText, score, prompt, start } = state;
    round++;

    const agents = document.getElementById('council-agents');

    // Run fix round
    agents.insertAdjacentHTML('beforeend', `
      <div style="font-size:11px;font-weight:700;color:var(--accent-amber);padding:8px 0 4px;border-top:1px solid var(--border);margin-top:8px;">
        ROUND ${round} — APPLYING FIXES
      </div>`);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;';
    agents.appendChild(grid);

    const dispatchPromises = Object.entries(assignments).map(async ([key, task]) => {
      const cardId = this._addAgentCard(grid, key, task, round);
      this._updateAgentCard(cardId, 'working', '<span style="color:var(--accent-blue);">Working...</span>');
      const result = await this._dispatchAgent(key, task, prompt);
      if (result.error) {
        this._updateAgentCard(cardId, 'error', result.text);
      } else if (result.imageData) {
        const src = `data:image/png;base64,${result.imageData}`;
        this._updateAgentCard(cardId, 'done', `<img src="${src}" style="max-width:100%;border-radius:6px;"><div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">${result.text}</div>`);
      } else {
        this._updateAgentCard(cardId, 'done', this.renderMarkdown(result.text));
      }
      return result;
    });

    const roundResults = (await Promise.allSettled(dispatchPromises)).map(r => r.value).filter(Boolean);
    allResults = [...allResults, ...roundResults];

    // Re-synthesize
    const contributions = allResults.filter(r => !r.error && r.text && !r.text.startsWith('[Generated image')).map(r => `=== ${r.label} ===\n${r.text.substring(0, 3000)}`).join('\n\n');

    const synthResult = await window.avis.apiCall({
      provider: 'claude', model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: `Task: ${prompt}\n\nSpecialist contributions:\n\n${contributions}\n\nPrevious draft (improve upon this — keep what works, fix what was flagged):\n${synthesisText.substring(0, 4000)}\n\nSynthesize into a polished final response. Use markdown.` }],
      systemPrompt: 'You are improving a draft. Integrate fixes precisely without re-explaining unchanged sections. Be surgical. Quality over length.',
      options: {}
    });

    if (!synthResult.error) {
      synthesisText = synthResult.text;
      this._councilLastResult = synthesisText;
    }

    // Show updated result with Force Amend option
    agents.insertAdjacentHTML('beforeend', `
      <div class="agent-card synthesis" id="agent-fix-result">
        <div class="agent-card-header">
          <span class="agent-card-name">Updated Synthesis (Round ${round})</span>
          <span class="agent-card-status done">DONE</span>
        </div>
        <div class="synthesis-output">${this.renderMarkdown(synthesisText)}</div>
        <div style="display:flex;gap:6px;margin-top:10px;">
          <button onclick="AVIS.councilCopyResult()" style="flex:1;padding:8px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;">Copy</button>
          <button onclick="AVIS.councilForceAmend()" style="flex:1;padding:8px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;">Force Amend</button>
        </div>
      </div>`);

    agents.scrollTop = agents.scrollHeight;
    this._councilLoopState = null;
    this._councilPendingAssignments = null;
    this.stopCouncil();
  },

  // Skip fixes — finalize with current draft
  _councilSkipFixes() {
    this._councilLoopState = null;
    this._councilPendingAssignments = null;
    this.showToast('Fixes skipped — using current draft');
  },

  // Apply all recommended fixes at once — sends all suggestions to coordinator
  async councilApplyAllFixes() {
    const fixes = this._councilPendingFixes;
    if (!fixes || fixes.length === 0) { this.showToast('No fixes to apply'); return; }
    if (this._councilRunning) return;
    this._councilRunning = true;

    const sendBtn = document.getElementById('council-send-btn');
    const stopBtn = document.getElementById('council-stop-btn');
    if (sendBtn) sendBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-flex';

    const agents = document.getElementById('council-agents');
    agents.insertAdjacentHTML('beforeend', `
      <div style="font-size:11px;font-weight:700;color:var(--accent-amber);padding:8px 0 4px;border-top:1px solid var(--border);margin-top:8px;">
        APPLYING ALL FIXES (${fixes.length})
      </div>
      <div class="agent-card coordinator" id="agent-allfixes" style="border-color:var(--accent-amber);">
        <div class="agent-card-header">
          <span class="agent-card-name">Claude (Coordinator — Applying Fixes)</span>
          <span class="agent-card-status working" id="status-allfixes">WORKING</span>
        </div>
        <div class="agent-card-output" id="output-allfixes"><span style="color:var(--accent-amber);">Integrating ${fixes.length} fixes...</span></div>
      </div>`);

    const fixList = fixes.map((f, i) => `${i + 1}. ${f}`).join('\n');
    const result = await window.avis.apiCall({
      provider: 'claude', model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: `Original task: ${this._councilPrompt}\n\nCurrent output:\n${this._councilLastResult}\n\nApply ALL of the following fixes:\n${fixList}\n\nProduce the complete improved version.` }],
      systemPrompt: 'You are revising a council output. Apply every fix listed. Produce the full corrected version in markdown. Do not skip any fix.',
      options: {}
    });

    if (!result.error) {
      this._councilLastResult = result.text;
      this._councilPendingFixes = [];
      this._updateAgentCard('allfixes', 'done', `<div class="synthesis-output">${this.renderMarkdown(result.text)}</div>
        <div style="display:flex;gap:6px;margin-top:10px;">
          <button onclick="AVIS.councilCopyResult()" style="flex:1;padding:8px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;">Copy</button>
          <button onclick="AVIS.councilForceAmend()" style="flex:1;padding:8px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;">Amend Further</button>
        </div>`);
    } else {
      this._updateAgentCard('allfixes', 'error', `Failed: ${result.message}`);
    }
    this.stopCouncil();
  },

  // Force Amend — user manually describes what to fix
  async councilForceAmend() {
    if (this._councilRunning) return;
    if (!this._councilLastResult) { this.showToast('No council result to amend'); return; }

    const input = document.getElementById('council-input');
    const amendment = input?.value?.trim();
    if (!amendment) {
      this.showToast('Type your correction in the input bar, then click Force Amend');
      input?.focus();
      return;
    }

    this._councilRunning = true;
    input.value = '';
    const sendBtn = document.getElementById('council-send-btn');
    const stopBtn = document.getElementById('council-stop-btn');
    if (sendBtn) sendBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-flex';

    const agents = document.getElementById('council-agents');
    agents.insertAdjacentHTML('beforeend', `
      <div style="font-size:11px;font-weight:700;color:var(--accent-blue);padding:8px 0 4px;border-top:1px solid var(--border);margin-top:8px;">
        FORCE AMEND
      </div>
      <div class="agent-card coordinator" id="agent-forceamend" style="border-color:var(--accent-blue);">
        <div class="agent-card-header">
          <span class="agent-card-name">Claude (Force Amendment)</span>
          <span class="agent-card-status working" id="status-forceamend">AMENDING</span>
        </div>
        <div class="agent-card-output" id="output-forceamend"><span style="color:var(--accent-blue);">Applying: ${amendment.substring(0, 100)}...</span></div>
      </div>`);

    const result = await window.avis.apiCall({
      provider: 'claude', model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: `Original task: ${this._councilPrompt}\n\nCurrent output:\n${this._councilLastResult}\n\nUSER CORRECTION (must be applied exactly):\n${amendment}\n\nProduce the complete corrected version.` }],
      systemPrompt: 'The user found mistakes in the council output. Apply their corrections exactly as described. Produce the full corrected version in markdown.',
      options: {}
    });

    if (!result.error) {
      this._councilLastResult = result.text;
      this._updateAgentCard('forceamend', 'done', `<div class="synthesis-output">${this.renderMarkdown(result.text)}</div>
        <div style="display:flex;gap:6px;margin-top:10px;">
          <button onclick="AVIS.councilCopyResult()" style="flex:1;padding:8px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;">Copy</button>
          <button onclick="AVIS.councilForceAmend()" style="flex:1;padding:8px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;">Amend Again</button>
        </div>`);
    } else {
      this._updateAgentCard('forceamend', 'error', `Failed: ${result.message}`);
    }
    this.stopCouncil();
  },

  // View a single DALL-E image full-size with analyze option
  councilViewImage(index) {
    const images = this._councilImages;
    if (!images || !images[index]) return;
    const img = images[index];
    const src = img.imageUrl || `data:image/png;base64,${img.imageData}`;
    const prompt = img.text || 'Generated image';

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'council-image-viewer';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;';
    overlay.innerHTML = `
      <div style="max-width:90vw;max-height:90vh;display:flex;flex-direction:column;align-items:center;gap:12px;">
        <img src="${src}" style="max-width:85vw;max-height:70vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);">
        <div style="font-size:12px;color:var(--text-secondary);max-width:600px;text-align:center;line-height:1.5;">${this.escapeHtml(prompt)}</div>
        <div style="display:flex;gap:8px;">
          ${index > 0 ? `<button onclick="AVIS.councilViewImage(${index - 1})" style="padding:8px 16px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;font-size:12px;">Prev</button>` : ''}
          <button onclick="AVIS.councilAnalyzeImage(${index})" style="padding:8px 16px;background:var(--accent-blue);border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:12px;font-weight:600;">Analyze</button>
          <button onclick="AVIS.councilSaveImage(${index})" style="padding:8px 16px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;font-size:12px;">Save</button>
          ${index < images.length - 1 ? `<button onclick="AVIS.councilViewImage(${index + 1})" style="padding:8px 16px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;font-size:12px;">Next</button>` : ''}
          <button onclick="document.getElementById('council-image-viewer')?.remove()" style="padding:8px 16px;background:var(--accent-red);border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:12px;">Close</button>
        </div>
        <div style="font-size:10px;color:var(--text-secondary);">${index + 1} of ${images.length}</div>
      </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // Replace existing viewer or add new
    document.getElementById('council-image-viewer')?.remove();
    document.body.appendChild(overlay);
  },

  // Analyze a single council image with Claude
  async councilAnalyzeImage(index) {
    const images = this._councilImages;
    if (!images || !images[index]) return;
    const img = images[index];

    document.getElementById('council-image-viewer')?.remove();
    this.showToast('Analyzing image...');

    const result = await window.avis.apiCall({
      provider: 'claude', model: 'claude-sonnet-4-20250514',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: img.imageData } },
          { type: 'text', text: `This image was generated by DALL-E 3 for the task: "${this._councilPrompt}"\nOriginal prompt: "${img.text}"\n\nAnalyze this image: describe what you see, assess quality, note any issues, and suggest improvements if regenerating.` }
        ]
      }],
      systemPrompt: 'You are an image analyst. Be specific and constructive.',
      options: {}
    });

    const agents = document.getElementById('council-agents');
    if (agents && !result.error) {
      agents.insertAdjacentHTML('beforeend', `
        <div class="agent-card" style="border-color:var(--accent-blue);">
          <div class="agent-card-header">
            <span class="agent-card-name">Image Analysis</span>
            <span class="agent-card-status done">DONE</span>
          </div>
          <div style="display:flex;gap:10px;">
            <img src="data:image/png;base64,${img.imageData}" style="width:120px;height:120px;object-fit:cover;border-radius:6px;flex-shrink:0;">
            <div class="agent-card-output" style="max-height:none;">${this.renderMarkdown(result.text)}</div>
          </div>
        </div>`);
      agents.scrollTop = agents.scrollHeight;
    } else if (result.error) {
      this.showToast('Analysis failed: ' + result.message);
    }
  },

  // Save a council image
  async councilSaveImage(index) {
    const images = this._councilImages;
    if (!images || !images[index]) return;
    const filename = `AVIS_Council_Image_${Date.now()}.png`;
    const savePath = `${this._paths?.desktop || ''}/${filename}`;
    const result = await window.avis.saveImage({ base64: images[index].imageData, savePath });
    this.showToast(result.success ? `Saved: ${filename}` : `Save failed: ${result.error}`);
  },

  _shipStatus(fmt, status, msg) {
    const el = document.getElementById(`ship-status-${fmt}`);
    if (!el) return;
    const colors = { working: 'var(--accent-blue)', done: 'var(--accent-green)', error: 'var(--accent-red)' };
    el.style.color = colors[status] || 'var(--text-secondary)';
    el.textContent = msg;
    const card = document.getElementById(`ship-${fmt}`);
    if (card) card.style.borderColor = status === 'done' ? 'var(--accent-green)' : status === 'error' ? 'var(--accent-red)' : '';
  },

  async councilShip(format) {
    if (!this._councilLastResult) { this.showToast('No result to export'); return; }

    if (format === 'copy') { this.councilCopyResult(); this._shipStatus('copy', 'done', 'Copied!'); return; }

    const title = (this._councilPrompt || 'Council Output').substring(0, 50).replace(/[^\w\s-]/g, '');
    const filename = `AVIS_Council_${title.replace(/\s+/g, '_')}`;

    if (format === 'md' || format === 'txt') {
      this._shipStatus(format, 'working', 'Saving...');
      const mime = format === 'md' ? 'text/markdown' : 'text/plain';
      const blob = new Blob([this._councilLastResult], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${filename}.${format}`; a.click();
      URL.revokeObjectURL(url);
      this._shipStatus(format, 'done', 'Saved!');
      return;
    }

    // PPTX, DOCX, XLSX — Claude structures, then generates
    this._shipStatus(format, 'working', 'AI structuring...');

    const formatPrompts = {
      pptx: {
        msg: `Convert to PowerPoint JSON. Return ONLY valid JSON.\n\nContent:\n${this._councilLastResult.substring(0, 8000)}\n\nFormat: {"slides":[{"elements":[{"type":"title","text":"...","x":0.5,"y":0.3,"fontSize":28,"color":"FFFFFF"},{"type":"text","text":"...","x":0.5,"y":1.2,"fontSize":14,"color":"CCCCCC"}],"background":{"fill":{"type":"solid","color":"0D1117"}}}],"options":{"title":"...","filename":"${filename}","author":"AVIS Council"}}`,
        sys: 'Convert to PowerPoint JSON. Dark backgrounds (0D1117), white text. 5-10 slides. Title first, then content. Return ONLY valid JSON.',
        gen: 'generatePptx'
      },
      docx: {
        msg: `Convert to Word document JSON. Return ONLY valid JSON.\n\nContent:\n${this._councilLastResult.substring(0, 8000)}\n\nFormat: {"content":[{"type":"heading","text":"...","level":1},{"type":"paragraph","text":"..."},{"type":"table","rows":[["H1","H2"],["d1","d2"]]}],"options":{"title":"...","filename":"${filename}","author":"AVIS Council"}}`,
        sys: 'Convert to Word JSON. Use headings, paragraphs, tables, page breaks. Include all content. Return ONLY valid JSON.',
        gen: 'generateDocx'
      },
      xlsx: {
        msg: `Convert to Excel JSON. Return ONLY valid JSON.\n\nContent:\n${this._councilLastResult.substring(0, 8000)}\n\nFormat: {"sheets":[{"name":"Sheet1","data":[["H1","H2"],["v1","v2"]],"colWidths":[20,30]}],"options":{"filename":"${filename}"}}`,
        sys: 'Convert to Excel JSON. Extract tables, data, lists into sheets. First row = headers. Return ONLY valid JSON.',
        gen: 'generateXlsx'
      }
    };

    const fp = formatPrompts[format];
    if (!fp) return;

    try {
      const structResult = await window.avis.apiCall({
        provider: 'claude', model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: fp.msg }],
        systemPrompt: fp.sys, options: {}
      });

      if (structResult.error) {
        this._shipStatus(format, 'error', structResult.message.substring(0, 30));
        return;
      }

      this._shipStatus(format, 'working', 'Generating file...');
      const data = JSON.parse(structResult.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
      const result = await window.avis[fp.gen](data);

      if (result.success) {
        this._shipStatus(format, 'done', 'Saved to Desktop!');
      } else {
        this._shipStatus(format, 'error', (result.error || 'Failed').substring(0, 30));
      }
    } catch (e) {
      this._shipStatus(format, 'error', e.message.substring(0, 30));
    }
  },

  councilCopyResult() {
    if (this._councilLastResult) {
      navigator.clipboard.writeText(this._councilLastResult);
      this.showToast('Council result copied');
    }
  },

  councilExportResult() {
    if (this._councilLastResult) {
      const blob = new Blob([this._councilLastResult], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'AVIS_Council_Result.md'; a.click();
      URL.revokeObjectURL(url);
    }
  },

  directChatCopy() {
    if (this._directChatResponse) {
      navigator.clipboard.writeText(this._directChatResponse);
      this.showToast('Copied to clipboard');
    }
  },

  directChatToMain() {
    if (this._directChatResponse) {
      const chatInput = document.getElementById('chat-input');
      chatInput.value = `Analyze this response from another AI:\n\n${this._directChatResponse.substring(0, 2000)}`;
      chatInput.focus();
      this.switchToTab('providers');
    }
  },

  openInBrowser(url) {
    // Legacy — redirect to search
    this.switchToTab('search');
    const input = document.getElementById('search-input');
    if (input) { input.value = url; this.doSearch(url); }
  },

  switchToTab(tabName) {
    const tab = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
    if (tab) tab.click();
  },

  updateProviderStatus() {
    const list = document.getElementById('provider-status-list');
    const providers = [
      { obj: ClaudeProvider, key: 'claude' }, { obj: DeepSeekProvider, key: 'deepseek' },
      { obj: OpenAIProvider, key: 'openai' }, { obj: GeminiProvider, key: 'gemini' },
      { obj: MistralProvider, key: 'mistral' },
      { obj: PerplexityProvider, key: 'perplexity' },     ];
    list.innerHTML = providers.map(p => {
      const isClaude = p.key === 'claude';
      const health = this.providerHealth[p.key];
      const healthLabel = health?.reason && health.reason !== 'ACTIVE' && health.reason !== 'NOT SET' ? health.reason : '';
      const dotClass = health?.status || p.obj.status;
      const statusLabel = isClaude && p.obj.status === 'active' ? '\uD83D\uDC51 ORCHESTRATOR' : '';
      return `
      <div class="provider-item${isClaude ? ' provider-orchestrator' : ''}">
        <div class="provider-dot ${dotClass}"></div>
        <span class="provider-name">${p.obj.displayName}</span>
        <span class="provider-model">${p.obj.getCurrentModel().name}</span>
        ${statusLabel ? `<span class="orchestrator-badge">${statusLabel}</span>` : ''}
        ${healthLabel ? `<span class="provider-status-label">${healthLabel}</span>` : ''}
      </div>`;
    }).join('');
    const globalDot = document.getElementById('global-status');
    const hasActive = providers.some(p => p.obj.status === 'active');
    globalDot.style.background = hasActive ? 'var(--accent-green)' : 'var(--accent-red)';
    globalDot.style.boxShadow = hasActive ? '0 0 6px var(--accent-green)' : '0 0 6px var(--accent-red)';
  },

  renderMeters() {
    const container = document.getElementById('meters-container');
    const providers = [
      { obj: ClaudeProvider, key: 'claude' }, { obj: DeepSeekProvider, key: 'deepseek' },
      { obj: OpenAIProvider, key: 'openai' }, { obj: GeminiProvider, key: 'gemini' },
      { obj: MistralProvider, key: 'mistral' },
      { obj: PerplexityProvider, key: 'perplexity' },     ];
    container.innerHTML = providers.map(p => {
      const u = UsageMeter.providers[p.key];
      const pct = UsageMeter.getUsagePercent(p.key);
      const bar = pct >= 80 ? 'red' : pct >= 50 ? 'amber' : 'green';
      const st = p.obj.status === 'active' ? 'ACTIVE' : p.obj.status === 'limited' ? 'RATE LIMITED' : p.obj.status === 'stepped-down' ? 'STEPPED DOWN' : p.obj.status === 'offline' ? 'OFFLINE' : 'NOT SET';
      const sc = p.obj.status === 'active' ? 'var(--accent-green)' : p.obj.status === 'limited' ? 'var(--accent-amber)' : p.obj.status === 'offline' ? 'var(--accent-red)' : 'var(--text-secondary)';
      const budgetText = u.budgetLimit > 0 ? `$${u.monthCost.toFixed(2)} / $${u.budgetLimit}` : `$${u.monthCost.toFixed(2)}`;
      const budgetColor = pct >= 90 ? 'var(--accent-red)' : pct >= 70 ? 'var(--accent-amber)' : 'var(--text-secondary)';
      const cacheStats = typeof ResponseCache !== 'undefined' ? ResponseCache.stats() : { size: 0 };
      return `<div class="meter-card"><div class="meter-header"><span class="meter-provider">${p.obj.displayName}</span><span class="meter-status" style="color:${sc};">&#9679; ${st}</span></div><div class="meter-model">${p.obj.getCurrentModel().name}</div><div class="meter-bar-wrap"><div class="meter-bar ${bar}" style="width:${pct}%"></div></div><div class="meter-stats"><div class="meter-stat">Budget: <span class="value" style="color:${budgetColor}">${budgetText}</span></div><div class="meter-stat">Session: <span class="value">${UsageMeter.formatCost(u.sessionCost)}</span></div><div class="meter-stat">In: <span class="value">${UsageMeter.formatTokens(u.sessionTokensIn)}</span></div><div class="meter-stat">Out: <span class="value">${UsageMeter.formatTokens(u.sessionTokensOut)}</span></div></div><button class="meter-reset" onclick="AVIS.resetMeter('${p.key}')">Reset</button></div>`;
    }).join('');
  },
  resetMeter(p) { UsageMeter.resetSession(p); this.renderMeters(); },

  async loadHistoryList() {
    const dates = await MemoryManager.listHistory();
    const list = document.getElementById('history-list');
    if (!dates.length) { list.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:20px;">No history yet</div>'; return; }
    let html = '';
    for (const date of dates.slice(0, 30)) {
      const data = await MemoryManager.loadConversation(date);
      if (data?.conversations) for (const conv of data.conversations) {
        html += `<div class="history-item" onclick="AVIS.restoreConversation('${date}','${conv.id}')"><div class="date">${date}</div><div class="preview">${conv.title || 'Untitled'}</div></div>`;
      }
    }
    list.innerHTML = html || '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:20px;">No history yet</div>';
    document.getElementById('history-search')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.history-item').forEach(item => { item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none'; });
    });
  },

  async restoreConversation(date, convId) {
    const conv = await MemoryManager.loadConversation(date, convId);
    if (!conv) return;
    document.getElementById('chat-area').innerHTML = '';
    for (const msg of conv.messages) this.addMessageToChat(msg.role === 'assistant' ? 'ai' : 'user', msg.content, msg.provider, msg.model);
    MemoryManager.currentConversation = conv;
  },

  async newConversation() {
    await MemoryManager.startNewConversation();
    const name = HotConfig.get('appName') || 'AVIS';
    document.getElementById('chat-area').innerHTML = `
      <div class="welcome-msg" id="welcome-msg">
        <canvas id="welcome-particles" class="welcome-particles"></canvas>
        <div class="welcome-content">
          <div class="big-logo glow-text">${name}</div>
          <div class="welcome-tagline">Avel Intelligence Services</div>
          <div class="welcome-version">v2.6.3</div>
          <div class="welcome-divider"></div>
          <div class="welcome-features">
            <div class="welcome-feature"><span class="wf-icon">&#129504;</span> Multi-AI Orchestration</div>
            <div class="welcome-feature"><span class="wf-icon">&#127760;</span> Web Search &amp; Browser</div>
            <div class="welcome-feature"><span class="wf-icon">&#9889;</span> Code Execution</div>
            <div class="welcome-feature"><span class="wf-icon">&#128193;</span> File System Access</div>
            <div class="welcome-feature"><span class="wf-icon">&#128421;</span> Computer Control</div>
          </div>
          <p class="welcome-hint">Type a message to begin</p>
        </div>
      </div>`;
    this.initParticles();
    await this.loadHistoryList();
  },

  // ====================================================================
  // Search tab — cascading fallback: Perplexity → Brave → DuckDuckGo → SearXNG
  // ====================================================================
  async doSearch(queryOverride) {
    const input = document.getElementById('search-input');
    const query = queryOverride || (input ? input.value.trim() : '');
    if (!query) return;

    const el = document.getElementById('search-results');
    const statusEl = document.getElementById('search-status');
    el.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:20px;">Searching...</div>';
    if (statusEl) statusEl.textContent = '';

    let results = null;
    let source = '';

    // 1. Perplexity (if configured)
    if (await Orchestrator.hasProvider('perplexity')) {
      try {
        if (statusEl) statusEl.textContent = 'Trying Perplexity...';
        const r = await Orchestrator.directCall('perplexity', query, []);
        if (!r.error && r.text) {
          el.innerHTML = `<div class="search-card"><div class="title">\uD83D\uDD0D ${this.escapeHtml(query)}</div><div class="snippet">${this.renderMarkdown(r.text)}</div>
            ${r.citations ? '<div class="source">' + r.citations.map(c => `<a href="${c}" style="color:var(--accent-blue);font-size:10px;" target="_blank">${c}</a>`).join('<br>') + '</div>' : ''}
            <div style="margin-top:6px;"><button class="action-btn" onclick="AVIS.injectSearchResult(this.closest('.search-card').querySelector('.snippet').textContent)">Send to Chat</button></div>
          </div>`;
          if (statusEl) statusEl.textContent = 'via Perplexity';
          this.renderMeters();
          return;
        }
      } catch (e) { /* fall through */ }
    }

    // 2. SearXNG (always available, no key — returns real diverse web results)
    if (!results) {
      try {
        if (statusEl) statusEl.textContent = 'Trying SearXNG...';
        const searxResults = await window.avis.searxSearch(query);
        if (searxResults?.length) { results = searxResults; source = 'SearXNG'; }
      } catch (e) { /* fall through */ }
    }

    // 4. DuckDuckGo instant answer (always available, may return wiki-heavy results)
    if (!results) {
      try {
        if (statusEl) statusEl.textContent = 'Trying DuckDuckGo...';
        const ddgResults = await window.avis.ddgSearch(query);
        if (ddgResults?.length) { results = ddgResults; source = 'DuckDuckGo'; }
      } catch (e) { /* fall through */ }
    }

    // Render results
    if (results && results.length > 0) {
      if (statusEl) statusEl.textContent = `${results.length} results via ${source}`;
      el.innerHTML = `<div style="font-size:11px;color:var(--accent-blue);margin-bottom:8px;font-family:'JetBrains Mono',monospace;">\uD83D\uDD0D Results for "${this.escapeHtml(query)}"</div>` +
        results.map(r => `
          <div class="search-card">
            <div class="title">${this.escapeHtml(r.title || 'Untitled')}</div>
            ${r.url ? `<div class="result-url">${this.escapeHtml(r.url)}</div>` : ''}
            <div class="snippet">${this.escapeHtml(r.snippet || '')}</div>
            <div style="margin-top:6px;">
              ${r.url ? `<button class="action-btn secondary" onclick="AVIS.openInBrowser('${this.escapeHtml(r.url).replace(/'/g, "\\'")}')">Open in Browser</button>` : ''}
              ${r.url ? `<button class="action-btn" onclick="AVIS.readUrlWithAI('${this.escapeHtml(r.url).replace(/'/g, "\\'")}', '${this.escapeHtml(r.title || '').replace(/'/g, "\\'")}')">Read with AI</button>` : ''}
            </div>
          </div>
        `).join('');
    } else {
      if (statusEl) statusEl.textContent = 'No results found';
      el.innerHTML = '<div style="color:var(--accent-amber);padding:12px;font-size:12px;">No results found. All search providers returned empty results.</div>';
    }
  },

  async readUrlWithAI(url, title) {
    // Fetch the URL and send content to chat for Claude to analyze
    this.switchToTab('providers');
    const chatInput = document.getElementById('chat-input');
    chatInput.value = `Please read and summarize this page: ${title || url}\nURL: ${url}`;
    chatInput.focus();
    this.sendMessage();
  },

  injectSearchResult(text) { document.getElementById('chat-input').value = text; document.getElementById('chat-input').focus(); },

  openSettings() { HotConfig.renderSettings(); document.getElementById('settings-overlay').classList.add('open'); },
  closeSettings() { document.getElementById('settings-overlay').classList.remove('open'); },
  async resetSettings() { if (confirm('Reset all settings to defaults?')) { await HotConfig.reset(); HotConfig.renderSettings(); } },
  async exportConfig() { await window.avis.exportConfig(); },
  async importConfig() { const c = await window.avis.importConfig(); if (c) { HotConfig.config = c; HotConfig.apply(); HotConfig.renderSettings(); } },

  showOnboarding() {
    document.getElementById('onboarding-overlay').style.display = 'flex';
    const providers = [
      { key: 'claude', label: 'Anthropic (Claude)', placeholder: 'sk-ant-...' },
      { key: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
      { key: 'gemini', label: 'Google Gemini', placeholder: 'AI...' },
      { key: 'mistral', label: 'Mistral', placeholder: 'API key...' },
      { key: 'perplexity', label: 'Perplexity', placeholder: 'pplx-...' },
      { key: 'deepseek', label: 'DeepSeek', placeholder: 'sk-...' },
    ];
    document.getElementById('onboarding-steps').innerHTML = providers.map(p => `
      <div class="onboarding-step"><span class="provider-label">${p.label}</span>
      <input type="password" id="onboard-${p.key}" placeholder="${p.placeholder}">
      <button class="test-btn" id="onboard-test-${p.key}" onclick="AVIS.testOnboardProvider('${p.key}')">Test</button></div>`).join('');
  },

  async testOnboardProvider(provider) {
    const input = document.getElementById(`onboard-${provider}`);
    const btn = document.getElementById(`onboard-test-${provider}`);
    const key = input.value.trim();
    if (!key) { btn.textContent = 'Skip'; return; }
    btn.textContent = '...';
    const result = await window.avis.testProvider(provider, key);
    if (result.success) {
      btn.textContent = '\u2713';
      btn.className = 'test-btn success';
      btn.title = 'Connected';
      await window.avis.setApiKey(provider, key);
    } else {
      const errMsg = this.parseTestError(result.error || '');
      btn.textContent = '\u2717';
      btn.className = 'test-btn fail';
      btn.title = errMsg;
      // Show error inline
      let errEl = btn.parentElement.querySelector('.test-error');
      if (!errEl) { errEl = document.createElement('div'); errEl.className = 'test-error'; btn.parentElement.appendChild(errEl); }
      errEl.textContent = errMsg;
    }
  },

  async finishOnboarding() {
    for (const p of ['claude', 'deepseek', 'openai', 'gemini', 'mistral', 'perplexity']) {
      const input = document.getElementById(`onboard-${p}`);
      if (input?.value.trim()) await window.avis.setApiKey(p, input.value.trim());
    }
    await window.avis.completeOnboarding();
    document.getElementById('onboarding-overlay').style.display = 'none';
    await this.detectProviders();
    this.renderMeters();
  },

  // ====================================================================
  // Changelog
  // ====================================================================
  CHANGELOG: [
    {
      version: '4.4.0', date: '2026-04-02', label: 'latest',
      items: [
        'GSAP-animated startup sequence with neural network icon and boot lines',
        'Startup sound (AVIS Echoes) plays during boot animation',
        'Sound system — send whoosh, receive chime, error tone with Web Audio fallback',
        'GSAP micro-animations — message slide-in, send button press, tab transitions, step panels',
        'Animated GIF indicators — connection, calendar, internet, dollar, settings',
        'Lottie.js + GSAP loaded for future animation expansion'
      ]
    },
    {
      version: '4.3.0', date: '2026-04-02',
      items: [
        'Chrome MCP integration — full browser automation via Claude in Chrome extension',
        'Browser Agent — auto-detects browser tasks and executes step-by-step with recovery',
        'Workflow Recorder — save and replay successful browser workflows',
        'Smart model selection per browser task (Haiku/Sonnet/Opus)',
        'Chrome status indicator in left panel with live connection polling',
        'Firecrawl fallback when Chrome extension not connected',
        'Improved titlebar clock — compact two-line date/time display',
        'Delegation Protocol now routes URLs and web tasks to Chrome Agent first'
      ]
    },
    {
      version: '4.2.0', date: '2026-04-02',
      items: [
        'Claude Code: folder-only project picker — no file selection required',
        'Claude Code: fixed shell quoting and stdin issues for reliable task execution',
        'OneDrive-aware desktop path resolution for file operations',
        'Beautified Claude Code panel with proper styling and gradient accents',
        'Theme-aware glow animation on Send and Council buttons',
        'Response cache wired up — repeated questions answered instantly (1hr TTL)',
        'Smart tool selection by task type — 60-80% smaller tool payloads',
        'Stream rendering throttled to 60fps for smoother output',
        'Stop button now instantly kills streaming responses',
        'Single-instance lock — duplicate app launches auto-close',
        'Removed unused dependencies (dayjs, uuid)',
        'Council input bar now matches main chat style'
      ]
    },
    {
      version: '4.1.1', date: '2026-03-31',
      items: [
        'Claude Code permission lock system',
        'Master key controls for standard user permissions',
        'Claude rate limit monitoring'
      ]
    },
    {
      version: '3.1.0', date: '2026-03-31',
      items: [
        'Fixed tab navigation (History, Search, Direct, Terminal, Changes)',
        'Fixed blank UI on startup (license race condition)',
        'Removed weather API (unused)',
        'Removed Grok provider (was unreliable)',
        'Cleaned up dead code and unused settings',
        'Firecrawl API verification added',
        'All users prompted to re-enter API keys on update',
        'Stable branch + git tags for safe rollbacks'
      ]
    },
    {
      version: '2.6.0', date: '2026-03-30',
      items: [
        'AVIS now knows the real date and time (injected every message)',
        'Live clock in the titlebar',
        'All file paths now work on any computer (not just yours)',
        '6 providers: Claude, GPT-4, Gemini, DeepSeek, Mistral, Perplexity'
      ]
    },
    {
      version: '2.5.0', date: '2026-03-30', label: 'major',
      items: [
        'Image generation now uses DALL-E 3 (higher quality)',
        'Removed Stability AI — DALL-E handles all images',
        'Resolution picker: Square, Wide, or Tall',
        'Copy any prompt by hovering over your message',
        'Copy Chat History button in right panel'
      ]
    },
    {
      version: '2.3.0', date: '2026-03-30',
      items: [
        'Generated images display directly in chat',
        'Save, Set as Wallpaper, and Copy buttons on images',
        'Wallpaper requests auto-optimize for desktop size',
        'Image requests from any provider route to DALL-E automatically'
      ]
    },
    {
      version: '2.2.0', date: '2026-03-30', label: 'major',
      items: [
        'License key system — enter your key to activate AVIS',
        'Keys are locked to one device for security',
        'Licenses can be managed remotely',
        'Works offline for 24 hours after activation'
      ]
    },
    {
      version: '2.1.0', date: '2026-03-30', label: 'major',
      items: [
        'If Claude goes down, AVIS automatically switches to another AI',
        'New Direct Chat tab — talk to any AI provider directly',
        'Pick from Claude, GPT-4, DeepSeek, Gemini,  Mistral, or Perplexity',
        'Copy responses or send them to the main chat'
      ]
    },
    {
      version: '2.0.0', date: '2026-03-30', label: 'major',
      items: [
        'Responses now stream in real-time (text types out live)',
        'Startup animation can be turned off in Settings',
        'Smarter conversation memory (keeps recent context, saves costs)',
        'Repeated questions answered instantly from cache'
      ]
    },
    {
      version: '1.8.0', date: '2026-03-30',
      items: [
        'Monthly spending limits per AI provider',
        'Spending tracker shows cost vs budget',
        'Layout customization: resize panels, compact mode',
        'Notifications no longer cover the message input'
      ]
    },
    {
      version: '1.7.0', date: '2026-03-30',
      items: [
        'Navigation tabs moved to the titlebar',
        'Cinematic startup animation',
        'Better computer control — can screenshot specific windows',
        'Can list all open applications'
      ]
    },
    {
      version: '1.6.0', date: '2026-03-30',
      items: [
        'Firecrawl support for reading websites',
        'Fixed layout issues where elements overlapped',
        'Auto-updates now work reliably',
        'Version number shown in titlebar',
        'API keys no longer lost after updates'
      ]
    },
    {
      version: '1.5.0', date: '2026-03-30',
      items: [
        'Copy, clear, and export tool logs',
        'AVIS checks if providers are working on startup',
        'Providers that hit rate limits auto-recover',
        'Smarter routing avoids broken providers'
      ]
    },
    {
      version: '1.0.0', date: '2026-03-30',
      items: [
        'First release of AVIS',
        'Multi-AI platform with Claude as the brain',
        'Web search, code execution, file access',
        'Computer control (screenshots, clicking, typing)',
        'Live thinking display shows what AVIS is doing',
        'Automatic updates'
      ]
    }
  ],

  renderChangelog() {
    const container = document.getElementById('changelog-container');
    if (!container) return;
    container.innerHTML = this.CHANGELOG.map((entry, i) => `
      <div class="changelog-entry" style="animation-delay:${i * 0.05}s;">
        <div class="changelog-version">
          <span class="ver-tag">v${entry.version}</span>
          <span class="ver-date">${entry.date}</span>
          ${entry.label ? `<span class="ver-label ${entry.label}">${entry.label}</span>` : ''}
        </div>
        <ul class="changelog-items">
          ${entry.items.map(item => `<li>${this.escapeHtml(item)}</li>`).join('')}
        </ul>
      </div>
    `).join('');
  },

  // ====================================================================
  // Welcome screen particles
  // ====================================================================
  initParticles() {
    const canvas = document.getElementById('welcome-particles');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const particles = [];
    let animFrame;

    function resize() {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.offsetWidth;
      canvas.height = parent.offsetHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Create particles
    for (let i = 0; i < 40; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.5 + 0.5,
        alpha: Math.random() * 0.4 + 0.1
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const style = getComputedStyle(document.documentElement);
      const color = style.getPropertyValue('--accent-blue').trim() || '#00a8ff';

      // Draw connecting lines
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.06 * (1 - dist / 120);
            ctx.lineWidth = 0.5;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw particles
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = p.alpha;
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      animFrame = requestAnimationFrame(draw);
    }

    draw();

    // Stop animation when welcome is removed
    const observer = new MutationObserver(() => {
      if (!document.getElementById('welcome-particles')) {
        cancelAnimationFrame(animFrame);
        observer.disconnect();
      }
    });
    observer.observe(document.getElementById('chat-area') || document.body, { childList: true, subtree: true });
  },

  // ====================================================================
  // Developer Panel
  // ====================================================================
  _devCurrentFile: null,
  _devConsoleLog: [],
  _devConsoleFilter: 'all',

  switchDevTab(tab) {
    document.querySelectorAll('.dev-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.dev-panel').forEach(p => p.classList.remove('active'));
    document.querySelector(`.dev-tab[onclick*="${tab}"]`)?.classList.add('active');
    document.getElementById(`dev-${tab}`)?.classList.add('active');

    if (tab === 'editor') this.loadDevFileTree();
    if (tab === 'licenses') this.loadLicensePanel();
    if (tab === 'cockpit') this.refreshCockpit();
  },

  // ================================================================
  // COCKPIT — Client Platform Management
  // ================================================================
  async refreshCockpit() {
    const grid = document.getElementById('cockpit-client-grid');
    if (!grid) return;

    // Get client list from IPC (scan directory)
    let clients = [];
    try {
      clients = await window.avis.clientList();
    } catch (e) {
      grid.innerHTML = '<span style="color:var(--accent-red);font-size:11px;">Could not load clients</span>';
      return;
    }

    if (clients.length === 0) {
      grid.innerHTML = '<span style="font-size:11px;color:var(--text-secondary);">No clients yet. Click "+ New Client" to start.</span>';
      return;
    }

    grid.innerHTML = '';
    for (const code of clients) {
      try {
        const profile = await ClientManager.getProfile(code);
        const finances = await ClientManager.getFinances(code);
        const monthSpending = await ClientManager.getMonthSpending(code);
        const alerts = await ClientManager.getAlerts(code);
        const pending = await ClientManager.getRecommendations(code, 'pending');

        const totalBudget = finances ? Object.values(finances.monthly_budget).reduce((s, v) => s + v, 0) : 0;
        const savings = finances?.accounts?.find(a => a.purpose === 'house_savings');
        const healthScore = ClientManager.getClientHealthScore(finances, monthSpending);

        const statusColor = healthScore >= 70 ? '#00ff88' : healthScore >= 40 ? '#ffa500' : '#ff4444';
        const themeColor = profile?.theme?.color_primary || '#888';

        const card = document.createElement('div');
        card.style.cssText = `background:var(--card-bg);border:1px solid var(--border-color);border-radius:8px;padding:10px;cursor:pointer;border-left:3px solid ${themeColor};`;
        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--text-primary);">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor};margin-right:4px;"></span>
                ${profile?.display_name || code} <span style="font-size:10px;color:var(--text-secondary);">${code}</span>
              </div>
              <div style="font-size:10px;color:var(--text-secondary);margin-top:2px;">
                Spent $${monthSpending.total.toFixed(0)} / $${totalBudget} this month
                ${savings ? ` · Saved $${savings.balance.toFixed(0)} / $${savings.target_balance}` : ''}
                ${pending.length > 0 ? ` · ${pending.length} pending recs` : ''}
                ${alerts.length > 0 ? ` · ⚠ ${alerts.length} alert(s)` : ''}
              </div>
            </div>
            <div style="display:flex;gap:4px;">
              <button class="dev-filter-btn" onclick="event.stopPropagation();AVIS.openCockpitDetail('${code}')" style="font-size:10px;">Details</button>
              <button class="dev-filter-btn" onclick="event.stopPropagation();AVIS.launchClientMode('${code}')" style="font-size:10px;background:${themeColor};color:#fff;">Launch</button>
            </div>
          </div>
        `;
        card.onclick = () => this.openCockpitDetail(code);
        grid.appendChild(card);
      } catch (e) {
        const errCard = document.createElement('div');
        errCard.style.cssText = 'font-size:11px;color:var(--accent-red);padding:6px;';
        errCard.textContent = `${code}: ${e.message}`;
        grid.appendChild(errCard);
      }
    }

    // Activity feed
    this.refreshCockpitActivity();
    this.refreshCockpitAlerts(clients);
  },

  async refreshCockpitActivity() {
    const feed = document.getElementById('cockpit-activity-feed');
    if (!feed) return;
    const events = await ClientManager.getActivityFeed(10);
    if (events.length === 0) {
      feed.innerHTML = '<span style="opacity:0.5">No recent activity</span>';
      return;
    }
    feed.innerHTML = events.map(e => {
      const time = new Date(e.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      return `<div style="padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05);">${e.message} <span style="opacity:0.4">${time}</span></div>`;
    }).join('');
  },

  async refreshCockpitAlerts(clients) {
    const alertsEl = document.getElementById('cockpit-alerts');
    if (!alertsEl) return;
    let allAlerts = [];
    for (const code of clients) {
      const alerts = await ClientManager.getAlerts(code);
      allAlerts.push(...alerts.map(a => ({ ...a, client: code })));
    }
    if (allAlerts.length === 0) {
      alertsEl.innerHTML = '<span style="color:#00ff88;">All clear ✓</span>';
      return;
    }
    alertsEl.innerHTML = allAlerts.map(a => {
      const color = a.severity === 'high' ? '#ff4444' : a.severity === 'medium' ? '#ffa500' : '#888';
      return `<div style="padding:3px 0;color:${color};">⚠ [${a.client}] ${a.message}</div>`;
    }).join('');
  },

  async launchClientMode(code) {
    if (confirm(`Switch to ${code} client mode? AVIS UI will transform.`)) {
      await this.enterClientMode(code);
    }
  },

  _cockpitDetailCode: null,

  async openCockpitDetail(code) {
    this._cockpitDetailCode = code;
    document.getElementById('cockpit-client-grid').style.display = 'none';
    document.getElementById('cockpit-detail').style.display = 'block';

    const profile = await ClientManager.getProfile(code);
    document.getElementById('cockpit-detail-name').textContent = `${profile?.display_name || code} (${code})`;

    this.switchCockpitTab('overview');
  },

  closeCockpitDetail() {
    document.getElementById('cockpit-detail').style.display = 'none';
    document.getElementById('cockpit-client-grid').style.display = 'flex';
    this._cockpitDetailCode = null;
  },

  async switchCockpitTab(tab) {
    const code = this._cockpitDetailCode;
    if (!code) return;

    // Update tab active state
    document.querySelectorAll('#cockpit-detail-tabs .dev-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`#cockpit-detail-tabs .dev-tab[onclick*="${tab}"]`)?.classList.add('active');

    const content = document.getElementById('cockpit-detail-content');
    if (!content) return;

    switch (tab) {
      case 'overview': {
        const profile = await ClientManager.getProfile(code);
        const finances = await ClientManager.getFinances(code);
        const monthSpending = await ClientManager.getMonthSpending(code);
        const remaining = await ClientManager.getRemainingBudget(code);
        const healthScore = ClientManager.getClientHealthScore(finances, monthSpending);

        const totalBudget = finances ? Object.values(finances.monthly_budget).reduce((s, v) => s + v, 0) : 0;
        const savings = finances?.accounts?.find(a => a.purpose === 'house_savings');
        const themeColor = profile?.theme?.color_primary || '#888';

        content.innerHTML = `
          <div style="display:flex;gap:12px;margin-bottom:10px;align-items:center;">
            <div style="width:40px;height:40px;border-radius:10px;background:${themeColor};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:16px;">${(profile?.display_name || '?')[0]}</div>
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--text-primary);">${profile?.display_name || code}</div>
              <div style="font-size:10px;color:var(--text-secondary);">Code: <span style="color:${themeColor};font-weight:700;">${code}</span> · Theme: ${profile?.theme?.name || 'None'} · Status: ${profile?.status || 'unknown'}</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
            <div style="background:var(--secondary-bg);border-radius:6px;padding:8px;">
              <div style="font-size:9px;text-transform:uppercase;opacity:0.5;margin-bottom:2px;">Health</div>
              <div style="font-size:16px;font-weight:700;color:${healthScore >= 70 ? '#00ff88' : healthScore >= 40 ? '#ffa500' : '#ff4444'};">${healthScore}/100</div>
            </div>
            <div style="background:var(--secondary-bg);border-radius:6px;padding:8px;">
              <div style="font-size:9px;text-transform:uppercase;opacity:0.5;margin-bottom:2px;">Plan Month</div>
              <div style="font-size:16px;font-weight:700;color:var(--text-primary);">${ClientManager.getPlanMonth(profile)} / ${profile?.plan_duration_months || 8}</div>
            </div>
            <div style="background:var(--secondary-bg);border-radius:6px;padding:8px;">
              <div style="font-size:9px;text-transform:uppercase;opacity:0.5;margin-bottom:2px;">This Month</div>
              <div style="font-size:16px;font-weight:700;color:var(--text-primary);">$${monthSpending.total.toFixed(0)} <span style="font-size:10px;opacity:0.5">/ $${totalBudget}</span></div>
            </div>
            <div style="background:var(--secondary-bg);border-radius:6px;padding:8px;">
              <div style="font-size:9px;text-transform:uppercase;opacity:0.5;margin-bottom:2px;">Savings</div>
              <div style="font-size:16px;font-weight:700;color:var(--text-primary);">$${savings?.balance || 0} <span style="font-size:10px;opacity:0.5">/ $${savings?.target_balance || 0}</span></div>
            </div>
          </div>
          <div>Income: $${profile?.income?.base_pay_monthly || 0}/month · Credit Score: ${finances?.credit_score || 'N/A'} → ${finances?.credit_score_target || 'N/A'}</div>
          ${finances?.debts?.length > 0 ? '<div style="margin-top:6px;font-weight:600;">Debts:</div>' + finances.debts.map(d => `<div>- ${d.name}: $${d.balance.toFixed(2)} ($${d.minimum_payment}/mo)</div>`).join('') : '<div style="margin-top:4px;color:#00ff88;">No debts ✓</div>'}
          <div style="margin-top:8px;font-weight:600;">Budget Remaining:</div>
          ${remaining ? Object.entries(remaining).filter(([k]) => k !== '_total').map(([cat, data]) =>
            `<div style="color:${data.remaining < 0 ? '#ff4444' : 'inherit'}">- ${cat}: $${data.spent.toFixed(0)} / $${data.limit} (${data.remaining >= 0 ? '$' + data.remaining.toFixed(0) + ' left' : '$' + Math.abs(data.remaining).toFixed(0) + ' OVER'})</div>`
          ).join('') : 'No data'}
          <div style="margin-top:10px;display:flex;gap:6px;">
            <button class="dev-save-btn" onclick="AVIS.launchClientMode('${code}')" style="background:${themeColor};border:none;flex:1;">Launch as ${profile?.display_name || code}</button>
            <button class="dev-save-btn" onclick="AVIS.switchCockpitTab('preview')" style="border:1px solid ${themeColor};background:transparent;color:${themeColor};">Preview</button>
          </div>
        `;
        break;
      }

      case 'preview': {
        const profile = await ClientManager.getProfile(code);
        if (!profile) { content.innerHTML = '<div>No client data</div>'; break; }

        const isActive = this._previewModeCode === code;
        const t = profile.theme || {};

        content.innerHTML = `
          <div style="text-align:center;padding:16px;">
            <div style="width:60px;height:60px;border-radius:50%;background:${t.color_primary || '#ff69b4'};margin:0 auto 10px;display:flex;align-items:center;justify-content:center;">
              ${ThemeManager?.getMascotSVG(t) ? `<div style="width:40px;">${ThemeManager.getMascotSVG(t)}</div>` : `<span style="font-size:24px;color:#fff;font-weight:800;">${(profile.display_name || '?')[0]}</span>`}
            </div>
            <div style="font-size:15px;font-weight:700;color:var(--text-primary);">${profile.display_name}'s Experience</div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">Theme: ${t.name || 'Default'} · Code: ${code}</div>
            <div style="margin-top:14px;">
              ${isActive
                ? `<button class="dev-save-btn" onclick="AVIS.exitPreviewMode()" style="background:#444;border:none;margin-right:6px;">Exit Preview</button>`
                : `<button class="dev-save-btn" onclick="AVIS.enterPreviewMode('${code}')" style="background:${t.color_primary || '#ff69b4'};border:none;">Preview as ${profile.display_name}</button>`
              }
            </div>
            <div style="font-size:10px;color:var(--text-secondary);margin-top:10px;opacity:0.6;">
              ${isActive ? 'Preview active — your AVIS is themed as this client. Dev menu stays accessible.' : 'This will reskin your AVIS to look exactly like this client\'s app. Dev menu stays open so you can still manage.'}
            </div>
          </div>
        `;
        break;
      }

      case 'spending': {
        const log = await ClientManager.getSpendingLog(code);
        const recent = log.entries.slice(-20).reverse();
        content.innerHTML = recent.length === 0 ? '<div style="opacity:0.5">No spending entries</div>' :
          '<table style="width:100%;font-size:11px;"><tr style="color:var(--text-secondary);"><th style="text-align:left;">Date</th><th style="text-align:left;">Category</th><th style="text-align:right;">Amount</th><th>Note</th></tr>' +
          recent.map(e => `<tr><td>${e.date}</td><td>${e.category}</td><td style="text-align:right;">$${e.amount.toFixed(2)}</td><td style="opacity:0.6">${e.note || ''}</td></tr>`).join('') +
          '</table>';
        break;
      }

      case 'recs': {
        const recs = await ClientManager.getRecommendations(code);
        content.innerHTML = `
          <div style="margin-bottom:8px;">
            <button class="dev-save-btn" onclick="AVIS.showPushRecForm('${code}')">+ Push Recommendation</button>
          </div>
          <div id="cockpit-rec-form-${code}" style="display:none;background:var(--secondary-bg);border-radius:6px;padding:8px;margin-bottom:8px;">
            <input id="rec-title-${code}" class="search-box" placeholder="Title" style="width:100%;margin-bottom:4px;">
            <textarea id="rec-body-${code}" class="search-box" placeholder="Message body..." style="width:100%;height:60px;resize:vertical;margin-bottom:4px;"></textarea>
            <select id="rec-type-${code}" class="search-box" style="width:100%;margin-bottom:4px;">
              <option value="informational">Informational</option>
              <option value="action_required">Action Required</option>
              <option value="decision">Decision</option>
              <option value="reflection">Reflection</option>
              <option value="celebration">Celebration</option>
            </select>
            <div style="display:flex;gap:4px;">
              <button class="dev-save-btn" onclick="AVIS.pushRecToClient('${code}')" style="flex:1;">Send</button>
              <button class="dev-filter-btn" onclick="document.getElementById('cockpit-rec-form-${code}').style.display='none'">Cancel</button>
            </div>
          </div>
          ${recs.length === 0 ? '<div style="opacity:0.5">No recommendations</div>' :
            recs.reverse().map(r => `
              <div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                <div style="font-weight:600;color:var(--text-primary);">${r.title}</div>
                <div style="font-size:10px;opacity:0.6;">${r.action_type} · ${r.status} · ${new Date(r.created_at).toLocaleDateString()}</div>
                <div style="margin-top:2px;">${r.body.substring(0, 100)}${r.body.length > 100 ? '...' : ''}</div>
                ${r.response ? `<div style="color:#00ff88;margin-top:2px;">Response: ${r.response}</div>` : ''}
              </div>
            `).join('')}
        `;
        break;
      }

      case 'notes': {
        const notes = await ClientManager.getCoachingNotes(code);
        content.innerHTML = `
          <div style="margin-bottom:8px;">
            <textarea id="cockpit-new-note" class="search-box" placeholder="Add coaching note..." style="width:100%;height:40px;resize:vertical;"></textarea>
            <button class="dev-save-btn" onclick="AVIS.addCockpitNote('${code}')" style="margin-top:4px;">Add Note</button>
          </div>
          ${notes.notes.reverse().map(n => `
            <div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
              <div style="font-size:10px;opacity:0.5;">${n.date} — ${n.author}</div>
              <div>${n.note}</div>
            </div>
          `).join('')}
        `;
        break;
      }

      case 'convos': {
        const convLog = await ClientManager.getConversationLog(code);
        const recent = convLog.messages.slice(-30);
        content.innerHTML = recent.length === 0 ? '<div style="opacity:0.5">No conversation history</div>' :
          recent.map(m => {
            const time = new Date(m.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            const color = m.role === 'user' ? '#ff69b4' : '#00a8ff';
            return `<div style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.03);">
              <span style="color:${color};font-weight:600;font-size:10px;">${m.role === 'user' ? 'Client' : 'Coach'}</span>
              <span style="opacity:0.3;font-size:9px;margin-left:4px;">${time}</span>
              <div style="margin-top:1px;">${this.escapeHtml(m.text?.substring(0, 200) || '')}${(m.text?.length || 0) > 200 ? '...' : ''}</div>
            </div>`;
          }).join('');
        break;
      }
    }
  },

  showPushRecForm(code) {
    const form = document.getElementById(`cockpit-rec-form-${code}`);
    if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
  },

  async pushRecToClient(code) {
    const title = document.getElementById(`rec-title-${code}`)?.value.trim();
    const body = document.getElementById(`rec-body-${code}`)?.value.trim();
    const actionType = document.getElementById(`rec-type-${code}`)?.value;
    if (!title || !body) { this.showToast('Title and body required', 'warning'); return; }

    const rec = await ClientManager.pushRecommendation(code, { title, body, action_type: actionType });
    if (rec) {
      this.showToast(`Recommendation pushed to ${code}`, 'success');
      document.getElementById(`cockpit-rec-form-${code}`).style.display = 'none';
      this.switchCockpitTab('recs');
    }
  },

  async addCockpitNote(code) {
    const noteEl = document.getElementById('cockpit-new-note');
    const note = noteEl?.value.trim();
    if (!note) return;
    await ClientManager.addCoachingNote(code, note);
    noteEl.value = '';
    this.showToast('Note added', 'success');
    this.switchCockpitTab('notes');
  },

  showNewClientForm() {
    const form = document.getElementById('cockpit-new-client');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';

    // Populate theme dropdown
    const select = document.getElementById('new-client-theme');
    if (select && select.children.length === 0 && typeof ThemeManager !== 'undefined') {
      const presets = ThemeManager.getPresetList();
      select.innerHTML = presets.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    }
  },

  async createNewClient() {
    const code = document.getElementById('new-client-code')?.value.trim().toUpperCase();
    const name = document.getElementById('new-client-name')?.value.trim();
    const themeId = document.getElementById('new-client-theme')?.value;

    if (!code || !name) { this.showToast('Code and name required', 'warning'); return; }
    if (!/^[A-Z]{3}-\d{3}$/.test(code)) { this.showToast('Code format: XXX-000 (e.g., NIY-001)', 'warning'); return; }

    // Create directory
    await window.avis.clientCreate(code);

    // Get theme preset
    const theme = ThemeManager?.getPreset(themeId) || ThemeManager?.PRESETS['corporate-clean'];

    // Write seed files
    const profile = {
      client_code: code, name, display_name: name,
      created_at: new Date().toISOString().split('T')[0],
      status: 'active', relationship_to_operator: 'client', operator_code: 'AVL-000',
      demographics: { lives_with: '', housing_costs: 0, insurance_covered_by: '' },
      income: { base_pay_monthly: 0, frequency: 'monthly', pay_dates: 'varies' },
      plan_start_date: new Date().toISOString().split('T')[0],
      plan_duration_months: 12, plan_end_date: '',
      theme, welcome_completed: false
    };

    const finances = {
      last_updated: new Date().toISOString().split('T')[0],
      credit_score: 0, credit_score_target: 0, credit_score_target_date: '',
      accounts: [], debts: [],
      monthly_budget: { food: 0, subscriptions: 0, shopping_personal: 0, gas_transport: 0, entertainment: 0, bills_utilities: 0, health_beauty: 0, gifts: 0, buffer: 0 },
      fixed_expenses: {}
    };

    await window.avis.clientWriteFile(code, 'profile.json', JSON.stringify(profile, null, 2));
    await window.avis.clientWriteFile(code, 'finances.json', JSON.stringify(finances, null, 2));
    await window.avis.clientWriteFile(code, 'spending_log.json', JSON.stringify({ entries: [] }));
    await window.avis.clientWriteFile(code, 'progress_log.json', JSON.stringify({ events: [{ date: new Date().toISOString().split('T')[0], type: 'plan_initiated', note: `Client ${name} created.` }] }));
    await window.avis.clientWriteFile(code, 'conversation_log.json', JSON.stringify({ messages: [] }));
    await window.avis.clientWriteFile(code, 'coaching_notes.json', JSON.stringify({ notes: [] }));
    await window.avis.clientWriteFile(code, 'recommendations.json', JSON.stringify({ recommendations: [] }));

    await ClientManager.registerClient(code);
    document.getElementById('cockpit-new-client').style.display = 'none';
    this.showToast(`Client ${code} created`, 'success');
    this.refreshCockpit();
  },

  // ================================================================
  // WEEKLY CHECK-IN AUTOMATION
  // ================================================================
  async generateWeeklyCheckIn() {
    let clients = [];
    try { clients = await window.avis.clientList(); } catch (e) { return; }

    for (const code of clients) {
      try {
        const profile = await ClientManager.getProfile(code);
        const finances = await ClientManager.getFinances(code);
        const weekSpending = await ClientManager.getWeekSpending(code);
        const monthSpending = await ClientManager.getMonthSpending(code);
        const remaining = await ClientManager.getRemainingBudget(code);

        if (!profile || !finances) continue;

        const totalBudget = Object.values(finances.monthly_budget).reduce((s, v) => s + v, 0);
        const savings = finances.accounts?.find(a => a.purpose === 'house_savings');
        const planMonth = ClientManager.getPlanMonth(profile);

        // Build prompt for Claude to generate the weekly summary
        const summaryPrompt = `Generate a weekly financial check-in summary for ${profile.display_name}. Keep it warm, conversational, 150-200 words. Celebrate wins, name challenges, suggest ONE specific action for next week.

DATA THIS WEEK:
- Week spending: $${weekSpending.total.toFixed(2)}
- Month spending so far: $${monthSpending.total.toFixed(2)} / $${totalBudget} budget
- Budget remaining: $${remaining?._total?.remaining?.toFixed(2) || 0}
- Savings balance: $${savings?.balance || 0} / $${savings?.target_balance || 0}
- Plan month: ${planMonth}
- Credit score: ${finances.credit_score}
- Categories this week: ${Object.entries(weekSpending.byCategory).map(([k,v]) => `${k}: $${v.toFixed(2)}`).join(', ') || 'none'}

Write as a warm friend, not a financial advisor. Use their name. End with a specific, actionable suggestion.`;

        // Call Claude for the summary
        const result = await window.avis.apiCall({
          provider: 'claude',
          model: 'claude-haiku-4-5-20251001',
          messages: [{ role: 'user', content: summaryPrompt }],
          systemPrompt: 'You are a warm, supportive financial coach. Write casual, encouraging weekly summaries. Keep it SHORT and specific to their numbers.',
          options: {}
        });

        if (result && !result.error) {
          const summaryText = result.text || result.content?.[0]?.text || '';

          // Log to progress
          await ClientManager.logProgress(code, 'weekly_checkin', summaryText.substring(0, 200));

          // Push as recommendation to client
          await ClientManager.pushRecommendation(code, {
            title: `Your week recap is ready! ✨`,
            body: summaryText,
            action_type: 'informational',
            priority: 'low'
          });

          // Save to monthly reports
          const now = new Date();
          const weekNum = Math.ceil(now.getDate() / 7);
          const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          const reportContent = `# Weekly Check-In — Week ${weekNum}\n**${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}**\n\n${summaryText}\n\n---\n*Auto-generated by AVIS Coach*`;

          await window.avis.clientWriteFile(code, `monthly_reports_week_${weekNum}_${monthStr}.md`, reportContent);
        }
      } catch (e) {
        console.warn(`Weekly check-in failed for ${code}:`, e.message);
      }
    }

    this.showToast('Weekly check-ins generated', 'success');
  },

  async loadDevFileTree() {
    const tree = document.getElementById('dev-file-tree');
    if (!tree) return;
    try {
      const files = await window.avis.devListFiles();
      tree.innerHTML = files.map(f =>
        `<button class="dev-file-btn${this._devCurrentFile === f ? ' active' : ''}" onclick="AVIS.openDevFile('${f}')">${f.split('/').pop()}</button>`
      ).join('');
    } catch (e) {
      tree.innerHTML = '<span style="font-size:10px;color:var(--accent-red);">Could not list files</span>';
    }
  },

  async openDevFile(relPath) {
    try {
      const result = await window.avis.devReadFile(relPath);
      if (result.error) { alert(result.error); return; }
      this._devCurrentFile = relPath;
      document.getElementById('dev-editor-filename').textContent = relPath;
      document.getElementById('dev-editor-area').value = result.content;
      // Highlight active button
      document.querySelectorAll('.dev-file-btn').forEach(b => b.classList.remove('active'));
      document.querySelector(`.dev-file-btn[onclick*="${relPath}"]`)?.classList.add('active');
    } catch (e) {
      alert('Failed to read file: ' + e.message);
    }
  },

  async saveEditorFile() {
    if (!this._devCurrentFile) { alert('No file selected'); return; }
    const content = document.getElementById('dev-editor-area').value;
    try {
      const result = await window.avis.devWriteFile(this._devCurrentFile, content);
      if (result.success) {
        const nameEl = document.getElementById('dev-editor-filename');
        nameEl.textContent = `${this._devCurrentFile} — saved!`;
        setTimeout(() => { nameEl.textContent = this._devCurrentFile; }, 2000);
        // Hot reload
        setTimeout(() => { try { window.avis.hotReload(); } catch (e) {} }, 300);
      }
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  },

  // ====================================================================
  // License Management Panel (Master key only)
  // ====================================================================
  async loadLicensePanel() {
    const list = document.getElementById('license-mgmt-list');
    if (!list) return;
    list.innerHTML = '<div style="color:var(--text-secondary);">Loading licenses...</div>';

    const result = await window.avis.listAllLicenses();
    if (result.error) {
      list.innerHTML = `<div style="color:var(--accent-red);">${result.error}</div>`;
      return;
    }

    const licenses = result.data.licenses || {};
    const entries = Object.entries(licenses);
    list.innerHTML = entries.map(([hash, lic]) => {
      const isActive = lic.status === 'active';
      const isMaster = lic.tier === 'master';
      const tierBadge = lic.tier === 'master' ? '&#9733; MASTER' : lic.tier === 'tester' ? '&#9881; TESTER' : '&#9679; STANDARD';
      const tierColor = lic.tier === 'master' ? 'var(--accent-amber)' : lic.tier === 'tester' ? 'var(--accent-blue)' : 'var(--text-secondary)';
      const statusColor = isActive ? 'var(--accent-green)' : 'var(--accent-red)';
      const deviceInfo = isMaster ? 'All devices' : lic.deviceId ? `Device: ${lic.deviceId.substring(0, 8)}...` : 'Not activated';
      const activatedAt = lic.activatedAt ? new Date(lic.activatedAt).toLocaleDateString() : '';

      return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-card);border-radius:6px;margin-bottom:4px;border:1px solid var(--border);">
        <div style="flex:1;">
          <div style="font-weight:600;color:var(--text-primary);font-size:13px;">${lic.owner}</div>
          <div style="font-size:10px;color:${tierColor};">${tierBadge}</div>
          <div style="font-size:10px;color:var(--text-secondary);margin-top:2px;">${deviceInfo}${activatedAt ? ' | ' + activatedAt : ''}</div>
        </div>
        <span style="font-size:11px;font-weight:600;color:${statusColor};">${lic.status.toUpperCase()}</span>
        ${isMaster ? '' : `<button onclick="AVIS.toggleLicense('${hash}', '${isActive ? 'revoked' : 'active'}')"
          style="padding:4px 10px;font-size:10px;border:1px solid ${isActive ? 'var(--accent-red)' : 'var(--accent-green)'};background:transparent;color:${isActive ? 'var(--accent-red)' : 'var(--accent-green)'};border-radius:4px;cursor:pointer;font-weight:600;">
          ${isActive ? 'REVOKE' : 'ACTIVATE'}
        </button>`}
      </div>`;
    }).join('');
  },

  async toggleLicense(hash, newStatus) {
    const action = newStatus === 'revoked' ? 'Revoke' : 'Activate';
    if (!confirm(`${action} this license?`)) return;

    const result = await window.avis.updateLicenseStatus(hash, newStatus);
    if (result.success) {
      this.showToast(`License ${newStatus === 'revoked' ? 'revoked' : 'activated'}`);
      this.loadLicensePanel();
    } else {
      this.showToast(`Failed: ${result.error}`);
    }
  },

  async applyPatch() {
    const patchText = document.getElementById('dev-patch-area')?.value || '';
    const logEl = document.getElementById('dev-patch-log');
    if (!patchText.trim()) { if (logEl) logEl.textContent = 'No patch content.'; return; }

    const lines = patchText.split('\n');
    let currentFile = null;
    let findText = null;
    let replaceText = null;
    let inReplace = false;
    let replaceLines = [];
    let findLines = [];
    let inFind = false;
    const ops = [];

    // Parse patch format
    for (const line of lines) {
      if (line.startsWith('// FILE:')) {
        if (currentFile && findText && replaceText) {
          ops.push({ file: currentFile, find: findText, replace: replaceText });
        }
        currentFile = line.replace('// FILE:', '').trim();
        findText = null; replaceText = null; inFind = false; inReplace = false; findLines = []; replaceLines = [];
      } else if (line.startsWith('// FIND:')) {
        inFind = true; inReplace = false;
        const inline = line.replace('// FIND:', '').trim();
        if (inline) findLines.push(inline);
      } else if (line.startsWith('// REPLACE_WITH:')) {
        findText = findLines.join('\n');
        inFind = false; inReplace = true;
        const inline = line.replace('// REPLACE_WITH:', '').trim();
        if (inline) replaceLines.push(inline);
      } else if (inFind) {
        findLines.push(line);
      } else if (inReplace) {
        replaceLines.push(line);
      }
    }
    if (currentFile && findLines.length > 0) {
      if (!findText) findText = findLines.join('\n');
      replaceText = replaceLines.join('\n');
      ops.push({ file: currentFile, find: findText, replace: replaceText });
    }

    if (ops.length === 0) {
      if (logEl) logEl.textContent = 'Could not parse patch. Use format:\n// FILE: src/js/file.js\n// FIND: old code\n// REPLACE_WITH:\nnew code';
      return;
    }

    let log = '';
    for (const op of ops) {
      try {
        const fileResult = await window.avis.devReadFile(op.file);
        if (fileResult.error) { log += `ERROR: ${op.file} — ${fileResult.error}\n`; continue; }
        if (!fileResult.content.includes(op.find)) { log += `ERROR: ${op.file} — FIND text not found\n`; continue; }
        const newContent = fileResult.content.replace(op.find, op.replace);
        await window.avis.devWriteFile(op.file, newContent);
        log += `OK: ${op.file} — patch applied\n`;
      } catch (e) {
        log += `ERROR: ${op.file} — ${e.message}\n`;
      }
    }

    log += '\nHot-reloading...';
    if (logEl) logEl.textContent = log;
    setTimeout(() => { try { window.avis.hotReload(); } catch (e) {} }, 500);
  },

  // Console capture
  initDevConsole() {
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    const self = this;

    console.log = function(...args) {
      origLog.apply(console, args);
      self._devConsoleLog.push({ level: 'log', msg: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), time: new Date().toLocaleTimeString() });
      self.renderDevConsole();
    };
    console.warn = function(...args) {
      origWarn.apply(console, args);
      self._devConsoleLog.push({ level: 'warn', msg: args.map(String).join(' '), time: new Date().toLocaleTimeString() });
      self.renderDevConsole();
    };
    console.error = function(...args) {
      origError.apply(console, args);
      self._devConsoleLog.push({ level: 'error', msg: args.map(String).join(' '), time: new Date().toLocaleTimeString() });
      self.renderDevConsole();
    };
  },

  renderDevConsole() {
    const el = document.getElementById('dev-console-output');
    if (!el) return;
    const filtered = this._devConsoleFilter === 'all' ? this._devConsoleLog : this._devConsoleLog.filter(e => e.level === this._devConsoleFilter);
    el.textContent = filtered.map(e => `[${e.time}] [${e.level.toUpperCase()}] ${e.msg}`).join('\n');
    el.scrollTop = el.scrollHeight;
  },

  filterConsole(level, btn) {
    this._devConsoleFilter = level;
    document.querySelectorAll('.dev-filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    this.renderDevConsole();
  },

  clearConsole() {
    this._devConsoleLog = [];
    this.renderDevConsole();
  },

  // Apply theme preset
  applyTheme(themeName) {
    document.body.className = document.body.className.replace(/theme-\S+/g, '');
    if (themeName && themeName !== 'default') {
      document.body.classList.add(`theme-${themeName}`);
    }
    HotConfig.update('theme', themeName);
  }
};

document.addEventListener('DOMContentLoaded', () => AVIS.init());
