const GrokProvider = {
  name: 'grok',
  displayName: 'Grok',
  models: [
    { id: 'grok-2', name: 'Grok-2', tier: 0 },
    { id: 'grok-1', name: 'Grok-1', tier: 1 }
  ],
  costs: {
    'grok-2': { input: 5, output: 15 },
    'grok-1': { input: 2, output: 6 }
  },
  currentModelIndex: 0,
  status: 'unconfigured',

  getCurrentModel() { return this.models[this.currentModelIndex]; },
  getModelById(id) { return this.models.find(m => m.id === id); },
  stepDown() {
    if (this.currentModelIndex < this.models.length - 1) {
      const prev = this.getCurrentModel().name;
      this.currentModelIndex++;
      this.status = 'stepped-down';
      return { stepped: true, from: prev, to: this.getCurrentModel().name };
    }
    return { stepped: false };
  },
  stepUp() { if (this.currentModelIndex > 0) { this.currentModelIndex--; this.status = 'active'; } },
  resetTier() { this.currentModelIndex = 0; this.status = 'active'; },
  setModel(id) { const i = this.models.findIndex(m => m.id === id); if (i !== -1) this.currentModelIndex = i; },
  async call(messages, systemPrompt, options = {}) {
    return await window.avis.apiCall({ provider: 'grok', model: options.model || this.getCurrentModel().id, messages, systemPrompt, options });
  }
};
