// Hot Config - Live in-app settings/personalization
const HotConfig = {
  defaults: {
    appName: 'AVIS',
    accentColor: '#00a8ff',
    fontSize: 14,
    bubbleStyle: 'rounded',
    soundEffects: false,
    startupBehavior: 'fresh',
    customSystemPrompt: '',
    showStartupSplash: true,
    theme: 'default',
    leftPanelWidth: 260,
    rightPanelWidth: 280,
    showLeftPanel: true,
    showRightPanel: true,
    compactMode: false,
    budgets: {
      claude: 50, openai: 50, gemini: 30, grok: 30, mistral: 20, perplexity: 20, stability: 10
    }
  },

  config: null,

  async init() {
    this.config = await window.avis.getConfig() || { ...this.defaults };
    this.apply();
  },

  apply() {
    const c = this.config;

    // Font size
    document.documentElement.style.setProperty('--font-size-base', c.fontSize + 'px');

    // Theme preset
    if (c.theme && c.theme !== 'default') {
      document.body.className = document.body.className.replace(/theme-\S+/g, '');
      document.body.classList.add(`theme-${c.theme}`);
    }

    // Accent color (overrides theme)
    if (c.accentColor && c.accentColor !== '#00a8ff') {
      document.documentElement.style.setProperty('--accent-blue', c.accentColor);
    }

    // Bubble style
    switch (c.bubbleStyle) {
      case 'sharp':
        document.documentElement.style.setProperty('--bubble-radius', '4px');
        break;
      case 'minimal':
        document.documentElement.style.setProperty('--bubble-radius', '2px');
        break;
      default:
        document.documentElement.style.setProperty('--bubble-radius', '12px');
    }

    // App name
    const titleEl = document.getElementById('app-title');
    if (titleEl && c.appName) titleEl.textContent = c.appName;

    // Layout — panel widths
    const leftPanel = document.querySelector('.left-panel');
    const rightPanel = document.querySelector('.right-panel');
    if (leftPanel) {
      leftPanel.style.width = (c.leftPanelWidth || 260) + 'px';
      leftPanel.style.display = c.showLeftPanel === false ? 'none' : '';
    }
    if (rightPanel) {
      rightPanel.style.width = (c.rightPanelWidth || 280) + 'px';
      rightPanel.style.display = c.showRightPanel === false ? 'none' : '';
    }

    // Compact mode — tighter spacing
    if (c.compactMode) {
      document.body.classList.add('compact-mode');
    } else {
      document.body.classList.remove('compact-mode');
    }

    // Apply budget limits to usage meters
    if (c.budgets && typeof UsageMeter !== 'undefined') {
      for (const [provider, limit] of Object.entries(c.budgets)) {
        if (UsageMeter.providers[provider]) {
          UsageMeter.providers[provider].budgetLimit = limit;
        }
      }
    }
  },

  async save() {
    await window.avis.saveConfig(this.config);
    this.apply();
  },

  async reset() {
    this.config = { ...this.defaults };
    await this.save();
  },

  get(key) {
    return this.config?.[key] ?? this.defaults[key];
  },

  set(key, value) {
    if (!this.config) this.config = { ...this.defaults };
    this.config[key] = value;
  },

  renderSettings() {
    const providers = [
      { key: 'claude', label: 'Anthropic (Claude)' },
      { key: 'deepseek', label: 'DeepSeek' },
      { key: 'openai', label: 'OpenAI' },
      { key: 'gemini', label: 'Google Gemini' },
      { key: 'grok', label: 'xAI Grok' },
      { key: 'mistral', label: 'Mistral' },
      { key: 'perplexity', label: 'Perplexity' },
      { key: 'stability', label: 'Stability AI' },
      { key: 'brave', label: 'Brave Search' },
      { key: 'firecrawl', label: 'Firecrawl' }
    ];

    let html = `
      <div class="settings-section">
        <h3>API Keys</h3>
        ${providers.map(p => `
          <div class="setting-row">
            <label>${p.label}</label>
            <input type="password" id="key-${p.key}" placeholder="Enter API key..." onchange="HotConfig.saveApiKey('${p.key}', this.value)">
          </div>
        `).join('')}
      </div>

      <div class="settings-section">
        <h3>Personalization</h3>
        <div class="setting-row">
          <label>App Name</label>
          <input type="text" value="${this.get('appName')}" onchange="HotConfig.update('appName', this.value)">
        </div>
        <div class="setting-row">
          <label>Theme Preset</label>
          <select onchange="AVIS.applyTheme(this.value)">
            <option value="default" ${this.get('theme') === 'default' || !this.get('theme') ? 'selected' : ''}>Default (Cyan)</option>
            <option value="cyberpunk" ${this.get('theme') === 'cyberpunk' ? 'selected' : ''}>Cyberpunk (Magenta)</option>
            <option value="emerald" ${this.get('theme') === 'emerald' ? 'selected' : ''}>Emerald (Green)</option>
            <option value="sunset" ${this.get('theme') === 'sunset' ? 'selected' : ''}>Sunset (Orange)</option>
            <option value="arctic" ${this.get('theme') === 'arctic' ? 'selected' : ''}>Arctic (Light Blue)</option>
            <option value="blood" ${this.get('theme') === 'blood' ? 'selected' : ''}>Blood (Red)</option>
          </select>
        </div>
        <div class="setting-row">
          <label>Custom Accent Color (overrides theme)</label>
          <input type="color" value="${this.get('accentColor')}" onchange="HotConfig.update('accentColor', this.value)">
        </div>
        <div class="setting-row">
          <label>Font Size: <span id="font-size-val">${this.get('fontSize')}px</span></label>
          <input type="range" min="11" max="20" value="${this.get('fontSize')}" oninput="document.getElementById('font-size-val').textContent=this.value+'px'" onchange="HotConfig.update('fontSize', parseInt(this.value))">
        </div>
        <div class="setting-row">
          <label>Chat Bubble Style</label>
          <select onchange="HotConfig.update('bubbleStyle', this.value)">
            <option value="rounded" ${this.get('bubbleStyle') === 'rounded' ? 'selected' : ''}>Rounded</option>
            <option value="sharp" ${this.get('bubbleStyle') === 'sharp' ? 'selected' : ''}>Sharp</option>
            <option value="minimal" ${this.get('bubbleStyle') === 'minimal' ? 'selected' : ''}>Minimal</option>
          </select>
        </div>
        <div class="setting-row">
          <div class="toggle-wrap">
            <label>Sound Effects</label>
            <div class="toggle ${this.get('soundEffects') ? 'active' : ''}" onclick="this.classList.toggle('active'); HotConfig.update('soundEffects', this.classList.contains('active'))"></div>
          </div>
        </div>
        <div class="setting-row">
          <label>Startup Behavior</label>
          <select onchange="HotConfig.update('startupBehavior', this.value)">
            <option value="fresh" ${this.get('startupBehavior') === 'fresh' ? 'selected' : ''}>Fresh Start</option>
            <option value="resume" ${this.get('startupBehavior') === 'resume' ? 'selected' : ''}>Resume Last</option>
          </select>
        </div>
        <div class="setting-row">
          <div class="toggle-wrap">
            <label>Show Startup Splash</label>
            <div class="toggle ${this.get('showStartupSplash') !== false ? 'active' : ''}" onclick="this.classList.toggle('active'); HotConfig.update('showStartupSplash', this.classList.contains('active'))"></div>
          </div>
        </div>
        <div class="setting-row">
          <label>Custom System Prompt Addon</label>
          <textarea onchange="HotConfig.update('customSystemPrompt', this.value)">${this.get('customSystemPrompt') || ''}</textarea>
        </div>
      </div>

      <div class="settings-section">
        <h3>Layout</h3>
        <div class="setting-row">
          <label>Left Panel Width: <span id="left-w-val">${this.get('leftPanelWidth') || 260}px</span></label>
          <input type="range" min="180" max="400" value="${this.get('leftPanelWidth') || 260}" oninput="document.getElementById('left-w-val').textContent=this.value+'px'" onchange="HotConfig.update('leftPanelWidth', parseInt(this.value))">
        </div>
        <div class="setting-row">
          <label>Right Panel Width: <span id="right-w-val">${this.get('rightPanelWidth') || 280}px</span></label>
          <input type="range" min="200" max="400" value="${this.get('rightPanelWidth') || 280}" oninput="document.getElementById('right-w-val').textContent=this.value+'px'" onchange="HotConfig.update('rightPanelWidth', parseInt(this.value))">
        </div>
        <div class="setting-row">
          <div class="toggle-wrap">
            <label>Show Left Panel</label>
            <div class="toggle ${this.get('showLeftPanel') !== false ? 'active' : ''}" onclick="this.classList.toggle('active'); HotConfig.update('showLeftPanel', this.classList.contains('active'))"></div>
          </div>
        </div>
        <div class="setting-row">
          <div class="toggle-wrap">
            <label>Show Right Panel (Usage Meters)</label>
            <div class="toggle ${this.get('showRightPanel') !== false ? 'active' : ''}" onclick="this.classList.toggle('active'); HotConfig.update('showRightPanel', this.classList.contains('active'))"></div>
          </div>
        </div>
        <div class="setting-row">
          <div class="toggle-wrap">
            <label>Compact Mode (tighter spacing)</label>
            <div class="toggle ${this.get('compactMode') ? 'active' : ''}" onclick="this.classList.toggle('active'); HotConfig.update('compactMode', this.classList.contains('active'))"></div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3>Monthly Budget Limits ($)</h3>
        ${providers.map(p => {
          const budget = this.config?.budgets?.[p.key] ?? this.defaults.budgets[p.key];
          return `
          <div class="setting-row">
            <label>${p.label}</label>
            <input type="number" value="${budget}" min="0" step="5" onchange="HotConfig.updateBudget('${p.key}', parseFloat(this.value))">
          </div>`;
        }).join('')}
      </div>

      <div class="settings-section">
        <h3>Step-Down Thresholds (%)</h3>
        ${providers.filter(p => p.key !== 'stability').map(p => {
          const threshold = UsageMeter.providers[p.key]?.stepDownThreshold || 80;
          const enabled = UsageMeter.providers[p.key]?.autoStepDown !== false;
          return `
          <div class="setting-row">
            <div class="toggle-wrap">
              <label>${p.label} Auto Step-Down</label>
              <div class="toggle ${enabled ? 'active' : ''}" onclick="this.classList.toggle('active'); HotConfig.updateStepDown('${p.key}', 'enabled', this.classList.contains('active'))"></div>
            </div>
            <input type="range" min="50" max="100" value="${threshold}" onchange="HotConfig.updateStepDown('${p.key}', 'threshold', parseInt(this.value))">
          </div>`;
        }).join('')}
      </div>

      <div class="settings-section">
        <h3>Pinned Memories</h3>
        <div id="memories-list"></div>
        <div style="display:flex;gap:6px;margin-top:8px;">
          <input type="text" id="new-memory-input" placeholder="Add a memory..." style="flex:1;padding:8px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);font-size:12px;">
          <button onclick="HotConfig.addMemory()" style="padding:8px 16px;background:var(--accent-blue);color:#000;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">Pin</button>
        </div>
      </div>
    `;

    document.getElementById('settings-body').innerHTML = html;
    this.loadApiKeys();
    this.renderMemories();
  },

  async loadApiKeys() {
    const providers = ['claude', 'deepseek', 'openai', 'gemini', 'grok', 'mistral', 'perplexity', 'stability', 'brave', 'firecrawl'];
    for (const p of providers) {
      const key = await window.avis.getApiKey(p);
      const input = document.getElementById(`key-${p}`);
      if (input && key) input.value = key;
    }
  },

  async saveApiKey(provider, key) {
    await window.avis.setApiKey(provider, key);
    // Update provider status
    const providerMap = { claude: ClaudeProvider, deepseek: DeepSeekProvider, openai: OpenAIProvider, gemini: GeminiProvider, grok: GrokProvider, mistral: MistralProvider, perplexity: PerplexityProvider, stability: StabilityProvider };
    if (providerMap[provider]) {
      providerMap[provider].status = key ? 'active' : 'unconfigured';
    }
    if (typeof AVIS !== 'undefined') AVIS.updateProviderStatus();
  },

  update(key, value) {
    this.set(key, value);
    this.save();
  },

  updateBudget(provider, amount) {
    if (!this.config.budgets) this.config.budgets = { ...this.defaults.budgets };
    this.config.budgets[provider] = amount;
    this.save();
  },

  updateStepDown(provider, prop, value) {
    if (UsageMeter.providers[provider]) {
      if (prop === 'enabled') UsageMeter.providers[provider].autoStepDown = value;
      if (prop === 'threshold') UsageMeter.providers[provider].stepDownThreshold = value;
      UsageMeter.persist();
    }
  },

  async addMemory() {
    const input = document.getElementById('new-memory-input');
    if (input && input.value.trim()) {
      await MemoryManager.addMemory(input.value.trim());
      input.value = '';
      this.renderMemories();
    }
  },

  renderMemories() {
    const list = document.getElementById('memories-list');
    if (!list) return;
    list.innerHTML = MemoryManager.memories.map(m => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-card);border-radius:4px;margin-bottom:4px;font-size:12px;">
        <span style="flex:1;">${m.text}</span>
        <span style="cursor:pointer;color:var(--accent-red);" onclick="HotConfig.removeMemory('${m.id}')">&#x2715;</span>
      </div>
    `).join('') || '<div style="font-size:12px;color:var(--text-secondary);padding:8px;">No pinned memories</div>';
  },

  async removeMemory(id) {
    await MemoryManager.removeMemory(id);
    this.renderMemories();
  }
};
