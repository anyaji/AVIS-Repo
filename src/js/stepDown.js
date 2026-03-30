// Step-Down Manager - Auto model degradation logic
const StepDownManager = {
  log: [],

  checkAndApply(providerObj, reason) {
    const result = providerObj.stepDown();
    if (result.stepped) {
      const entry = {
        provider: providerObj.displayName,
        from: result.from,
        to: result.to,
        reason: reason,
        timestamp: new Date().toISOString()
      };
      this.log.push(entry);
      this.showBanner(entry);
      return true;
    }
    return false;
  },

  handleApiError(providerObj, error) {
    const msg = error?.message || error || '';
    // Rate limit detection
    if (msg.includes('429') || msg.includes('rate_limit') || msg.includes('Rate limit')) {
      providerObj.status = 'limited';
      return this.checkAndApply(providerObj, 'Rate limited');
    }
    return false;
  },

  handleLatency(providerObj, latencyMs) {
    if (latencyMs > 15000) {
      return this.checkAndApply(providerObj, `High latency: ${(latencyMs / 1000).toFixed(1)}s`);
    }
    return false;
  },

  handleUsageThreshold(providerObj, usageResult) {
    if (usageResult.hardStop) {
      providerObj.status = 'offline';
      return false; // Don't step down, just stop
    }
    if (usageResult.shouldStepDown) {
      return this.checkAndApply(providerObj, usageResult.reason);
    }
    return false;
  },

  showBanner(entry) {
    const chatArea = document.getElementById('chat-area');
    const banner = document.createElement('div');
    banner.className = 'step-down-banner';
    banner.textContent = `${entry.provider} stepped down: ${entry.from} → ${entry.to} (${entry.reason})`;
    chatArea.appendChild(banner);
    chatArea.scrollTop = chatArea.scrollHeight;

    setTimeout(() => banner.remove(), 10000);
  },

  getLog() {
    return [...this.log];
  },

  clearLog() {
    this.log = [];
  }
};
