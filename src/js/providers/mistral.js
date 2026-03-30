const MistralProvider = {
  name: 'mistral',
  displayName: 'Mistral',
  models: [
    { id: 'mistral-large-latest', name: 'Large', tier: 0 },
    { id: 'mistral-medium-latest', name: 'Medium', tier: 1 },
    { id: 'mistral-small-latest', name: 'Small', tier: 2 }
  ],
  costs: {
    'mistral-large-latest': { input: 4, output: 12 },
    'mistral-medium-latest': { input: 2.7, output: 8.1 },
    'mistral-small-latest': { input: 1, output: 3 }
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
    return await window.avis.apiCall({ provider: 'mistral', model: options.model || this.getCurrentModel().id, messages, systemPrompt, options });
  }
};
