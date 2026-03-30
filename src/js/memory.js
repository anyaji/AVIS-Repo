// Memory Manager - Session + cross-session task history
const MemoryManager = {
  memories: [],
  conversations: [],
  currentConversation: null,

  async init() {
    this.memories = await window.avis.getMemories() || [];
    this.currentConversation = {
      id: this.generateId(),
      date: new Date().toISOString(),
      messages: [],
      title: 'New Conversation'
    };
  },

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },

  // Pinned memories
  async addMemory(text) {
    this.memories.push({ id: this.generateId(), text, created: new Date().toISOString() });
    await window.avis.saveMemories(this.memories);
  },

  async removeMemory(id) {
    this.memories = this.memories.filter(m => m.id !== id);
    await window.avis.saveMemories(this.memories);
  },

  getMemoriesForPrompt() {
    if (this.memories.length === 0) return '';
    return '\n\nUser pinned memories:\n' + this.memories.map(m => `- ${m.text}`).join('\n');
  },

  // Conversation tracking
  addMessage(role, content, provider, model) {
    const msg = { role, content, provider, model, timestamp: new Date().toISOString() };
    if (this.currentConversation) {
      this.currentConversation.messages.push(msg);
      if (this.currentConversation.messages.length === 1 && role === 'user') {
        this.currentConversation.title = content.slice(0, 60) + (content.length > 60 ? '...' : '');
      }
    }
    return msg;
  },

  async saveCurrentConversation() {
    if (!this.currentConversation || this.currentConversation.messages.length === 0) return;
    const dateStr = new Date().toISOString().slice(0, 10);

    let dayData = await window.avis.loadHistory(dateStr) || { conversations: [] };
    const existingIdx = dayData.conversations.findIndex(c => c.id === this.currentConversation.id);
    if (existingIdx !== -1) {
      dayData.conversations[existingIdx] = this.currentConversation;
    } else {
      dayData.conversations.push(this.currentConversation);
    }
    await window.avis.saveHistory(dateStr, dayData);
  },

  async startNewConversation() {
    await this.saveCurrentConversation();
    this.currentConversation = {
      id: this.generateId(),
      date: new Date().toISOString(),
      messages: [],
      title: 'New Conversation'
    };
  },

  async listHistory() {
    return await window.avis.listHistory();
  },

  async loadConversation(dateStr, conversationId) {
    const dayData = await window.avis.loadHistory(dateStr);
    if (!dayData) return null;
    if (conversationId) {
      return dayData.conversations.find(c => c.id === conversationId);
    }
    return dayData;
  },

  getConversationMessages() {
    if (!this.currentConversation) return [];
    return this.currentConversation.messages.map(m => ({
      role: m.role,
      content: m.content
    }));
  }
};
