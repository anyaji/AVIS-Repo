// AVIS Main App Controller — v3.0 with live thinking steps + abort + self-edit
const AVIS = {
  isProcessing: false,
  terminalLog: [],
  activeStepPanel: null,  // reference to live step panel DOM element
  steps: {},              // stepId → DOM element for live updates
  lastUserMessage: null,  // for retry
  lastUserFiles: null,

  async init() {
    UsageMeter.init();
    await MemoryManager.init();
    await HotConfig.init();
    FileHandler.init();

    this.setupTabs();
    this.setupInput();
    this.updateProviderStatus();
    this.renderMeters();
    await this.loadHistoryList();

    // Wire orchestrator step callback for live UI
    Orchestrator.onStep = (id, type, message, status) => this.handleStep(id, type, message, status);

    const firstRun = await window.avis.isFirstRun();
    if (firstRun) this.showOnboarding();

    await this.detectProviders();

    // FIX 3: Health check providers on startup (non-blocking)
    setTimeout(() => this.healthCheckAll(), 2000);
    // Re-check every 15 minutes
    setInterval(() => this.healthCheckAll(), 15 * 60 * 1000);

    // Setup browser webview once DOM is stable
    setTimeout(() => this.setupBrowser(), 500);

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

    // Render changelog + init dev console
    this.renderChangelog();
    this.initDevConsole();

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

  // Provider health state: { status, reason } per provider
  providerHealth: {},

  async detectProviders() {
    const providers = [
      { key: 'claude', obj: ClaudeProvider }, { key: 'deepseek', obj: DeepSeekProvider }, { key: 'openai', obj: OpenAIProvider },
      { key: 'gemini', obj: GeminiProvider }, { key: 'grok', obj: GrokProvider },
      { key: 'mistral', obj: MistralProvider }, { key: 'perplexity', obj: PerplexityProvider },
      { key: 'stability', obj: StabilityProvider }
    ];
    for (const p of providers) {
      const key = await window.avis.getApiKey(p.key);
      p.obj.status = key ? 'active' : 'unconfigured';
      if (!key) this.providerHealth[p.key] = { status: 'unconfigured', reason: 'NOT SET' };
    }
    this.updateProviderStatus();
  },

  // FIX 3: Ping all configured providers to check health
  async healthCheckAll() {
    const providers = ['claude', 'openai', 'gemini', 'grok', 'mistral', 'deepseek', 'perplexity'];
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
    const filePath = `C:/Users/anyaj/Desktop/AVIS-Log-${timestamp}.txt`;
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

  manualUpdateCheck() {
    const btn = document.getElementById('btn-check-update');
    if (btn) btn.textContent = '\u21BB Checking...';
    window.avis.checkForUpdates();
    // Reset button text after 5s
    setTimeout(() => { if (btn) btn.textContent = '\u21BB Check for Updates'; }, 5000);
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

      if (result.timedOut) {
        this.addRetryMessage('Response timed out. Click to retry.');
      } else if (result.paused) {
        this.addMessageToChat('ai', result.text, result.provider, result.model);
        this.addContinueCard(result.pauseInfo);
      } else if (result.error && result.friendlyError) {
        this.addErrorCard(result.text, result.provider);
      } else if (result.text) {
        this.addMessageToChat('ai', result.text, result.provider, result.model);
      } else if (!result.image && !result.error && !result.paused) {
        // Fallback — always show something
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

    let html = '<div class="message-bubble">';
    if (role === 'ai' && provider) html += `<div class="provider-badge ${provider}">${provider}${model ? ' / ' + model : ''}</div>`;
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
    msgDiv.className = 'message ai';
    msgDiv.innerHTML = `<div class="message-bubble"><div class="provider-badge ${provider}">${provider} / ${model}</div><img src="data:${image.mimeType};base64,${image.data}" style="max-width:100%;border-radius:8px;"></div>`;
    chatArea.appendChild(msgDiv);
    chatArea.scrollTop = chatArea.scrollHeight;
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

  renderMarkdown(text) {
    if (typeof marked !== 'undefined') { marked.setOptions({ breaks: true, gfm: true }); return marked.parse(text); }
    return this.escapeHtml(text).replace(/\n/g, '<br>');
  },

  escapeHtml(text) { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; },

  // ====================================================================
  // Browser tab — real webview
  // ====================================================================
  _webviewReady: false,

  getWebview() {
    return document.getElementById('browser-webview');
  },

  setupBrowser() {
    const wv = this.getWebview();
    if (!wv) return;

    wv.addEventListener('did-navigate', (e) => {
      const urlBar = document.getElementById('browser-url-input');
      if (urlBar) urlBar.value = e.url;
    });
    wv.addEventListener('did-navigate-in-page', (e) => {
      const urlBar = document.getElementById('browser-url-input');
      if (urlBar && e.isMainFrame) urlBar.value = e.url;
    });
    wv.addEventListener('page-title-updated', (e) => {
      const el = document.getElementById('browser-page-title');
      if (el) el.textContent = e.title;
    });
    wv.addEventListener('did-start-loading', () => {
      const el = document.getElementById('browser-load-status');
      if (el) el.textContent = '\u21BB Loading...';
    });
    wv.addEventListener('did-stop-loading', () => {
      const el = document.getElementById('browser-load-status');
      if (el) el.textContent = '\u2713 Loaded';
    });
    wv.addEventListener('did-fail-load', (e) => {
      if (e.errorCode === -3) return; // aborted, ignore
      const el = document.getElementById('browser-load-status');
      if (el) el.textContent = '\u2717 ' + (e.errorDescription || 'Failed');
    });

    this._webviewReady = true;
  },

  isURL(input) {
    if (!input) return false;
    if (input.startsWith('http://') || input.startsWith('https://')) return true;
    // Has a dot and no spaces = likely a URL
    return input.includes('.') && !input.includes(' ');
  },

  navigateBrowser(urlOverride) {
    const input = document.getElementById('browser-url-input');
    let url = urlOverride || (input ? input.value.trim() : '');
    if (!url) return;

    if (!this._webviewReady) this.setupBrowser();

    if (this.isURL(url)) {
      if (!url.startsWith('http')) url = 'https://' + url;
      const wv = this.getWebview();
      if (wv) {
        wv.src = url;
        if (input) input.value = url;
      }
    } else {
      // Not a URL — treat as search query
      if (input) input.value = url;
      this.doSearch(url);
    }
  },

  browserBack() { const wv = this.getWebview(); if (wv) wv.goBack(); },
  browserForward() { const wv = this.getWebview(); if (wv) wv.goForward(); },
  browserRefresh() { const wv = this.getWebview(); if (wv) wv.reload(); },

  async readPageWithAI() {
    const wv = this.getWebview();
    if (!wv || wv.src === 'about:blank') return;
    try {
      const pageText = await wv.executeJavaScript('document.body.innerText.substring(0, 15000)');
      const pageTitle = await wv.executeJavaScript('document.title');
      const pageUrl = wv.getURL();
      // Switch to chat and send
      this.switchToTab('providers');
      const chatInput = document.getElementById('chat-input');
      chatInput.value = `I'm looking at: ${pageTitle} (${pageUrl})\n\nContent:\n${pageText.substring(0, 3000)}\n\nPlease summarize this page.`;
      chatInput.focus();
      this.sendMessage();
    } catch (err) {
      alert('Could not read page: ' + err.message);
    }
  },

  async screenshotPage() {
    const wv = this.getWebview();
    if (!wv || wv.src === 'about:blank') return;
    try {
      // capturePage is not available on webview directly from renderer
      // Use the headless browser approach from main process instead
      const pageUrl = wv.getURL();
      const result = await window.avis.browserNavigate(pageUrl);
      const screenshot = await window.avis.browserScreenshot();
      if (screenshot) {
        this.switchToTab('providers');
        this.addMessageToChat('ai', `Screenshot of ${pageUrl}:`, 'avis', 'browser');
        const chatArea = document.getElementById('chat-area');
        const imgDiv = document.createElement('div');
        imgDiv.className = 'message ai';
        imgDiv.innerHTML = `<div class="message-bubble"><img src="${screenshot}" style="max-width:100%;border-radius:8px;"></div>`;
        chatArea.appendChild(imgDiv);
        chatArea.scrollTop = chatArea.scrollHeight;
      }
    } catch (err) {
      alert('Screenshot failed: ' + err.message);
    }
  },

  openInBrowser(url) {
    // Switch to browser tab and navigate
    this.switchToTab('browser');
    const input = document.getElementById('browser-url-input');
    if (input) input.value = url;
    this.navigateBrowser(url);
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
      { obj: GrokProvider, key: 'grok' }, { obj: MistralProvider, key: 'mistral' },
      { obj: PerplexityProvider, key: 'perplexity' }, { obj: StabilityProvider, key: 'stability' }
    ];
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
      { obj: GrokProvider, key: 'grok' }, { obj: MistralProvider, key: 'mistral' },
      { obj: PerplexityProvider, key: 'perplexity' }, { obj: StabilityProvider, key: 'stability' }
    ];
    container.innerHTML = providers.map(p => {
      const u = UsageMeter.providers[p.key];
      const pct = UsageMeter.getUsagePercent(p.key);
      const bar = pct >= 80 ? 'red' : pct >= 50 ? 'amber' : 'green';
      const st = p.obj.status === 'active' ? 'ACTIVE' : p.obj.status === 'limited' ? 'RATE LIMITED' : p.obj.status === 'stepped-down' ? 'STEPPED DOWN' : p.obj.status === 'offline' ? 'OFFLINE' : 'NOT SET';
      const sc = p.obj.status === 'active' ? 'var(--accent-green)' : p.obj.status === 'limited' ? 'var(--accent-amber)' : p.obj.status === 'offline' ? 'var(--accent-red)' : 'var(--text-secondary)';
      return `<div class="meter-card"><div class="meter-header"><span class="meter-provider">${p.obj.displayName}</span><span class="meter-status" style="color:${sc};">&#9679; ${st}</span></div><div class="meter-model">${p.obj.getCurrentModel().name}</div><div class="meter-bar-wrap"><div class="meter-bar ${bar}" style="width:${pct}%"></div></div><div class="meter-stats"><div class="meter-stat">Session In: <span class="value">${UsageMeter.formatTokens(u.sessionTokensIn)}</span></div><div class="meter-stat">Session Out: <span class="value">${UsageMeter.formatTokens(u.sessionTokensOut)}</span></div><div class="meter-stat">Month $: <span class="value">${UsageMeter.formatCost(u.monthCost)}</span></div><div class="meter-stat">Session $: <span class="value">${UsageMeter.formatCost(u.sessionCost)}</span></div></div><button class="meter-reset" onclick="AVIS.resetMeter('${p.key}')">Reset</button></div>`;
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
          <div class="welcome-version">v1.3.0</div>
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
      { key: 'grok', label: 'xAI Grok', placeholder: 'xai-...' },
      { key: 'mistral', label: 'Mistral', placeholder: 'API key...' },
      { key: 'perplexity', label: 'Perplexity', placeholder: 'pplx-...' },
      { key: 'deepseek', label: 'DeepSeek', placeholder: 'sk-...' },
      { key: 'stability', label: 'Stability AI', placeholder: 'sk-...' },
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
    for (const p of ['claude', 'deepseek', 'openai', 'gemini', 'grok', 'mistral', 'perplexity', 'stability', 'brave']) {
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
      version: '1.3.0', date: '2026-03-30', label: 'latest',
      items: [
        'Changelog tab with full version history',
        'Enhanced welcome screen with particle animation',
        'Theme presets: Cyberpunk, Emerald, Sunset, Arctic, Blood',
        'Message slide-in animations',
        'Provider status pulse effects',
        'Glow text effects on logo',
        'Input field focus glow',
        'Meter bar shimmer animation',
        'Improved scrollbar styling',
        'Custom accent color + theme selection in Settings'
      ]
    },
    {
      version: '1.2.0', date: '2026-03-30', label: 'major',
      items: [
        'Fixed API key persistence across restarts',
        'Python path auto-detection (python/python3/py)',
        'Fast-path: simple questions answered without tool calls',
        'Weather tool via wttr.in (free, no API key)',
        'Typing indicator cleanup on completion',
        'Step panel shows total elapsed time'
      ]
    },
    {
      version: '1.1.0', date: '2026-03-30',
      items: [
        'Dynamic iteration limits by task type (5-100)',
        'Smart Steam game launcher tool',
        'API timeout raised: 60s regular, 120s agentic, 30min claude-code',
        'Continue button when step limit reached',
        'Claude self-awareness: call_claude + call_claude_code tools',
        'Gold ORCHESTRATOR badge for Claude in status panel'
      ]
    },
    {
      version: '1.0.0', date: '2026-03-30',
      items: [
        'Initial release — multi-AI orchestration platform',
        '9 AI providers: Claude, DeepSeek, GPT-4, Gemini, Grok, Mistral, Perplexity, Stability',
        'Agentic tool loop with web search, code execution, file access',
        'Embedded browser with webview',
        'Computer control (screenshot, click, type)',
        'Live thinking step display',
        'Auto-updater via GitHub Releases',
        'Military dark theme UI'
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
