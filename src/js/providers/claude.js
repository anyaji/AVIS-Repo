// Claude Provider Module
const ClaudeProvider = {
  name: 'claude',
  displayName: 'Claude',
  models: [
    { id: 'claude-fable-5', name: 'Fable 5', tier: 0 },
    { id: 'claude-opus-4-8', name: 'Opus', tier: 1 },
    { id: 'claude-sonnet-4-6', name: 'Sonnet', tier: 2 },
    { id: 'claude-haiku-4-5-20251001', name: 'Haiku', tier: 3 }
  ],
  costs: {
    'claude-fable-5': { input: 10, output: 50 },
    'claude-opus-4-8': { input: 5, output: 25 },
    'claude-sonnet-4-6': { input: 3, output: 15 },
    'claude-haiku-4-5-20251001': { input: 1, output: 5 }
  },
  currentModelIndex: 0, // Start with Fable 5
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
    this.currentModelIndex = 0;
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
