const GeminiProvider = {
  name: 'gemini',
  displayName: 'Gemini',
  models: [
    { id: 'gemini-ultra', name: 'Ultra', tier: 0 },
    { id: 'gemini-pro', name: 'Pro', tier: 1 },
    { id: 'gemini-1.5-flash', name: 'Flash', tier: 2 }
  ],
  costs: {
    'gemini-ultra': { input: 7, output: 21 },
    'gemini-pro': { input: 0.35, output: 1.05 },
    'gemini-1.5-flash': { input: 0.075, output: 0.3 }
  },
  currentModelIndex: 1,
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
  resetTier() { this.currentModelIndex = 1; this.status = 'active'; },
  setModel(id) { const i = this.models.findIndex(m => m.id === id); if (i !== -1) this.currentModelIndex = i; },
  async call(messages, systemPrompt, options = {}) {
    return await window.avis.apiCall({ provider: 'gemini', model: options.model || this.getCurrentModel().id, messages, systemPrompt, options });
  }
};
