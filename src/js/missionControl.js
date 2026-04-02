// Mission Control — Real-time agent dashboard and session stats
const MissionControl = {
  AGENT_STATE: {
    claude:     { name: 'CLAUDE',     status: 'idle', task: '', cost: 0 },
    openai:     { name: 'GPT-4O',     status: 'idle', task: '', cost: 0 },
    deepseek:   { name: 'DEEPSEEK',   status: 'idle', task: '', cost: 0 },
    mistral:    { name: 'MISTRAL',    status: 'idle', task: '', cost: 0 },
    perplexity: { name: 'PERPLEXITY', status: 'idle', task: '', cost: 0 },
    gemini:     { name: 'GEMINI',     status: 'idle', task: '', cost: 0 },
    dalle:      { name: 'DALL-E 3',   status: 'idle', task: '', cost: 0 }
  },

  activityLog: [],
  sessionStats: {
    messages: 0,
    providersUsed: new Set(),
    cost: 0,
    tokensIn: 0,
    tokensOut: 0,
    tasksRouted: 0
  },

  setAgentWorking(provider, task) {
    if (!this.AGENT_STATE[provider]) return;
    this.AGENT_STATE[provider].status = 'working';
    this.AGENT_STATE[provider].task = (task || '').substring(0, 40);
    this.sessionStats.providersUsed.add(provider);

    this.activityLog.unshift({
      time: new Date().toLocaleTimeString(),
      agent: this.AGENT_STATE[provider].name,
      desc: (task || '').substring(0, 60)
    });
    if (this.activityLog.length > 10) this.activityLog.pop();

    this.render();
  },

  setAgentIdle(provider) {
    if (!this.AGENT_STATE[provider]) return;
    this.AGENT_STATE[provider].status = 'idle';
    this.AGENT_STATE[provider].task = '';
    this.render();
  },

  recordRouting(routing) {
    this.sessionStats.tasksRouted++;
    this.render();
  },

  recordMessage() {
    this.sessionStats.messages++;
    this.render();
  },

  recordTokens(provider, tokensIn, tokensOut, cost) {
    this.sessionStats.tokensIn += tokensIn || 0;
    this.sessionStats.tokensOut += tokensOut || 0;
    this.sessionStats.cost += cost || 0;
    if (this.AGENT_STATE[provider]) {
      this.AGENT_STATE[provider].cost += cost || 0;
    }
    this.render();
  },

  // Update health indicators from Sentinel reports
  updateHealthIndicators(results) {
    for (const [provider, status] of Object.entries(results)) {
      if (this.AGENT_STATE[provider]) {
        this.AGENT_STATE[provider].health = status;
      }
    }
    this.render();
  },

  render() {
    const grid = document.getElementById('agent-grid');
    if (!grid) return;

    const activeCount = Object.values(this.AGENT_STATE).filter(a => a.status === 'working').length;
    const countEl = document.getElementById('active-count');
    if (countEl) countEl.textContent = `${activeCount} active`;

    grid.innerHTML = Object.entries(this.AGENT_STATE).map(([key, agent]) => {
      const healthBadge = agent.health && agent.health !== 'healthy'
        ? `<div class="agent-health degraded">\u26A0 ${agent.health}</div>` : '';
      return `
      <div class="agent-card ${agent.status}">
        <div class="agent-name">
          <span class="dot" style="display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;background:${agent.status === 'working' ? '#00ff88' : '#333'}"></span>
          ${agent.name}
        </div>
        <div class="agent-status">${agent.status === 'working' ? '\u25CF WORKING' : '\u25CB IDLE'}</div>
        ${agent.task ? `<div class="agent-task">${agent.task}...</div>` : ''}
        <div class="agent-cost">Session: $${agent.cost.toFixed(4)}</div>
        ${healthBadge}
      </div>`;
    }).join('');

    // Render activity log
    const log = document.getElementById('activity-log');
    if (log) {
      log.innerHTML = this.activityLog.length === 0
        ? '<div style="padding:12px;color:#445566;font-size:11px;font-family:\'JetBrains Mono\',monospace;">No activity yet</div>'
        : this.activityLog.map(item => `
          <div class="activity-item">
            <span class="activity-time">${item.time}</span>
            <span class="activity-agent">${item.agent}</span>
            <span class="activity-desc">${item.desc}</span>
          </div>`).join('');
    }

    // Render session stats
    const stats = {
      'stat-messages': this.sessionStats.messages,
      'stat-providers': this.sessionStats.providersUsed.size,
      'stat-cost': '$' + this.sessionStats.cost.toFixed(2),
      'stat-tokens-in': this._formatNum(this.sessionStats.tokensIn),
      'stat-tokens-out': this._formatNum(this.sessionStats.tokensOut),
      'stat-routed': this.sessionStats.tasksRouted
    };
    for (const [id, val] of Object.entries(stats)) {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    }

    this.renderCostChart();
  },

  renderCostChart() {
    const container = document.getElementById('cost-chart');
    if (!container) return;

    const costs = Object.entries(this.AGENT_STATE)
      .filter(([_, a]) => a.cost > 0)
      .sort((a, b) => b[1].cost - a[1].cost);

    if (costs.length === 0) {
      container.innerHTML = '<div style="padding:12px;color:#445566;font-size:11px;font-family:\'JetBrains Mono\',monospace;">No cost data yet</div>';
      return;
    }

    const maxCost = Math.max(...costs.map(([_, a]) => a.cost));
    const colors = {
      claude: '#00a8ff', openai: '#00ff88', deepseek: '#ffb400',
      mistral: '#ff6b6b', perplexity: '#48cae4', gemini: '#ff00ff', dalle: '#ffd166'
    };

    container.innerHTML = `<div class="cost-chart">${costs.map(([key, agent]) => {
      const height = Math.max(4, (agent.cost / maxCost) * 50);
      const color = colors[key] || '#00a8ff';
      return `<div class="cost-bar" style="height:${height}px;background:${color};">
        <div class="cost-bar-label">${agent.name}<br>$${agent.cost.toFixed(3)}</div>
      </div>`;
    }).join('')}</div>`;
  },

  _formatNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }
};
