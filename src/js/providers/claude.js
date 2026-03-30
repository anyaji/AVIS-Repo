// Claude Provider Module
const ClaudeProvider = {
  name: 'claude',
  displayName: 'Claude',
  models: [
    { id: 'claude-opus-4-20250514', name: 'Opus', tier: 0 },
    { id: 'claude-sonnet-4-20250514', name: 'Sonnet', tier: 1 },
    { id: 'claude-haiku-4-5-20251001', name: 'Haiku', tier: 2 }
  ],
  costs: {
    'claude-opus-4-20250514': { input: 15, output: 75 },
    'claude-sonnet-4-20250514': { input: 3, output: 15 },
    'claude-haiku-4-5-20251001': { input: 0.25, output: 1.25 }
  },
  currentModelIndex: 1, // Start with Sonnet
  status: 'unconfigured',

  getCurrentModel() {
    return this.models[this.currentModelIndex];
  },

  getModelById(id) {
    return this.models.find(m => m.id === id);
  },

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

  stepUp() {
    if (this.currentModelIndex > 0) {
      this.currentModelIndex--;
      this.status = 'active';
    }
  },

  resetTier() {
    this.currentModelIndex = 1;
    this.status = 'active';
  },

  setModel(modelId) {
    const idx = this.models.findIndex(m => m.id === modelId);
    if (idx !== -1) this.currentModelIndex = idx;
  },

  async call(messages, systemPrompt, options = {}) {
    const model = options.model || this.getCurrentModel().id;
    return await window.avis.apiCall({
      provider: 'claude',
      model,
      messages,
      systemPrompt,
      options
    });
  }
};
