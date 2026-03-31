// Usage Meter - Token tracking, cost calculation, limit detection
const UsageMeter = {
  providers: {},

  init() {
    const providerNames = ['claude', 'deepseek', 'openai', 'gemini', 'mistral', 'perplexity'];
    const stored = JSON.parse(localStorage.getItem('avis-usage') || '{}');

    for (const name of providerNames) {
      this.providers[name] = {
        sessionTokensIn: 0,
        sessionTokensOut: 0,
        monthTokensIn: stored[name]?.monthTokensIn || 0,
        monthTokensOut: stored[name]?.monthTokensOut || 0,
        monthStarted: stored[name]?.monthStarted || new Date().toISOString().slice(0, 7),
        sessionCost: 0,
        monthCost: stored[name]?.monthCost || 0,
        budgetLimit: stored[name]?.budgetLimit || 50,
        stepDownThreshold: stored[name]?.stepDownThreshold || 80,
        autoStepDown: stored[name]?.autoStepDown !== false
      };

      // Reset monthly counters if new month
      const currentMonth = new Date().toISOString().slice(0, 7);
      if (this.providers[name].monthStarted !== currentMonth) {
        this.providers[name].monthTokensIn = 0;
        this.providers[name].monthTokensOut = 0;
        this.providers[name].monthCost = 0;
        this.providers[name].monthStarted = currentMonth;
      }
    }
  },

  record(providerName, inputTokens, outputTokens, providerObj) {
    const usage = this.providers[providerName];
    if (!usage) return;

    usage.sessionTokensIn += inputTokens;
    usage.sessionTokensOut += outputTokens;
    usage.monthTokensIn += inputTokens;
    usage.monthTokensOut += outputTokens;

    // Calculate cost
    const model = providerObj.getCurrentModel().id;
    const costs = providerObj.costs[model];
    if (costs) {
      const costIn = (inputTokens / 1000000) * (costs.input || 0);
      const costOut = (outputTokens / 1000000) * (costs.output || 0);
      usage.sessionCost += costIn + costOut;
      usage.monthCost += costIn + costOut;
    }

    this.persist();
    return this.checkThresholds(providerName);
  },

  checkThresholds(providerName) {
    const usage = this.providers[providerName];
    if (!usage) return { shouldStepDown: false };

    const budgetPercent = (usage.monthCost / usage.budgetLimit) * 100;

    if (budgetPercent >= 100) {
      return { shouldStepDown: false, hardStop: true, reason: 'Budget limit reached' };
    }

    if (usage.autoStepDown && budgetPercent >= usage.stepDownThreshold) {
      return { shouldStepDown: true, reason: `Cost at ${budgetPercent.toFixed(0)}% of budget` };
    }

    return { shouldStepDown: false };
  },

  getUsagePercent(providerName) {
    const usage = this.providers[providerName];
    if (!usage || usage.budgetLimit === 0) return 0;
    return Math.min(100, (usage.monthCost / usage.budgetLimit) * 100);
  },

  resetSession(providerName) {
    const usage = this.providers[providerName];
    if (usage) {
      usage.sessionTokensIn = 0;
      usage.sessionTokensOut = 0;
      usage.sessionCost = 0;
    }
  },

  persist() {
    const data = {};
    for (const [name, usage] of Object.entries(this.providers)) {
      data[name] = {
        monthTokensIn: usage.monthTokensIn,
        monthTokensOut: usage.monthTokensOut,
        monthCost: usage.monthCost,
        monthStarted: usage.monthStarted,
        budgetLimit: usage.budgetLimit,
        stepDownThreshold: usage.stepDownThreshold,
        autoStepDown: usage.autoStepDown
      };
    }
    localStorage.setItem('avis-usage', JSON.stringify(data));
  },

  formatTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
  },

  formatCost(n) {
    return '$' + n.toFixed(4);
  }
};
