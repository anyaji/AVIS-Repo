const StabilityProvider = {
  name: 'stability',
  displayName: 'Stability AI',
  models: [
    { id: 'stable-diffusion-xl-1024-v1-0', name: 'SDXL', tier: 0 }
  ],
  costs: {
    'stable-diffusion-xl-1024-v1-0': { input: 0, output: 0, perImage: 0.04 }
  },
  currentModelIndex: 0,
  status: 'unconfigured',
  imagesGenerated: 0,

  getCurrentModel() { return this.models[this.currentModelIndex]; },
  getModelById(id) { return this.models.find(m => m.id === id); },
  stepDown() { return { stepped: false }; },
  stepUp() {},
  resetTier() { this.currentModelIndex = 0; this.status = 'active'; },
  setModel(id) {},

  async call(messages, systemPrompt, options = {}) {
    const result = await window.avis.apiCall({ provider: 'stability', model: this.getCurrentModel().id, messages, systemPrompt, options });
    if (!result.error) this.imagesGenerated++;
    return result;
  }
};
