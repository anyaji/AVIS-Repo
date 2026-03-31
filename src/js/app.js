// AVIS Main App Controller — v3.0 with live thinking steps + abort + self-edit
const AVIS = {
  isProcessing: false,
  terminalLog: [],
  activeStepPanel: null,  // reference to live step panel DOM element
  steps: {},              // stepId → DOM element for live updates
  lastUserMessage: null,  // for retry
  lastUserFiles: null,

  async init() {
    // License check FIRST — block everything until valid
    if (!this._licenseVerified) {
      const licenseOk = await this.checkLicense();
      if (!licenseOk) return;
    }

    // Load dynamic paths for this user/machine
    this._paths = await window.avis.getPaths();

    UsageMeter.init();
    await MemoryManager.init();
    await HotConfig.init();
    FileHandler.init();

    this.setupTabs();
    this.setupInput();
    this.updateProviderStatus();
    this.renderMeters();
    await this.loadHistoryList();

    // Wire orchestrator callbacks
    Orchestrator.onStep = (id, type, message, status) => this.handleStep(id, type, message, status);
    Orchestrator.onStreamChunk = (chunk, fullText) => this.handleStreamChunk(chunk, fullText);

    const firstRun = await window.avis.isFirstRun();
    if (firstRun) this.showOnboarding();

    await this.detectProviders();

    // FIX 3: Health check providers on startup (non-blocking)
    setTimeout(() => this.healthCheckAll(), 2000);
    // Re-check every 15 minutes
    setInterval(() => this.healthCheckAll(), 15 * 60 * 1000);

    // Auto-updater status listener
    window.avis.onUpdateStatus((data) => this.handleUpdateStatus(data));

    // FIX 4: Show version in titlebar
    try {
      const ver = await window.avis.getAppVersion();
      const verEl = document.getElementById('app-version');
      if (verEl) verEl.textContent = `v${ver}`;
      const welcomeVer = document.getElementById('welcome-version');
      if (welcomeVer) welcomeVer.textContent = `v${ver}`;
    } catch (e) {}

    // Render changelog + init dev console + live clock
    this.renderChangelog();
    this.initDevConsole();
    this.startClock();

    // Listen for license revocation while app is running
    window.avis.onLicenseRevoked((data) => {
      document.getElementById('license-revoked').style.display = 'flex';
      document.getElementById('revoked-reason').textContent = data.reason || 'Your license has been deactivated.';
    });

    // Show license tier in titlebar
    window.avis.onLicenseStatus((data) => {
      if (data.valid && data.tier === 'master') {
        const ver = document.getElementById('app-version');
        if (ver) ver.innerHTML += ' <span class="master-badge">MASTER</span>';
      }
    });

    // Ctrl+Shift+D toggles Dev tab visibility
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        const devBtn = document.getElementById('dev-tab-btn');
        if (devBtn) {
          const visible = devBtn.style.display !== 'none';
          devBtn.style.display = visible ? 'none' : '';
          if (!visible) this.showToast('Dev panel enabled');
        }
      }
    });

    // Welcome particle animation
    this.initParticles();
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
        if (targetSection) { targetSection.classList.add('active'); targetSection.style.display = 'block'; }

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
    this.showStopButton(false);

    // Remove typing indicator
    document.querySelectorAll('.typing-indicator').forEach(el => el.closest('.message')?.remove());

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

  startClock() {
    const update = () => {
      const el = document.getElementById('live-clock');
      if (el) el.textContent = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };
    update();
    setInterval(update, 30000);
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

  // ====================================================================
  // Send message — with STOP button + retry support
  // ====================================================================
  async sendMessage(retryText = null) {
    if (this.isProcessing) return;

    const input = document.getElementById('chat-input');
    const text = retryText || input.value.trim();
    if (!text && !FileHandler.hasFiles()) return;

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
    const contentEl = this._streamBubble.querySelector('.stream-content');
    if (contentEl) {
      contentEl.innerHTML = this.renderMarkdown(fullText);
      // Syntax highlight any code blocks
      this._streamBubble.querySelectorAll('pre code').forEach(block => {
        if (typeof hljs !== 'undefined' && !block.dataset.highlighted) {
          hljs.highlightElement(block);
          block.dataset.highlighted = 'true';
        }
      });
    }
    const chatArea = document.getElementById('chat-area');
    chatArea.scrollTop = chatArea.scrollHeight;
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
      'claude-opus': { provider: 'claude', model: 'claude-opus-4-5-20250514' },
      'claude-haiku': { provider: 'claude', model: 'claude-haiku-4-5-20251001' },
      'openai': { provider: 'openai', model: 'gpt-4o' },
      'deepseek': { provider: 'deepseek', model: 'deepseek-chat' },
      'gemini': { provider: 'gemini', model: 'gemini-2.0-flash' },
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
    'GEMINI': { provider: 'gemini', model: 'gemini-2.0-flash', label: 'Gemini', color: '#4285f4' },
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
          provider: 'openai', model: 'dall-e-3',
          messages: [{ role: 'user', content: task }],
          systemPrompt: '', options: { isDalle: true, prompt: task }
        });
        if (result.error) return { key, label: p.label, text: `[Image failed: ${result.message}]`, error: true };
        return { key, label: p.label, text: `[Generated image: ${result.revisedPrompt || task}]`, imageData: result.base64, imageUrl: result.imageUrl, error: false };
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

      // Synthesize
      const synthCard = document.getElementById('agent-synthesis');
      if (synthCard) synthCard.style.display = '';
      this._updateAgentCard('synthesis', 'working', `<span style="color:var(--accent-blue);">Synthesizing (Round ${round})...</span>`);

      const contributions = allResults.filter(r => !r.error).map(r => `=== ${r.label} ===\n${r.text}`).join('\n\n');
      const prevContext = round > 1 ? `\n\nPrevious draft (improve upon this):\n${synthesisText}` : '';

      const synthResult = await window.avis.apiCall({
        provider: 'claude', model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: `Original task: ${prompt}\n\nAll AI contributions:\n\n${contributions}${prevContext}\n\nSynthesize into a polished, comprehensive final response. Use markdown.` }],
        systemPrompt: round > 1
          ? 'You are improving a previous draft with new contributions from specialists who fixed identified gaps. Integrate their fixes seamlessly.'
          : 'You are synthesizing contributions from multiple AI specialists into a final deliverable.',
        options: {}
      });

      if (synthResult.error) {
        this._updateAgentCard('synthesis', 'error', `Synthesis failed: ${synthResult.message}`);
        break;
      }

      synthesisText = synthResult.text;
      this._councilLastResult = synthesisText;

      // Review with Claude Opus
      const reviewerId = `reviewer-r${round}`;
      agents.insertAdjacentHTML('beforeend', `
        <div class="agent-card coordinator" id="agent-${reviewerId}" style="border-color:var(--accent-amber);">
          <div class="agent-card-header">
            <span class="agent-card-name">Claude Opus (Review — Round ${round})</span>
            <span class="agent-card-status working" id="status-${reviewerId}">REVIEWING</span>
          </div>
          <div class="agent-card-output" id="output-${reviewerId}"><span style="color:var(--accent-amber);">Evaluating quality...</span></div>
        </div>`);

      const reviewResult = await window.avis.apiCall({
        provider: 'claude', model: 'claude-opus-4-5-20250514',
        messages: [{ role: 'user', content: `Task: ${prompt}\n\nCurrent draft (Round ${round}):\n${synthesisText}\n\nReview this output. Score 1-10. If below 8, identify SPECIFIC fixes and assign them to the right AI.

Format EXACTLY:
SCORE: [1-10]
STRENGTHS: [what's good]
GAPS: [what's missing]
FIX_GPT4: [rewrite/format task, or NONE]
FIX_DEEPSEEK: [analysis/calculation task, or NONE]
FIX_GEMINI: [research/data task, or NONE]
FIX_PERPLEXITY: [fact-check/current data task, or NONE]
FIX_DALLE: [image needed description, or NONE]
SUGGESTION_1: [optional improvement for user]
SUGGESTION_2: [optional improvement for user]
SUGGESTION_3: [optional improvement for user]` }],
        systemPrompt: `You are a ruthless quality reviewer on round ${round} of ${this._councilMaxRounds}. Score honestly. If score < 8, you MUST assign FIX_ tasks to the agents best suited to address each gap. Be specific about what needs fixing. NONE means that agent isn't needed for fixes.`,
        options: {}
      });

      let reviewText = '';
      let suggestions = [];
      score = 8; // default if review fails

      if (!reviewResult.error) {
        reviewText = reviewResult.text;
        const scoreMatch = reviewText.match(/SCORE:\s*(\d+)/i);
        if (scoreMatch) score = parseInt(scoreMatch[1]);
        const suggMatches = reviewText.matchAll(/SUGGESTION_\d+:\s*(.+)/gi);
        for (const m of suggMatches) suggestions.push(m[1].trim());
      }

      const scoreColor = score >= 8 ? 'var(--accent-green)' : score >= 6 ? 'var(--accent-amber)' : 'var(--accent-red)';
      this._updateAgentCard(reviewerId, 'done',
        `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-size:20px;font-weight:700;color:${scoreColor};">${score}/10</span>
          <span style="font-size:11px;color:var(--text-secondary);">Round ${round}</span>
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

      if (Object.keys(assignments).length === 0) break; // nothing to fix

      round++;
    }

    // ===== FINAL PRESENTATION =====
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const aiNames = [...new Set(allResults.filter(r => !r.error).map(r => r.label))];
    const finalScoreColor = score >= 8 ? 'var(--accent-green)' : score >= 6 ? 'var(--accent-amber)' : 'var(--accent-red)';

    // Gather suggestions from last review
    let suggestions = [];
    if (!allResults.error) {
      // Re-parse from last review
      const lastReviewEl = document.getElementById(`output-reviewer-r${round}`) || document.getElementById(`output-reviewer-r${round > 1 ? round : 1}`);
      // Use stored suggestions from the loop
    }

    // Final synthesis card with suggestions
    let suggestionsHtml = '';
    // Re-extract suggestions from the review text on screen
    const reviewOutputs = document.querySelectorAll('[id^="output-reviewer-"]');
    if (reviewOutputs.length > 0) {
      const lastReview = reviewOutputs[reviewOutputs.length - 1].textContent || '';
      const suggMatches = lastReview.matchAll(/SUGGESTION_\d+:\s*(.+)/gi);
      suggestions = [];
      for (const m of suggMatches) suggestions.push(m[1].trim());
    }

    if (suggestions.length > 0) {
      suggestionsHtml = `<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">
        <div style="font-size:11px;font-weight:600;color:var(--accent-amber);margin-bottom:6px;">★ Want to refine further?</div>
        ${suggestions.map((s, i) => `<button onclick="AVIS.councilRevise('${s.replace(/'/g, "\\'").substring(0, 200)}')" style="display:block;width:100%;text-align:left;margin-bottom:4px;padding:8px 10px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;" onmouseover="this.style.borderColor='var(--accent-amber)'" onmouseout="this.style.borderColor='var(--border)'">${i+1}. ${s}</button>`).join('')}
      </div>`;
    }

    this._updateAgentCard('synthesis', 'done',
      `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <span style="font-size:11px;color:var(--text-secondary);">Claude + ${aiNames.join(' + ')}</span>
        <span style="font-size:11px;color:var(--text-secondary);">${round} round${round > 1 ? 's' : ''} — ${elapsed}s</span>
        <span style="font-size:13px;font-weight:700;color:${finalScoreColor};">${score}/10</span>
      </div>` +
      `<div class="synthesis-output">${this.renderMarkdown(synthesisText)}</div>` +
      suggestionsHtml +
      `<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">
        <div style="font-size:11px;font-weight:600;color:var(--accent-green);margin-bottom:8px;">📦 Ship It — Export Options:</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
          <button onclick="AVIS.councilShip('pptx')" class="council-ship-btn" style="padding:10px 8px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;text-align:center;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--accent-green)'" onmouseout="this.style.borderColor='var(--border)'">
            <div style="font-size:18px;">📊</div>PowerPoint
          </button>
          <button onclick="AVIS.councilShip('docx')" class="council-ship-btn" style="padding:10px 8px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;text-align:center;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--accent-green)'" onmouseout="this.style.borderColor='var(--border)'">
            <div style="font-size:18px;">📄</div>Word Doc
          </button>
          <button onclick="AVIS.councilShip('xlsx')" class="council-ship-btn" style="padding:10px 8px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;text-align:center;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--accent-green)'" onmouseout="this.style.borderColor='var(--border)'">
            <div style="font-size:18px;">📈</div>Excel
          </button>
          <button onclick="AVIS.councilShip('md')" class="council-ship-btn" style="padding:10px 8px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;text-align:center;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--accent-green)'" onmouseout="this.style.borderColor='var(--border)'">
            <div style="font-size:18px;">📝</div>Markdown
          </button>
          <button onclick="AVIS.councilShip('txt')" class="council-ship-btn" style="padding:10px 8px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;text-align:center;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--accent-green)'" onmouseout="this.style.borderColor='var(--border)'">
            <div style="font-size:18px;">📋</div>Plain Text
          </button>
          <button onclick="AVIS.councilCopyResult()" class="council-ship-btn" style="padding:10px 8px;font-size:11px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);cursor:pointer;text-align:center;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--accent-green)'" onmouseout="this.style.borderColor='var(--border)'">
            <div style="font-size:18px;">📎</div>Clipboard
          </button>
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

  async councilShip(format) {
    if (!this._councilLastResult) { this.showToast('No result to export'); return; }

    const title = (this._councilPrompt || 'Council Output').substring(0, 50).replace(/[^\w\s-]/g, '');
    const filename = `AVIS_Council_${title.replace(/\s+/g, '_')}`;

    if (format === 'md') {
      const blob = new Blob([this._councilLastResult], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${filename}.md`; a.click();
      URL.revokeObjectURL(url);
      this.showToast('Exported as Markdown');
      return;
    }

    if (format === 'txt') {
      const blob = new Blob([this._councilLastResult], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${filename}.txt`; a.click();
      URL.revokeObjectURL(url);
      this.showToast('Exported as Plain Text');
      return;
    }

    // For PPTX, DOCX, XLSX — ask Claude to structure the content, then generate
    this.showToast(`Building ${format.toUpperCase()}...`);

    if (format === 'pptx') {
      const structResult = await window.avis.apiCall({
        provider: 'claude', model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: `Convert this content into a PowerPoint presentation structure. Return ONLY valid JSON, no markdown fences.\n\nContent:\n${this._councilLastResult}\n\nReturn JSON format:\n{"slides":[{"elements":[{"type":"title","text":"...","x":0.5,"y":0.3,"fontSize":28,"color":"FFFFFF"},{"type":"text","text":"...","x":0.5,"y":1.2,"fontSize":14,"color":"CCCCCC"}],"background":{"fill":{"type":"solid","color":"0D1117"}}}],"options":{"title":"...","filename":"${filename}","author":"AVIS Council"}}` }],
        systemPrompt: 'Convert content to PowerPoint JSON. Use dark backgrounds (0D1117), white/light text. Create 5-10 slides. Title slide first, content slides with bullet points, data slides with tables. Return ONLY valid JSON.',
        options: {}
      });
      if (!structResult.error) {
        try {
          const data = JSON.parse(structResult.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
          const result = await window.avis.generatePptx(data);
          this.showToast(result.success ? `PowerPoint saved to Desktop` : `Failed: ${result.error}`);
        } catch (e) { this.showToast(`Failed to parse structure: ${e.message}`); }
      } else { this.showToast(`Failed: ${structResult.message}`); }
      return;
    }

    if (format === 'docx') {
      const structResult = await window.avis.apiCall({
        provider: 'claude', model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: `Convert this content into a Word document structure. Return ONLY valid JSON, no markdown fences.\n\nContent:\n${this._councilLastResult}\n\nReturn JSON format:\n{"content":[{"type":"heading","text":"...","level":1},{"type":"paragraph","text":"..."},{"type":"table","rows":[["Header1","Header2"],["data1","data2"]]},{"type":"pagebreak"}],"options":{"title":"...","filename":"${filename}","author":"AVIS Council"}}` }],
        systemPrompt: 'Convert content to Word document JSON. Use headings, paragraphs, tables, and page breaks. Be thorough — include all content. Return ONLY valid JSON.',
        options: {}
      });
      if (!structResult.error) {
        try {
          const data = JSON.parse(structResult.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
          const result = await window.avis.generateDocx(data);
          this.showToast(result.success ? `Word doc saved to Desktop` : `Failed: ${result.error}`);
        } catch (e) { this.showToast(`Failed to parse structure: ${e.message}`); }
      } else { this.showToast(`Failed: ${structResult.message}`); }
      return;
    }

    if (format === 'xlsx') {
      const structResult = await window.avis.apiCall({
        provider: 'claude', model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: `Convert this content into an Excel spreadsheet structure. Extract all data, comparisons, and lists into tabular format. Return ONLY valid JSON, no markdown fences.\n\nContent:\n${this._councilLastResult}\n\nReturn JSON format:\n{"sheets":[{"name":"Sheet1","data":[["Header1","Header2"],["val1","val2"]],"colWidths":[20,30]}],"options":{"filename":"${filename}"}}` }],
        systemPrompt: 'Convert content to Excel JSON. Create meaningful sheets — extract tables, data, lists, comparisons into spreadsheet format. First row = headers. Return ONLY valid JSON.',
        options: {}
      });
      if (!structResult.error) {
        try {
          const data = JSON.parse(structResult.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
          const result = await window.avis.generateXlsx(data);
          this.showToast(result.success ? `Excel saved to Desktop` : `Failed: ${result.error}`);
        } catch (e) { this.showToast(`Failed to parse structure: ${e.message}`); }
      } else { this.showToast(`Failed: ${structResult.message}`); }
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

    // 2. Brave (if configured)
    try {
      if (statusEl) statusEl.textContent = 'Trying Brave Search...';
      const braveResults = await window.avis.braveSearch(query);
      if (braveResults?.length) { results = braveResults; source = 'Brave Search'; }
    } catch (e) { /* fall through */ }

    // 3. SearXNG (always available, no key — returns real diverse web results)
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
      { key: 'brave', label: 'Brave Search', placeholder: 'BSA...' }
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
    for (const p of ['claude', 'deepseek', 'openai', 'gemini', 'mistral', 'perplexity', 'brave']) {
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
      version: '3.1.0', date: '2026-03-31', label: 'latest',
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
