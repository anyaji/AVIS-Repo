const PerplexityProvider = {
  name: 'perplexity',
  displayName: 'Perplexity',
  models: [
    { id: 'sonar-pro', name: 'Sonar Pro', tier: 0 },
    { id: 'sonar', name: 'Sonar', tier: 1 }
  ],
  costs: {
    'sonar-pro': { input: 3, output: 15 },
    'sonar': { input: 1, output: 1 }
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
    return await window.avis.apiCall({ provider: 'perplexity', model: options.model || this.getCurrentModel().id, messages, systemPrompt, options });
  }
};
