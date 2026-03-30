const OpenAIProvider = {
  name: 'openai',
  displayName: 'OpenAI',
  models: [
    { id: 'gpt-4o', name: 'GPT-4o', tier: 0 },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', tier: 1 },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', tier: 2 }
  ],
  costs: {
    'gpt-4o': { input: 5, output: 15 },
    'gpt-4-turbo': { input: 10, output: 30 },
    'gpt-3.5-turbo': { input: 0.5, output: 1.5 }
  },
  currentModelIndex: 0,
  status: 'unconfigured',

  getCurrentModel() { return this.models[this.currentModelIndex]; },
  getModelById(id) { return this.models.find(m => m.id === id); },

  stepDown() {
    if (this.currentModelIndex < this.models.length - 1) {
      const prev = this.getCurrentModel().name;
      this.currentModelIndex++;
      const next = this.getCurrentModel().name;
      this.status = 'stepped-down';
      return { stepped: true, from: prev, to: next };
    }
    return { stepped: false };
  },

  stepUp() { if (this.currentModelIndex > 0) { this.currentModelIndex--; this.status = 'active'; } },
  resetTier() { this.currentModelIndex = 0; this.status = 'active'; },
  setModel(id) { const i = this.models.findIndex(m => m.id === id); if (i !== -1) this.currentModelIndex = i; },

  async call(messages, systemPrompt, options = {}) {
    const model = options.model || this.getCurrentModel().id;
    return await window.avis.apiCall({ provider: 'openai', model, messages, systemPrompt, options });
  }
};
