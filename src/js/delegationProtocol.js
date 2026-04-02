// Delegation Protocol — JARVIS-style strict routing rules
// Routes tasks to the cheapest capable provider before falling back to Claude

const DelegationProtocol = {
  RULES: {
    rule1: 'NEVER answer with Claude when a cheaper provider can handle it.',
    rule2: 'Always think before delegating. Classify the task first, then route.',
    rule3: 'Always review provider output before presenting to user. Quality gate.',
    rule4: 'When in doubt: can a cheaper model handle this? If yes — delegate.',
    rule5: 'Always show the user who is working on what. Transparency required.',
    rule6: 'Use multiple providers on a single task when it improves output.',
    rule7: 'If a provider fails twice on same task — escalate to Claude directly.',
    rule8: 'Writing tasks always route to Mistral first.'
  },

  TASK_ROUTING: {
    coding: {
      triggers: ['code', 'build', 'fix', 'debug', 'script', 'function', 'bug', 'error', 'program', 'develop', 'refactor'],
      agent: 'GPT-4o',
      agentKey: 'openai',
      fallback: 'DeepSeek',
      fallbackKey: 'deepseek',
      brief: 'Write clean, working code for: {task}',
      systemPrompt: 'You are an expert software engineer. Write clean, correct, production-ready code. Include comments only where logic is non-obvious. Return code in fenced code blocks with the language specified.'
    },
    research: {
      triggers: ['search', 'find', 'latest', 'news', 'current', 'today', 'price', 'who is', 'what is', 'recent', 'how many'],
      agent: 'Perplexity',
      agentKey: 'perplexity',
      fallback: 'DeepSeek',
      fallbackKey: 'deepseek',
      brief: 'Research and return key facts on: {task}',
      systemPrompt: 'You are a research specialist. Provide accurate, current, well-sourced information. Lead with the answer, then supporting details. Cite sources when possible.'
    },
    writing: {
      triggers: ['write', 'draft', 'email', 'letter', 'post', 'content', 'rewrite', 'edit', 'proofread', 'blog', 'tweet'],
      agent: 'Mistral',
      agentKey: 'mistral',
      fallback: 'Claude',
      fallbackKey: 'claude',
      brief: 'Write concise, direct content for: {task}',
      systemPrompt: 'You are a professional writer. Write clear, concise, polished content. Match the requested tone and format exactly. No filler, no fluff.'
    },
    image: {
      triggers: ['image', 'picture', 'generate', 'draw', 'wallpaper', 'photo', 'design', 'art'],
      agent: 'DALL-E 3',
      agentKey: 'openai',
      fallback: null,
      fallbackKey: null,
      brief: 'Generate high quality image: {task}',
      systemPrompt: null
    },
    analysis: {
      triggers: ['analyze', 'compare', 'explain', 'summarize', 'pros and cons', 'evaluate', 'assess', 'review', 'think about'],
      agent: 'Claude',
      agentKey: 'claude',
      fallback: 'GPT-4o',
      fallbackKey: 'openai',
      brief: 'Analyze and provide clear insights on: {task}',
      systemPrompt: 'You are an analytical expert. Break down the topic systematically. Provide balanced, evidence-based analysis with clear conclusions.'
    },
    strategy: {
      triggers: ['plan', 'strategy', 'decide', 'should i', 'recommend', 'advise', 'best way', 'how do i', 'architecture'],
      agent: 'Claude',
      agentKey: 'claude',
      fallback: null,
      fallbackKey: null,
      brief: 'Claude handles strategy directly',
      systemPrompt: null
    },
    computer: {
      triggers: ['open', 'launch', 'click', 'control', 'screenshot', 'navigate', 'close', 'type'],
      agent: 'Claude',
      agentKey: 'claude',
      fallback: null,
      fallbackKey: null,
      brief: 'Claude handles computer control directly',
      systemPrompt: null
    }
  },

  // ====================================================================
  // Browser Task Detection — auto-route to Chrome Agent
  // ====================================================================
  BROWSER_TASK_TRIGGERS: {
    navigate: ['go to', 'navigate to', 'open', 'visit', 'load', 'browse to', 'take me to'],
    fill: ['fill out', 'fill in', 'complete the form', 'submit', 'enter my', 'type in', 'put in'],
    task: ['finish', 'complete', 'do my', 'handle', 'assignment', 'homework', 'apply for',
           'sign up', 'register', 'log in', 'login', 'download from', 'upload to', 'buy',
           'order', 'book', 'schedule', 'find on'],
    research: ['search on', 'look up on', 'find on', 'check on', 'see on', 'read on']
  },

  isBrowserTask(message) {
    const msg = message.toLowerCase();
    const hasUrl = /https?:\/\/|www\.|\.com|\.gov|\.edu|\.org/.test(msg);
    const hasTrigger = Object.values(this.BROWSER_TASK_TRIGGERS)
      .flat()
      .some(trigger => msg.includes(trigger));
    const hasWebsite = /website|webpage|site|page|portal|platform/.test(msg);
    return hasUrl || (hasTrigger && hasWebsite) || (hasTrigger && hasUrl);
  },

  extractUrl(message) {
    const urlMatch = message.match(/https?:\/\/[^\s]+|www\.[^\s]+/);
    if (urlMatch) return urlMatch[0];
    const siteMatch = message.match(
      /(?:go to|open|navigate to|visit)\s+([a-zA-Z0-9.-]+(?:\.[a-zA-Z]{2,}))/i
    );
    if (siteMatch) {
      const site = siteMatch[1];
      return site.startsWith('http') ? site : `https://${site}`;
    }
    return null;
  },

  classifyBrowserTask(message) {
    const msg = message.toLowerCase();
    if (this.BROWSER_TASK_TRIGGERS.fill.some(t => msg.includes(t))) return 'form_filling';
    if (this.BROWSER_TASK_TRIGGERS.task.some(t => msg.includes(t))) return 'task_execution';
    if (this.BROWSER_TASK_TRIGGERS.research.some(t => msg.includes(t))) return 'web_research';
    return 'navigation';
  },

  selectBrowserModel(taskType, complexity) {
    if (taskType === 'navigation' || complexity === 'simple') return 'claude-haiku-4-5-20251001';
    if (taskType === 'form_filling' || taskType === 'web_research') return 'claude-sonnet-4-20250514';
    if (taskType === 'task_execution' && complexity === 'complex') return 'claude-opus-4-5';
    return 'claude-sonnet-4-20250514';
  },

  // Provider failure tracker for rule 7 (escalate after 2 failures)
  _failCounts: {},
  // Cache for semantic classification to avoid repeated Haiku calls
  _classifyCache: {},

  resetFailures() {
    this._failCounts = {};
  },

  recordFailure(provider) {
    this._failCounts[provider] = (this._failCounts[provider] || 0) + 1;
    return this._failCounts[provider];
  },

  shouldEscalate(provider) {
    return (this._failCounts[provider] || 0) >= 2;
  },

  // Semantic classification via Claude Haiku — fast, cheap, accurate
  async classifyWithHaiku(message) {
    try {
      const cacheKey = message.toLowerCase().trim().substring(0, 100);
      if (this._classifyCache[cacheKey]) return this._classifyCache[cacheKey];

      const result = await window.avis.apiCallAgentic({
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'user', content: message }],
        systemPrompt: `Classify this user message into exactly ONE category. Respond with ONLY the category name, nothing else.

Categories:
- coding (writing code, debugging, scripts, programming, technical implementation)
- research (searching for info, current events, facts, prices, people, news)
- writing (drafting emails, letters, blog posts, creative writing, editing text)
- image (generating images, pictures, art, design, wallpapers)
- analysis (analyzing data, comparing options, explaining concepts, summarizing)
- strategy (planning, decision-making, recommendations, architecture decisions)
- computer (launching apps, clicking, screenshots, desktop automation)
- general (greetings, chitchat, simple questions, anything that doesn't fit above)

Respond with ONE word only.`,
        tools: []
      });

      if (!result.error && result.content) {
        const category = result.content
          .filter(b => b.type === 'text')
          .map(b => b.text.trim().toLowerCase())
          .join('');

        if (this.TASK_ROUTING[category] || category === 'general') {
          this._classifyCache[cacheKey] = category;
          // Keep cache small
          const keys = Object.keys(this._classifyCache);
          if (keys.length > 50) delete this._classifyCache[keys[0]];
          return category;
        }
      }
    } catch (e) {
      // Haiku unavailable — fall through to keyword matching
    }
    return null;
  },

  // Keyword-based fallback classification
  classifyByKeywords(message) {
    const msg = message.toLowerCase();
    for (const [type, config] of Object.entries(this.TASK_ROUTING)) {
      if (config.triggers.some(t => msg.includes(t))) {
        return type;
      }
    }
    return 'general';
  },

  // Main entry: try semantic first, fall back to keywords
  async classifyAndRoute(message) {
    // Try semantic classification first (fast Haiku call)
    let taskType = await this.classifyWithHaiku(message);

    // Fall back to keyword matching if Haiku unavailable
    if (!taskType) {
      taskType = this.classifyByKeywords(message);
    }

    const config = this.TASK_ROUTING[taskType];
    if (!config) {
      return {
        taskType: 'general',
        agent: 'Claude',
        agentKey: 'claude',
        fallback: null,
        fallbackKey: null,
        brief: message,
        systemPrompt: null
      };
    }

    return {
      taskType,
      agent: config.agent,
      agentKey: config.agentKey,
      fallback: config.fallback,
      fallbackKey: config.fallbackKey,
      brief: config.brief.replace('{task}', message),
      systemPrompt: config.systemPrompt
    };
  }
};
