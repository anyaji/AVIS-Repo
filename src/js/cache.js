// Response Cache — same prompt within TTL returns cached answer
// Saves tokens, saves money, instant response
const ResponseCache = {
  _cache: new Map(),
  TTL: 60 * 60 * 1000,  // 1 hour
  maxSize: 100,

  _hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h).toString(36);
  },

  _key(provider, prompt) {
    const norm = prompt.toLowerCase().trim().replace(/\s+/g, ' ');
    return `${provider}:${this._hash(norm)}`;
  },

  get(provider, prompt) {
    const k = this._key(provider, prompt);
    const entry = this._cache.get(k);
    if (!entry) return null;
    if (Date.now() - entry.ts > this.TTL) { this._cache.delete(k); return null; }
    return entry.response;
  },

  set(provider, prompt, response) {
    if (!response || (typeof response === 'string' && response.length < 10)) return;
    // Don't cache time-sensitive queries
    if (/today|now|current|latest|live|real.?time|news/i.test(prompt)) return;

    // Enforce max size
    if (this._cache.size >= this.maxSize) {
      const oldest = [...this._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) this._cache.delete(oldest[0]);
    }

    this._cache.set(this._key(provider, prompt), {
      response,
      ts: Date.now(),
      provider,
      preview: prompt.substring(0, 50)
    });
  },

  clear() { this._cache.clear(); },

  stats() {
    return {
      size: this._cache.size,
      entries: [...this._cache.values()].map(e => ({
        provider: e.provider,
        preview: e.preview,
        age: Math.round((Date.now() - e.ts) / 60000) + 'm'
      }))
    };
  }
};
