// Orchestrator - Claude admin brain + multi-AI provider tools + agentic loop
const Orchestrator = {
  SYSTEM_PROMPT: `You are AVIS — Avel Intelligence Services by Avel Productions LLC.
You are the orchestrator and admin brain. You ARE Claude Sonnet — running as the core intelligence.

PROVIDERS YOU CAN CALL RIGHT NOW:
- call_claude — Delegate to Claude Opus (deep reasoning) or Haiku (fast tasks). You ARE already Claude Sonnet, but can call other Claude models for specialized work.
- call_claude_code — Launch Claude Code CLI to autonomously build apps, fix bugs, write scripts, modify project files. This runs the real claude CLI tool.
- call_gemini — Google Gemini Pro/Ultra (multimodal, long context, data analysis)
- call_gpt4 — OpenAI GPT-4o (code generation, math, structured output)
- call_deepseek — DeepSeek Chat/Reasoner (fast, cheap, strong reasoning)
- call_grok — xAI Grok-2 (real-time info, unfiltered, edgy queries)
- call_mistral — Mistral Large (fast, European data, cost efficient)
- call_perplexity — Perplexity live web search (current events, real-time data)
- call_stability — Stability AI (image generation from text prompts)
- run_parallel — Call multiple AIs simultaneously for comparison
- web_search — Search the web (Perplexity/Brave/DuckDuckGo/SearXNG)
- fetch_url — Read any webpage (uses Firecrawl for clean markdown if available)
- firecrawl_crawl — Crawl entire websites, returns all pages as markdown
- run_code — Execute JavaScript or Python
- read_file / write_file — Access the file system
- open_app — Launch applications
- launch_steam_game — Launch Steam games by name (uses Steam URL protocol, much faster than clicking around)
- computer_action — Control mouse and keyboard (DPI-aware, full desktop screenshots, click/double_click/right_click/type/key/scroll)
COMPUTER CONTROL WORKFLOW: Always screenshot FIRST to see the screen, identify coordinates, THEN click. Coordinates are auto-DPI-scaled.
- get_weather — Instant weather for any city (free, no API key)

ROUTING RULES:
- "call claude code" or "build/fix [project]" → call_claude_code
- "use opus" or complex deep reasoning → call_claude with opus model
- "quick/fast" simple tasks → call_claude with haiku model
- Current events/news → call_perplexity or web_search
- Code generation → call_gpt4 or call_claude_code
- Image generation → call_stability
- Comparisons → run_parallel
- Self-modification → write_file on your own source files

NEVER say a provider is unavailable if it's in the list above.
NEVER say you cannot call yourself, Claude Code, or other AIs.
NEVER open a browser to use another AI — call the API directly via tools.
Always show which provider answered with a badge in your response.

SELF-EDIT: You can edit your own source files at the path in system context.

FAST-PATH (answer immediately WITHOUT tools when possible):
- Date/time questions → you know the current date, just answer
- Simple math → calculate in your head, just answer
- General knowledge you're confident about → just answer
- Greetings, chitchat → just respond naturally
- ONLY use tools when you genuinely need external data or actions

For every user request:
1. First check: can I answer this directly without tools? If yes, just answer.
2. If tools are needed, use them efficiently — minimize tool calls.
3. Synthesize results into a clean, helpful response.
4. Always prioritize accuracy, then speed, then cost.`,

  // Base utility tools
  BASE_TOOLS: [
    {
      name: "web_search",
      description: "Search the web for current information using Perplexity/Brave/DuckDuckGo/SearXNG.",
      input_schema: { type: "object", properties: { query: { type: "string", description: "Search query" } }, required: ["query"] }
    },
    {
      name: "fetch_url",
      description: "Fetch and read clean markdown content from any URL/webpage. Uses Firecrawl for best results if available, falls back to headless browser.",
      input_schema: { type: "object", properties: { url: { type: "string", description: "URL to fetch and read" } }, required: ["url"] }
    },
    {
      name: "firecrawl_crawl",
      description: "Crawl an entire website and return all pages as clean markdown. Use for documentation sites, wikis, or when you need multiple pages from one domain.",
      input_schema: { type: "object", properties: { url: { type: "string", description: "Starting URL to crawl" }, limit: { type: "number", description: "Max pages to crawl (default 10)" } }, required: ["url"] }
    },
    {
      name: "run_code",
      description: "Execute JavaScript or Python code and return the output.",
      input_schema: { type: "object", properties: { language: { type: "string", enum: ["javascript", "python"] }, code: { type: "string" } }, required: ["language", "code"] }
    },
    {
      name: "read_file",
      description: "Read a file from the user's system. Supports text, PDFs, DOCX, images.",
      input_schema: { type: "object", properties: { path: { type: "string", description: "Absolute file path to read" } }, required: ["path"] }
    },
    {
      name: "write_file",
      description: "Write content to a file. If writing to an AVIS source file, the app hot-reloads.",
      input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }
    },
    {
      name: "open_app",
      description: "Open an application, file, or URL on Windows.",
      input_schema: { type: "object", properties: { target: { type: "string" } }, required: ["target"] }
    },
    {
      name: "get_weather",
      description: "Get current weather and 3-day forecast for any location. Free, instant, no API key needed. Use for any weather questions.",
      input_schema: { type: "object", properties: { location: { type: "string", description: "City name, e.g. 'Dallas TX' or 'London'" } }, required: ["location"] }
    },
    {
      name: "launch_steam_game",
      description: "Launch a Steam game by name. Much faster than computer control — uses Steam URL protocol or finds the exe directly. Use this instead of clicking around in Steam UI.",
      input_schema: { type: "object", properties: { game_name: { type: "string", description: "Name of the Steam game" }, app_id: { type: "string", description: "Steam AppID if known (optional)" } }, required: ["game_name"] }
    },
    {
      name: "computer_action",
      description: "Control the computer with DPI-aware coordinates. Actions: screenshot (full desktop), click (left click), double_click, right_click, type (text input), key (special keys like {ENTER}, ^c for Ctrl+C), scroll (up/down), move (cursor). IMPORTANT: Always take a screenshot first to see the screen, then click. Coordinates are automatically DPI-scaled.",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["screenshot", "click", "double_click", "right_click", "type", "key", "scroll", "move"], description: "Action to perform" },
          x: { type: "number", description: "X coordinate for click/move (pre-DPI, will be auto-scaled)" },
          y: { type: "number", description: "Y coordinate for click/move (pre-DPI, will be auto-scaled)" },
          text: { type: "string", description: "Text to type (for 'type' action) or key combo (for 'key' action, e.g. {ENTER}, ^c, %{F4})" },
          direction: { type: "string", enum: ["up", "down"], description: "Scroll direction" },
          amount: { type: "number", description: "Scroll amount (notches, default 3)" }
        },
        required: ["action"]
      }
    }
  ],

  // AI provider tools — added dynamically based on which have keys
  PROVIDER_TOOLS: [
    {
      name: "call_claude", provider: "claude",
      description: "Call a different Claude model for specialized tasks. Use claude-opus-4-5 for deep reasoning/analysis, claude-haiku-4-5 for fast simple subtasks. You (the orchestrator) are Sonnet — use this to delegate to Opus or Haiku.",
      input_schema: { type: "object", properties: { prompt: { type: "string", description: "Task to send to the Claude model" }, model: { type: "string", enum: ["claude-opus-4-5-20250514", "claude-sonnet-4-5-20250514", "claude-haiku-4-5-20251001"], description: "Which Claude model (default: opus)" } }, required: ["prompt"] }
    },
    {
      name: "call_claude_code", provider: null,
      description: "Launch Claude Code CLI to autonomously work on a coding project. It can build apps, fix bugs, write scripts, modify files. Runs the real 'claude' terminal command. Use for: 'build me an app', 'fix my project', 'write a script'.",
      input_schema: { type: "object", properties: { task: { type: "string", description: "What to build, fix, or do" }, project_path: { type: "string", description: "Path to the project directory to work in" }, flags: { type: "string", description: "CLI flags (default: --dangerously-skip-permissions)" } }, required: ["task", "project_path"] }
    },
    {
      name: "call_gemini", provider: "gemini",
      description: "Call Google Gemini for a task. Best for: multimodal analysis, long context, data analysis, Google ecosystem.",
      input_schema: { type: "object", properties: { prompt: { type: "string", description: "Task to send to Gemini" }, model: { type: "string", enum: ["gemini-1.5-pro", "gemini-1.5-flash"], description: "Model to use (default: gemini-1.5-pro)" } }, required: ["prompt"] }
    },
    {
      name: "call_gpt4", provider: "openai",
      description: "Call OpenAI GPT-4o for a task. Best for: code generation, data analysis, math, structured output, vision.",
      input_schema: { type: "object", properties: { prompt: { type: "string", description: "Task to send to GPT-4o" }, model: { type: "string", enum: ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"], description: "Model (default: gpt-4o)" } }, required: ["prompt"] }
    },
    {
      name: "call_deepseek", provider: "deepseek",
      description: "Call DeepSeek for a task. Best for: fast responses, strong reasoning, cost efficiency.",
      input_schema: { type: "object", properties: { prompt: { type: "string", description: "Task to send to DeepSeek" }, model: { type: "string", enum: ["deepseek-chat", "deepseek-reasoner"], description: "Model (default: deepseek-chat)" } }, required: ["prompt"] }
    },
    {
      name: "call_grok", provider: "grok",
      description: "Call xAI Grok for a task. Best for: real-time info, unfiltered analysis, edgy or controversial queries.",
      input_schema: { type: "object", properties: { prompt: { type: "string", description: "Task to send to Grok" } }, required: ["prompt"] }
    },
    {
      name: "call_mistral", provider: "mistral",
      description: "Call Mistral for a task. Best for: fast responses, European data, lightweight tasks, cost efficiency.",
      input_schema: { type: "object", properties: { prompt: { type: "string", description: "Task to send to Mistral" } }, required: ["prompt"] }
    },
    {
      name: "call_perplexity", provider: "perplexity",
      description: "Call Perplexity for live web search and current information. Use for current events, news, real-time data.",
      input_schema: { type: "object", properties: { query: { type: "string", description: "Search query or question requiring live web data" } }, required: ["query"] }
    },
    {
      name: "call_stability", provider: "stability",
      description: "Call Stability AI to generate images from text prompts.",
      input_schema: { type: "object", properties: { prompt: { type: "string", description: "Image generation prompt" } }, required: ["prompt"] }
    },
    {
      name: "run_parallel", provider: null,
      description: "Send the same task to multiple AIs simultaneously and get all responses. Use for comparisons or multiple perspectives.",
      input_schema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Task to send to all providers" },
          providers: { type: "array", items: { type: "string", enum: ["claude", "gemini", "gpt4", "deepseek", "grok", "mistral"] }, description: "Which providers to call" }
        },
        required: ["prompt", "providers"]
      }
    }
  ],

  providerMap: {
    claude: () => ClaudeProvider,
    deepseek: () => DeepSeekProvider,
    openai: () => OpenAIProvider,
    gemini: () => GeminiProvider,
    grok: () => GrokProvider,
    mistral: () => MistralProvider,
    perplexity: () => PerplexityProvider,
    stability: () => StabilityProvider
  },

  onStep: null,
  cancelled: false,
  avisPath: null,
  _stepCounter: 0,
  _loopStart: 0,
  _retryCount: 0,
  _lastTaskMessage: null,
  _lastTaskFiles: null,
  _lastToolUseLog: null,

  // FIX 2: Rate limit cooldown tracker and disabled providers
  rateLimitCooldowns: {},
  disabledProviders: {},  // { providerName: 'reason' }

  isProviderAvailable(name) {
    if (this.disabledProviders[name]) return false;
    if (this.rateLimitCooldowns[name] && this.rateLimitCooldowns[name] > Date.now()) return false;
    return true;
  },

  setRateLimitCooldown(name, ms = 60000) {
    this.rateLimitCooldowns[name] = Date.now() + ms;
  },

  disableProvider(name, reason) {
    this.disabledProviders[name] = reason;
    const obj = this.providerMap[name]?.();
    if (obj) obj.status = 'payment';
  },

  classifyAndHandleError(providerName, errMsg, errCode) {
    const msg = (errMsg || '').toLowerCase();
    const code = String(errCode || '');
    // Payment/billing
    if (msg.includes('payment') || msg.includes('billing') || code === '402' || msg.includes('insufficient_quota')) {
      this.disableProvider(providerName, 'Payment required');
      return { action: 'disable', reason: `${providerName} disabled — payment required` };
    }
    // Rate limit
    if (msg.includes('rate') || code === '429' || msg.includes('quota')) {
      this.setRateLimitCooldown(providerName, 60000);
      return { action: 'cooldown', reason: `${providerName} rate limited — 60s cooldown` };
    }
    // Overloaded / connection
    if (msg.includes('overloaded') || code === '529' || code === '503' || msg.includes('connection')) {
      return { action: 'retry', reason: `${providerName} temporarily unavailable` };
    }
    return { action: 'error', reason: errMsg };
  },

  // BUG 1: Dynamic iteration limits by task type
  ITERATION_LIMITS: {
    computer_control: 50,
    claude_code: 100,
    web_task: 25,
    file_task: 20,
    simple_chat: 5,
    default: 25
  },

  detectTaskType(message) {
    const msg = (message || '').toLowerCase();
    if (msg.includes('launch') || msg.includes('open app') || msg.includes('click') ||
        msg.includes('steam') || msg.includes('type into') || msg.includes('screenshot') ||
        msg.includes('mouse') || msg.includes('keyboard') || msg.includes('game')) {
      return 'computer_control';
    }
    if (msg.includes('build') || msg.includes('create app') || msg.includes('claude code') ||
        msg.includes('fix bug') || msg.includes('write a program') || msg.includes('make me a')) {
      return 'claude_code';
    }
    if (msg.includes('search') || msg.includes('find') || msg.includes('look up') ||
        msg.includes('navigate') || msg.includes('fetch') || msg.includes('browse')) {
      return 'web_task';
    }
    if (msg.includes('read file') || msg.includes('write file') || msg.includes('open file') ||
        msg.includes('edit file') || msg.includes('save')) {
      return 'file_task';
    }
    // Short messages without tool keywords = simple chat
    if (msg.length < 80 && !/search|call|launch|build|fetch|run|open|click/i.test(msg)) {
      return 'simple_chat';
    }
    return 'default';
  },

  // Build tools list dynamically — only include provider tools for configured providers
  // FIX 4: Only include tools for available providers
  async buildToolsList() {
    const tools = [...this.BASE_TOOLS];
    for (const pt of this.PROVIDER_TOOLS) {
      if (pt.provider === null) {
        tools.push({ name: pt.name, description: pt.description, input_schema: pt.input_schema });
      } else if ((await this.hasProvider(pt.provider)) && this.isProviderAvailable(pt.provider)) {
        tools.push({ name: pt.name, description: pt.description, input_schema: pt.input_schema });
      }
    }
    return tools;
  },

  // FIX 4: Build prompt with only truly available providers
  async buildSystemPrompt() {
    const providerNames = { claude: 'Claude (You)', gemini: 'Google Gemini', openai: 'OpenAI GPT-4o', deepseek: 'DeepSeek', grok: 'xAI Grok', mistral: 'Mistral', perplexity: 'Perplexity', stability: 'Stability AI' };
    const statuses = [];
    for (const [key, name] of Object.entries(providerNames)) {
      const hasKey = await this.hasProvider(key);
      if (!hasKey) {
        statuses.push(`- ${name}: NOT CONFIGURED`);
      } else if (this.disabledProviders[key]) {
        statuses.push(`- ${name}: DISABLED (${this.disabledProviders[key]})`);
      } else if (this.rateLimitCooldowns[key] > Date.now()) {
        statuses.push(`- ${name}: RATE LIMITED (cooldown)`);
      } else {
        statuses.push(`- ${name}: ACTIVE`);
      }
    }

    const avisPathNote = this.avisPath ? `\n\nYour own source code is located at: ${this.avisPath.replace(/\\/g, '/')}` : '';

    return this.SYSTEM_PROMPT +
      `\n\nCurrent provider status:\n${statuses.join('\n')}\n\nDO NOT attempt to call providers marked DISABLED or NOT CONFIGURED. Route only to ACTIVE providers.` +
      avisPathNote +
      MemoryManager.getMemoriesForPrompt() +
      (HotConfig.get('customSystemPrompt') ? '\n\n' + HotConfig.get('customSystemPrompt') : '');
  },

  parseError(rawMessage) {
    const raw = rawMessage || 'Unknown error';
    try { const m = raw.match(/\{[\s\S]*\}/); if (m) { const p = JSON.parse(m[0]); if (p?.error?.message) return p.error.message; } } catch (e) {}
    const patterns = [
      [/non-empty/i, 'Message was empty. Please type something or attach an image.'],
      [/invalid.?api.?key/i, 'API key is invalid. Check your key in Settings.'],
      [/rate.?limit|429/i, 'Rate limit hit. Stepping down to next model...'],
      [/context.?length|too.?long|maximum.*tokens/i, 'Message too long. Try a shorter message or start a new chat.'],
      [/overloaded|503|529/i, 'Claude is temporarily busy. Retrying...'],
      [/timed?\s*out/i, 'Request timed out after 30 seconds.'],
      [/cancelled|abort/i, 'Request was cancelled.'],
      [/EMPTY_CONTENT/i, 'No message content to send. Please type something.'],
    ];
    for (const [re, msg] of patterns) { if (re.test(raw)) return msg; }
    return raw.replace(/^Error:\s*\d+\s*/, '').replace(/^Error:\s*/, '').substring(0, 200);
  },

  isRetryableError(errMsg, code) {
    if (this._retryCount >= 3) return false;
    return /rate.?limit|429|overloaded|503|529/i.test((errMsg || '') + (code || ''));
  },

  isContextLengthError(errMsg) {
    return /context.?length|too.?long|maximum.*tokens/i.test(errMsg || '');
  },

  validateToolResult(result) {
    if (result === null || result === undefined) return 'Tool returned no result.';
    const str = typeof result === 'string' ? result : JSON.stringify(result);
    if (str.trim().length === 0) return 'Tool returned empty result.';
    if (str.length > 50000) return str.substring(0, 50000) + '\n\n[Content truncated — too large]';
    return str;
  },

  emitStep(type, message, status = 'running') {
    const id = `step-${++this._stepCounter}`;
    if (this.onStep) this.onStep(id, type, message, status);
    return id;
  },

  updateStep(id, message, status) {
    if (this.onStep) this.onStep(id, null, message, status);
  },

  async process(userMessage, files = []) {
    this.cancelled = false;
    this._stepCounter = 0;
    this._retryCount = 0;
    this._loopStart = Date.now();

    if ((!userMessage || !userMessage.trim()) && files.length > 0) {
      userMessage = files.some(f => f.type === 'image') ? 'Please analyze this image.' : 'Please analyze this file.';
    }
    if ((!userMessage || !userMessage.trim()) && files.length === 0) {
      return { text: 'Please type a message or attach a file.', provider: 'avis', model: 'system' };
    }

    if (!this.avisPath) {
      try { this.avisPath = await window.avis.getAvisPath(); } catch (e) { this.avisPath = ''; }
    }

    const hasAnyKey = await this.hasAnyProvider();
    if (!hasAnyKey) return { text: 'No API keys configured. Please open Settings and add at least one provider API key.', provider: 'avis', model: 'system' };

    const hasClaude = await this.hasProvider('claude');
    const hasImages = files.some(f => f.type === 'image');

    if (hasImages && !hasClaude) return await this.directCall('openai', userMessage, files);

    if (this.isImageGenRequest(userMessage)) {
      if (await this.hasProvider('stability')) return await this.directCall('stability', userMessage, files);
    }

    if (hasClaude) return await this.agenticLoop(userMessage, files);

    return await this.fallbackRoute(userMessage, files);
  },

  async agenticLoop(userMessage, files = []) {
    const systemPrompt = await this.buildSystemPrompt();
    const tools = await this.buildToolsList();

    const messages = [...MemoryManager.getConversationMessages()];
    const lastMsg = { role: 'user', content: userMessage };

    if (files.length > 0) {
      const images = files.filter(f => f.type === 'image').map(f => ({ data: f.data, mimeType: f.mimeType }));
      const textContent = files.filter(f => f.type === 'text').map(f => `[File: ${f.name}]\n${f.data}`).join('\n\n');
      if (textContent) lastMsg.content = textContent + '\n\n' + userMessage;
      if (images.length > 0) lastMsg.images = images;
    }

    messages.push(lastMsg);

    // BUG 1: Dynamic iteration limit based on task type
    const taskType = this.detectTaskType(userMessage);
    const MAX_ITERATIONS = this.ITERATION_LIMITS[taskType] || this.ITERATION_LIMITS.default;
    this._lastTaskMessage = userMessage;
    this._lastTaskFiles = files;
    let iteration = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const toolUseLog = [];

    const thinkStepId = this.emitStep('thinking', 'Analyzing your request...');

    while (iteration < MAX_ITERATIONS) {
      iteration++;
      if (this.cancelled) { this.updateStep(thinkStepId, 'Stopped by user', 'error'); return { text: 'Request cancelled.', provider: 'claude', model: 'cancelled', toolUseLog }; }

      this.emitStep('thinking', `Iteration ${iteration}/${MAX_ITERATIONS} — calling Claude...`);

      const response = await window.avis.apiCallAgentic({ model: ClaudeProvider.getCurrentModel().id, messages, systemPrompt, tools });

      if (this.cancelled) { this.updateStep(thinkStepId, 'Stopped by user', 'error'); return { text: 'Request cancelled.', provider: 'claude', model: 'cancelled', toolUseLog }; }

      if (response.error) {
        const friendlyMsg = this.parseError(response.message);
        if (response.code === 'ABORT') { this.emitStep('done', 'Stopped by user', 'error'); return { text: 'Request cancelled.', provider: 'claude', model: 'cancelled', toolUseLog }; }
        if (response.code === 'TIMEOUT' || /timed?\s*out/i.test(response.message || '')) { this.emitStep('done', 'Timed out', 'error'); return { text: friendlyMsg, provider: 'claude', model: 'timeout', error: true, timedOut: true, toolUseLog }; }
        if (this.isRetryableError(response.message, response.code)) { this._retryCount++; this.emitStep('warn', `${friendlyMsg} Retrying (${this._retryCount}/3)...`, 'warn'); StepDownManager.handleApiError(ClaudeProvider, response); await new Promise(r => setTimeout(r, 3000)); continue; }
        if (this.isContextLengthError(response.message) && messages.length > 2) { this.emitStep('warn', 'Context too long — trimming...', 'warn'); messages.splice(1, Math.min(4, messages.length - 2)); continue; }
        const stepped = StepDownManager.handleApiError(ClaudeProvider, response);
        if (stepped && iteration <= 2) continue;
        this.emitStep('done', friendlyMsg, 'error');
        return { text: friendlyMsg, provider: 'claude', model: 'error', error: true, friendlyError: true, toolUseLog };
      }

      totalInputTokens += response.inputTokens || 0;
      totalOutputTokens += response.outputTokens || 0;

      if (!response.content || response.content.length === 0) {
        this.emitStep('done', 'Empty response — stopping', 'warn');
        UsageMeter.record('claude', totalInputTokens, totalOutputTokens, ClaudeProvider);
        return { text: 'The AI returned an empty response. Please try again.', provider: 'claude', model: ClaudeProvider.getCurrentModel().name, toolUseLog };
      }

      const stopReason = response.stop_reason || 'end_turn';

      if (stopReason === 'end_turn' || stopReason === 'stop' || stopReason === 'max_tokens') {
        const finalText = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        UsageMeter.record('claude', totalInputTokens, totalOutputTokens, ClaudeProvider);
        ClaudeProvider.status = 'active';
        const elapsed = ((Date.now() - this._loopStart) / 1000).toFixed(1);
        this.emitStep('done', `Done in ${elapsed}s`, 'done');
        return { text: finalText || '(No text in response)', provider: 'claude', model: response.model || ClaudeProvider.getCurrentModel().name, toolUseLog };
      }

      if (stopReason === 'tool_use') {
        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
        if (toolUseBlocks.length === 0) {
          const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
          UsageMeter.record('claude', totalInputTokens, totalOutputTokens, ClaudeProvider);
          this.emitStep('done', 'No tools to execute', 'warn');
          return { text: text || 'No response generated.', provider: 'claude', model: ClaudeProvider.getCurrentModel().name, toolUseLog };
        }

        messages.push({ role: 'assistant', content: response.content });
        const toolResults = [];

        for (const toolBlock of toolUseBlocks) {
          if (this.cancelled) break;
          const stepId = this.emitStep('tool', this.toolLabel(toolBlock.name, toolBlock.input));
          const toolStart = Date.now();

          const result = await this.executeTool(toolBlock.name, toolBlock.input);
          const toolMs = Date.now() - toolStart;

          toolUseLog.push({ tool: toolBlock.name, input: toolBlock.input, result, ms: toolMs });
          this.updateStep(stepId, `${this.toolLabel(toolBlock.name, toolBlock.input)} — ${(toolMs / 1000).toFixed(1)}s`, (typeof result === 'string' && result.toLowerCase().includes('failed')) ? 'error' : 'done');

          if (toolBlock.name === 'write_file' && this.avisPath && toolBlock.input.path) {
            const nw = toolBlock.input.path.replace(/\\/g, '/').toLowerCase();
            const na = this.avisPath.replace(/\\/g, '/').toLowerCase();
            if (nw.startsWith(na)) { this.emitStep('tool', `Hot-reloading...`); setTimeout(() => { try { window.avis.hotReload(); } catch (e) {} }, 500); }
          }

          toolResults.push({ type: 'tool_result', tool_use_id: toolBlock.id, content: this.validateToolResult(result) });
        }

        if (this.cancelled) { this.emitStep('done', 'Stopped by user', 'error'); return { text: 'Request cancelled.', provider: 'claude', model: 'cancelled', toolUseLog }; }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Unknown stop_reason
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      UsageMeter.record('claude', totalInputTokens, totalOutputTokens, ClaudeProvider);
      this.emitStep('done', `Unknown stop_reason: ${stopReason}`, 'warn');
      return { text: text || 'No response generated.', provider: 'claude', model: ClaudeProvider.getCurrentModel().name, toolUseLog };
    }

    // BUG 1+4: Hit max iterations — get summary from Claude and offer to continue
    UsageMeter.record('claude', totalInputTokens, totalOutputTokens, ClaudeProvider);
    this.emitStep('done', `Reached step limit (${MAX_ITERATIONS}/${taskType}). Getting summary...`, 'warn');
    this._lastToolUseLog = toolUseLog;

    // Ask Claude to summarize what was accomplished
    let summaryText = `Task paused after ${iteration} steps.`;
    try {
      const lastActions = toolUseLog.slice(-3).map(t => `${t.tool}: ${JSON.stringify(t.input).substring(0, 80)}`).join('\n');
      const summaryResponse = await window.avis.apiCallAgentic({
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'user', content: `You were working on: "${userMessage}"\nYou completed ${iteration} tool steps. Last actions:\n${lastActions}\n\nGive a 2-sentence status update: what you accomplished and what's left.` }],
        systemPrompt: 'Be brief and factual.',
        tools: []
      });
      if (!summaryResponse.error && summaryResponse.content) {
        const text = summaryResponse.content.filter(b => b.type === 'text').map(b => b.text).join('');
        if (text) summaryText = text;
      }
    } catch (e) {}

    return {
      text: summaryText,
      provider: 'claude',
      model: ClaudeProvider.getCurrentModel().name,
      toolUseLog,
      paused: true,
      pauseInfo: { iteration, maxIterations: MAX_ITERATIONS, taskType, userMessage }
    };
  },

  // BUG 4: Resume a paused agentic task
  async continueTask() {
    if (!this._lastTaskMessage) return { text: 'No paused task to continue.', provider: 'avis', model: 'system' };
    this.emitStep('thinking', 'Resuming previous task...');
    return await this.agenticLoop(
      `Continue the previous task. Here's what was asked: "${this._lastTaskMessage}". Pick up where you left off.`,
      this._lastTaskFiles || []
    );
  },

  toolLabel(name, input) {
    const labels = {
      web_search: `Searching: "${input.query || ''}"`,
      fetch_url: `Fetching: ${input.url || ''}`,
      firecrawl_crawl: `Crawling site: ${input.url || ''} (max ${input.limit || 10} pages)`,
      run_code: `Running ${input.language || ''} code`,
      read_file: `Reading: ${(input.path || '').split(/[\\/]/).pop()}`,
      write_file: `Writing: ${(input.path || '').split(/[\\/]/).pop()}`,
      open_app: `Opening: ${input.target || ''}`,
      get_weather: `Getting weather for ${input.location || 'auto'}`,
      launch_steam_game: `Launching Steam game: ${input.game_name || ''}`,
      computer_action: `Computer: ${input.action || ''}${input.x ? ` at (${input.x},${input.y})` : ''}${input.text ? ` "${input.text.substring(0,30)}"` : ''}`,
      call_claude: `Calling Claude ${(input.model || 'opus').includes('haiku') ? 'Haiku' : (input.model || '').includes('sonnet') ? 'Sonnet' : 'Opus'}: "${(input.prompt || '').substring(0, 50)}..."`,
      call_claude_code: `Launching Claude Code on ${(input.project_path || '').split(/[\\/]/).pop() || 'project'}...`,
      call_gemini: `Calling Gemini: "${(input.prompt || '').substring(0, 60)}..."`,
      call_gpt4: `Calling GPT-4o: "${(input.prompt || '').substring(0, 60)}..."`,
      call_deepseek: `Calling DeepSeek: "${(input.prompt || '').substring(0, 60)}..."`,
      call_grok: `Calling Grok: "${(input.prompt || '').substring(0, 60)}..."`,
      call_mistral: `Calling Mistral: "${(input.prompt || '').substring(0, 60)}..."`,
      call_perplexity: `Calling Perplexity: "${(input.query || '').substring(0, 60)}..."`,
      call_stability: `Generating image: "${(input.prompt || '').substring(0, 60)}..."`,
      run_parallel: `Calling ${(input.providers || []).join(', ')} in parallel`
    };
    return labels[name] || name;
  },

  // ====================================================================
  // Tool Execution — now includes all AI provider calls
  // ====================================================================
  async executeTool(name, input) {
    try {
      switch (name) {
        case 'web_search': return await this.toolWebSearch(input.query);
        case 'fetch_url': return await this.toolFetchUrl(input.url);
        case 'firecrawl_crawl': return await this.toolFirecrawlCrawl(input.url, input.limit);
        case 'run_code': return await this.toolRunCode(input.language, input.code);
        case 'read_file': return await this.toolReadFile(input.path);
        case 'write_file': return await this.toolWriteFile(input.path, input.content);
        case 'open_app': return await this.toolOpenApp(input.target);
        case 'get_weather': return await this.toolGetWeather(input.location);
        case 'launch_steam_game': return await this.toolLaunchSteam(input.game_name, input.app_id);
        case 'computer_action': return await this.toolComputerAction(input);
        // AI provider calls
        case 'call_claude': return await this.callProvider('claude', input.prompt, input.model || 'claude-opus-4-5-20250514');
        case 'call_claude_code': return await this.toolClaudeCode(input.task, input.project_path, input.flags);
        case 'call_gemini': return await this.callProvider('gemini', input.prompt, input.model);
        case 'call_gpt4': return await this.callProvider('openai', input.prompt, input.model);
        case 'call_deepseek': return await this.callProvider('deepseek', input.prompt, input.model);
        case 'call_grok': return await this.callProvider('grok', input.prompt, input.model);
        case 'call_mistral': return await this.callProvider('mistral', input.prompt, input.model);
        case 'call_perplexity': return await this.callProviderSearch('perplexity', input.query);
        case 'call_stability': return await this.callProviderImage(input.prompt);
        case 'run_parallel': return await this.callParallel(input.prompt, input.providers);
        default: return `Unknown tool: ${name}`;
      }
    } catch (err) {
      return `Tool error (${name}): ${err.message}`;
    }
  },

  // Call any text AI provider and return its response
  async callProvider(providerName, prompt, model) {
    if (!(await this.hasProvider(providerName))) return `${providerName} is not configured. Add its API key in Settings.`;

    // FIX 2: Check if provider is available (not disabled/cooldown)
    if (!this.isProviderAvailable(providerName)) {
      const reason = this.disabledProviders[providerName] || 'rate limited';
      return `${providerName} is currently unavailable (${reason}). Try another provider.`;
    }

    const providerObj = this.providerMap[providerName]?.();
    if (!providerObj) return `Provider ${providerName} not found.`;

    try {
      const result = await window.avis.apiCall({
        provider: providerName,
        model: model || providerObj.getCurrentModel().id,
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: 'You are a helpful AI assistant. Answer the question directly and concisely.',
        options: {}
      });

      if (result.error) {
        const handling = this.classifyAndHandleError(providerName, result.message, result.code);

        // Auto-fallback: step down model on rate limit
        if (handling.action === 'cooldown' && providerObj.models?.length > 1) {
          const stepped = providerObj.stepDown();
          if (stepped.stepped) {
            this.emitStep('warn', `${providerObj.displayName} rate limited — stepping to ${stepped.to}`, 'warn');
            return await this.callProvider(providerName, prompt, providerObj.getCurrentModel().id);
          }
        }

        // Auto-fallback: connection issue on Opus → try Sonnet
        if (handling.action === 'retry' && providerName === 'claude' && model && model.includes('opus')) {
          this.emitStep('warn', 'Claude Opus unavailable — using Sonnet', 'warn');
          return await this.callProvider('claude', prompt, 'claude-sonnet-4-20250514');
        }

        return `${providerObj.displayName}: ${this.parseError(result.message)}`;
      }

      UsageMeter.record(providerName, result.inputTokens || 0, result.outputTokens || 0, providerObj);
      providerObj.status = 'active';
      // Clear any cooldown on success
      delete this.rateLimitCooldowns[providerName];

      return `[${providerObj.displayName} / ${result.model || providerObj.getCurrentModel().name}]\n\n${result.text}`;
    } catch (err) {
      this.classifyAndHandleError(providerName, err.message, err.status);
      return `${providerName} call failed: ${this.parseError(err.message)}`;
    }
  },

  // Call Perplexity specifically for search
  async callProviderSearch(providerName, query) {
    if (!(await this.hasProvider(providerName))) return await this.toolWebSearch(query); // fallback to cascading search

    try {
      const result = await window.avis.apiCall({
        provider: 'perplexity',
        model: 'sonar-pro',
        messages: [{ role: 'user', content: query }],
        systemPrompt: 'Provide concise, factual search results with sources.',
        options: {}
      });

      if (result.error) return await this.toolWebSearch(query); // fallback

      UsageMeter.record('perplexity', result.inputTokens || 0, result.outputTokens || 0, PerplexityProvider);
      let text = `[Perplexity Live Search]\n\n${result.text}`;
      if (result.citations?.length > 0) text += '\n\nSources:\n' + result.citations.map((c, i) => `${i + 1}. ${c}`).join('\n');
      return text;
    } catch (e) {
      return await this.toolWebSearch(query);
    }
  },

  // Call Stability AI for image generation
  async callProviderImage(prompt) {
    if (!(await this.hasProvider('stability'))) return 'Stability AI is not configured. Add its API key in Settings.';

    try {
      const result = await window.avis.apiCall({
        provider: 'stability',
        model: 'stable-diffusion-xl-1024-v1-0',
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: '',
        options: {}
      });

      if (result.error) return `Image generation failed: ${this.parseError(result.message)}`;
      if (result.image) return `[Image generated by Stability AI]\n\nImage data is available and will be displayed in the chat.`;
      return 'Image generation returned no image data.';
    } catch (err) {
      return `Image generation failed: ${err.message}`;
    }
  },

  // Run same prompt across multiple providers in parallel
  async callParallel(prompt, providerList) {
    const nameMap = { claude: 'claude', gemini: 'gemini', gpt4: 'openai', deepseek: 'deepseek', grok: 'grok', mistral: 'mistral' };
    const displayMap = { claude: 'Claude', gemini: 'Gemini', gpt4: 'GPT-4o', deepseek: 'DeepSeek', grok: 'Grok', mistral: 'Mistral' };

    const promises = (providerList || []).map(async (p) => {
      const actualProvider = nameMap[p] || p;
      const displayName = displayMap[p] || p;
      try {
        const result = await this.callProvider(actualProvider, prompt);
        return { provider: displayName, result, success: true };
      } catch (err) {
        return { provider: displayName, result: `Error: ${err.message}`, success: false };
      }
    });

    const results = await Promise.all(promises);

    let output = `**Parallel Results from ${results.length} providers:**\n\n`;
    for (const r of results) {
      output += `---\n### ${r.provider}\n${r.result}\n\n`;
    }
    return output;
  },

  // Claude Code CLI tool
  async toolClaudeCode(task, projectPath, flags) {
    if (!task) return 'No task specified for Claude Code.';
    if (!projectPath) return 'No project path specified. Please provide the directory to work in.';

    try {
      const result = await window.avis.runClaudeCode({
        task,
        projectPath,
        flags: flags || '--dangerously-skip-permissions'
      });

      if (result.success) {
        return `[Claude Code completed successfully]\n\nTask: ${task}\nProject: ${projectPath}\nExit code: ${result.exitCode}\n\nOutput:\n${result.output || '(no output)'}`;
      } else {
        return `[Claude Code finished with errors]\n\nTask: ${task}\nProject: ${projectPath}\nExit code: ${result.exitCode}\n\nOutput:\n${result.output || ''}\n\nErrors:\n${result.error || '(no error details)'}`;
      }
    } catch (err) {
      return `Claude Code failed to launch: ${err.message}`;
    }
  },

  // Existing tool implementations
  async toolWebSearch(query) {
    if (await this.hasProvider('perplexity')) {
      try {
        const result = await window.avis.apiCall({ provider: 'perplexity', model: 'sonar-pro', messages: [{ role: 'user', content: query }], systemPrompt: 'Provide concise, factual search results with sources.', options: {} });
        if (!result.error) {
          UsageMeter.record('perplexity', result.inputTokens || 0, result.outputTokens || 0, PerplexityProvider);
          let text = result.text;
          if (result.citations?.length > 0) text += '\n\nSources:\n' + result.citations.map((c, i) => `${i + 1}. ${c}`).join('\n');
          return text;
        }
      } catch (e) {}
    }
    try { const r = await window.avis.braveSearch(query); if (r?.length > 0) return r.map(x => `**${x.title}**\n${x.snippet}\n${x.url}`).join('\n\n'); } catch (e) {}
    try { const r = await window.avis.searxSearch(query); if (r?.length > 0) return r.map(x => `**${x.title}**\n${x.snippet}\n${x.url || ''}`).join('\n\n'); } catch (e) {}
    try { const r = await window.avis.ddgSearch(query); if (r?.length > 0) return r.map(x => `**${x.title}**\n${x.snippet}\n${x.url || ''}`).join('\n\n'); } catch (e) {}
    return `Could not search for "${query}". All search providers failed.`;
  },

  async toolFetchUrl(url) {
    // Try Firecrawl first for clean markdown
    try {
      const fc = await window.avis.firecrawlScrape(url);
      if (fc.success) {
        const title = fc.metadata?.title || url;
        return `**Page: ${title}**\nURL: ${url}\n\n${fc.content}`;
      }
      // If fallback=true (no key or error), fall through to webview
    } catch (e) { /* fall through */ }

    // Fallback: headless webview
    try { const r = await window.avis.fetchUrl(url); return `**Page: ${r.title}**\nURL: ${r.url}\n\n${r.text}`; }
    catch (err) { return `Failed to fetch ${url}: ${err.message}`; }
  },

  async toolFirecrawlCrawl(url, limit) {
    try {
      const result = await window.avis.firecrawlCrawl(url, limit || 10);
      if (!result.success) return `Crawl failed: ${result.error}`;
      if (!result.pages?.length) return 'Crawl returned no pages.';
      let output = `**Crawled ${result.pages.length} pages from ${url}:**\n\n`;
      for (const page of result.pages) {
        const preview = (page.content || '').substring(0, 500);
        output += `---\n**${page.url}**\n${preview}\n\n`;
      }
      return output;
    } catch (err) {
      return `Crawl error: ${err.message}`;
    }
  },

  async toolRunCode(language, code) {
    const r = await window.avis.runCode({ language, code });
    return r.success ? `Code executed successfully.\nOutput:\n${r.output || '(no output)'}` : `Code execution failed.\nError: ${r.error}\nOutput:\n${r.output || ''}`;
  },

  async toolReadFile(filePath) {
    const r = await window.avis.toolReadFile(filePath);
    return r.success ? `File read: ${r.path} (${r.size} bytes)\n\n${r.content}` : `Failed to read file: ${r.error}`;
  },

  async toolWriteFile(filePath, content) {
    const r = await window.avis.toolWriteFile(filePath, content);
    return r.success ? `File written: ${r.path} (${r.size} bytes)` : `Failed to write file: ${r.error}`;
  },

  async toolOpenApp(target) {
    const r = await window.avis.openApp(target);
    return r.success ? `Opened: ${r.target}` : `Failed to open ${r.target}: ${r.error || 'unknown'}`;
  },

  async toolGetWeather(location) {
    try {
      const w = await window.avis.getWeather(location);
      if (!w.success) return `Weather lookup failed: ${w.error}`;
      let text = `**Weather for ${w.location}**\n`;
      text += `Current: ${w.condition}, ${w.temp_f}°F (${w.temp_c}°C)\n`;
      text += `Feels like: ${w.feels_like_f}°F | Humidity: ${w.humidity}% | Wind: ${w.wind_mph} mph\n`;
      if (w.forecast?.length) {
        text += `\n**3-Day Forecast:**\n`;
        for (const day of w.forecast) {
          text += `${day.date}: ${day.condition}, ${day.min_f}–${day.max_f}°F\n`;
        }
      }
      return text;
    } catch (err) {
      return `Weather error: ${err.message}`;
    }
  },

  async toolLaunchSteam(gameName, appId) {
    try {
      const result = await window.avis.launchSteamGame({ gameName, appId: appId || null });
      return result.success
        ? `${result.message} (method: ${result.method})`
        : `${result.message}`;
    } catch (err) {
      return `Steam launch failed: ${err.message}`;
    }
  },

  async toolComputerAction(input) {
    const r = await window.avis.computerAction(input);
    if (r.success) {
      if (r.action === 'screenshot' && r.image) {
        return `Screenshot taken (${r.width || '?'}x${r.height || '?'}, scale: ${r.scaleFactor || '?'}x).${r.fallback ? ' [Window only — desktopCapturer unavailable]' : ' [Full desktop]'}`;
      }
      if (r.action === 'click' || r.action === 'double_click' || r.action === 'right_click') {
        return `${r.action} at (${r.originalX || r.x}, ${r.originalY || r.y}) → DPI-scaled to (${r.x}, ${r.y}), scale factor: ${r.scaleFactor || 1}x`;
      }
      if (r.action === 'type') return `Typed text successfully.`;
      if (r.action === 'key') return `Sent key: ${input.text}`;
      return `Action "${r.action}" completed.`;
    }
    return `Action "${input.action}" failed: ${r.error}`;
  },

  async directCall(providerName, message, files = [], modelOverride = null) {
    const providerObj = this.providerMap[providerName]?.();
    if (!providerObj) return { text: `Provider ${providerName} not found.`, provider: 'avis', model: 'system' };
    if (!(await this.hasProvider(providerName))) return { text: `${providerObj.displayName} not configured.`, provider: 'avis', model: 'system' };
    const usageCheck = UsageMeter.checkThresholds(providerName);
    if (usageCheck.hardStop) return { text: `${providerObj.displayName} budget limit reached.`, provider: 'avis', model: 'system' };

    const systemPrompt = this.SYSTEM_PROMPT + MemoryManager.getMemoriesForPrompt() + (HotConfig.get('customSystemPrompt') ? '\n\n' + HotConfig.get('customSystemPrompt') : '');
    const messages = [...MemoryManager.getConversationMessages()];
    const lastMsg = { role: 'user', content: message };
    if (files.length > 0) {
      const images = files.filter(f => f.type === 'image').map(f => ({ data: f.data, mimeType: f.mimeType }));
      const textContent = files.filter(f => f.type === 'text').map(f => `[File: ${f.name}]\n${f.data}`).join('\n\n');
      if (textContent) lastMsg.content = textContent + '\n\n' + message;
      if (images.length > 0) lastMsg.images = images;
    }
    messages.push(lastMsg);

    try {
      const result = await window.avis.apiCall({ provider: providerName, model: modelOverride || providerObj.getCurrentModel().id, messages, systemPrompt: providerName !== 'stability' ? systemPrompt : '', options: {} });
      if (result.error) { StepDownManager.handleApiError(providerObj, result); return { text: this.parseError(result.message), provider: providerName, model: 'error', error: true, friendlyError: true }; }
      UsageMeter.record(providerName, result.inputTokens || 0, result.outputTokens || 0, providerObj);
      providerObj.status = 'active';
      return { text: result.text || '', image: result.image || null, provider: providerName, model: result.model || providerObj.getCurrentModel().name, citations: result.citations || null };
    } catch (err) { return { text: `Error: ${err.message}`, provider: providerName, model: 'error', error: true }; }
  },

  async fallbackRoute(userMessage, files) {
    for (const name of ['openai', 'deepseek', 'gemini', 'mistral', 'grok', 'perplexity']) {
      if (await this.hasProvider(name)) return await this.directCall(name, userMessage, files);
    }
    return { text: 'No AI providers configured.', provider: 'avis', model: 'system' };
  },

  async hasProvider(name) { return !!(await window.avis.getApiKey(name)); },
  async hasAnyProvider() {
    for (const p of ['claude', 'deepseek', 'openai', 'gemini', 'grok', 'mistral', 'perplexity', 'stability']) { if (await this.hasProvider(p)) return true; }
    return false;
  },
  isImageGenRequest(text) {
    return ['generate an image', 'create an image', 'draw ', 'make a picture', 'generate a picture', 'image of', 'illustration of', 'paint '].some(k => text.toLowerCase().includes(k));
  }
};
