// Delegation Protocol — JARVIS-style strict routing rules
// Routes tasks to the cheapest capable provider before falling back to Claude

const DelegationProtocol = {
  RULES: {
    rule1: 'NEVER answer with Claude when a cheaper provider can handle it. Claude costs $3/$15 per million. DeepSeek costs $0.27/$1.10. Perplexity costs $1/$1. Delegate.',
    rule2: 'Always think before delegating. Classify the task first, then route. Write a sharp brief to the provider, not your full reasoning.',
    rule3: 'Always review provider output before presenting to user. You are the quality gate. If output is poor, retry with better brief.',
    rule4: 'When in doubt: can a cheaper model handle this? If yes — delegate. Claude handles: strategy, complex reasoning, orchestration only.',
    rule5: 'Always show the user who is working on what. Transparency is required.',
    rule6: 'Use multiple providers on a single task when it improves output. Research + synthesize is Perplexity + Claude pattern.',
    rule7: 'If a provider fails twice on same task — escalate to Claude directly.',
    rule8: 'Writing tasks always route to Mistral first. Mistral knows concise output.'
  },

  TASK_ROUTING: {
    coding: {
      triggers: ['code', 'build', 'fix', 'debug', 'script', 'function', 'bug', 'error', 'program', 'develop', 'refactor'],
      agent: 'GPT-4o',
      agentKey: 'openai',
      fallback: 'DeepSeek',
      fallbackKey: 'deepseek',
      brief: 'Write clean, working code for: {task}'
    },
    research: {
      triggers: ['search', 'find', 'latest', 'news', 'current', 'today', 'price', 'who is', 'what is', 'recent', 'how many'],
      agent: 'Perplexity',
      agentKey: 'perplexity',
      fallback: 'DeepSeek',
      fallbackKey: 'deepseek',
      brief: 'Research and return key facts on: {task}'
    },
    writing: {
      triggers: ['write', 'draft', 'email', 'letter', 'post', 'content', 'rewrite', 'edit', 'proofread', 'blog', 'tweet'],
      agent: 'Mistral',
      agentKey: 'mistral',
      fallback: 'Claude',
      fallbackKey: 'claude',
      brief: 'Write concise, direct content for: {task}'
    },
    image: {
      triggers: ['image', 'picture', 'generate', 'draw', 'wallpaper', 'photo', 'design', 'art'],
      agent: 'DALL-E 3',
      agentKey: 'openai',
      fallback: null,
      fallbackKey: null,
      brief: 'Generate high quality image: {task}'
    },
    analysis: {
      triggers: ['analyze', 'compare', 'explain', 'summarize', 'pros and cons', 'evaluate', 'assess', 'review', 'think about'],
      agent: 'Claude',
      agentKey: 'claude',
      fallback: 'GPT-4o',
      fallbackKey: 'openai',
      brief: 'Analyze and provide clear insights on: {task}'
    },
    strategy: {
      triggers: ['plan', 'strategy', 'decide', 'should i', 'recommend', 'advise', 'best way', 'how do i', 'architecture'],
      agent: 'Claude',
      agentKey: 'claude',
      fallback: null,
      fallbackKey: null,
      brief: 'Claude handles strategy directly'
    },
    computer: {
      triggers: ['open', 'launch', 'click', 'control', 'screenshot', 'navigate', 'close', 'type'],
      agent: 'Claude',
      agentKey: 'claude',
      fallback: null,
      fallbackKey: null,
      brief: 'Claude handles computer control directly'
    }
  },

  // Provider failure tracker for rule 7 (escalate after 2 failures)
  _failCounts: {},

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

  classifyAndRoute(message) {
    const msg = message.toLowerCase();

    for (const [type, config] of Object.entries(this.TASK_ROUTING)) {
      if (config.triggers.some(t => msg.includes(t))) {
        return {
          taskType: type,
          agent: config.agent,
          agentKey: config.agentKey,
          fallback: config.fallback,
          fallbackKey: config.fallbackKey,
          brief: config.brief.replace('{task}', message)
        };
      }
    }

    // Default — Claude handles
    return {
      taskType: 'general',
      agent: 'Claude',
      agentKey: 'claude',
      fallback: null,
      fallbackKey: null,
      brief: message
    };
  }
};
