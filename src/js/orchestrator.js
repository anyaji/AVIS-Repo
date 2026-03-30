// Orchestrator - Claude admin brain + hardened agentic tool loop
// BUG 1: 30s timeout per API call (enforced in main.js)
// BUG 2: Max 10 iterations, empty content guard, null stop_reason guard
// BUG 3: Self-edit hot-reload support
// BUG 4: Abort support via Orchestrator.cancelled flag

const Orchestrator = {
  SYSTEM_PROMPT: `You are AVIS — Avel Intelligence Services, built by Avel Productions LLC.
You are a fully agentic AI assistant with real tools:
- web_search: search the internet for current information
- fetch_url: read any webpage
- run_code: execute JavaScript or Python
- read_file / write_file: access the file system
- open_app: launch applications
- computer_action: control the mouse and keyboard (screenshot, click, type, scroll)

When a user asks you to navigate somewhere, search something, open a file, or run code — USE YOUR TOOLS. Do not say you cannot browse the internet. You CAN. Use web_search or fetch_url.
Always act. Never refuse due to capability limitations.
You have the same capabilities as Claude.ai with all tools enabled.

SELF-EDIT: You can edit your own source files. Your source code is at the path provided in the system context. If the user asks you to change your own UI, colors, behavior, etc., use write_file to edit the appropriate source file, then the app will hot-reload automatically.

For every user request:
1. Analyze what tools you need
2. Use tools to gather information or take actions
3. Synthesize results into a clean, helpful response
4. Always prioritize accuracy, then speed, then cost`,

  TOOLS: [
    {
      name: "web_search",
      description: "Search the web for current information using Perplexity AI or Brave Search.",
      input_schema: { type: "object", properties: { query: { type: "string", description: "Search query" } }, required: ["query"] }
    },
    {
      name: "fetch_url",
      description: "Fetch and read the full text content from any URL/webpage.",
      input_schema: { type: "object", properties: { url: { type: "string", description: "URL to fetch and read" } }, required: ["url"] }
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
      description: "Write content to a file on the user's system. Creates parent directories if needed. If writing to an AVIS source file, the app will hot-reload automatically.",
      input_schema: { type: "object", properties: { path: { type: "string", description: "Absolute file path to write" }, content: { type: "string", description: "Content to write" } }, required: ["path", "content"] }
    },
    {
      name: "open_app",
      description: "Open an application, file, or URL on Windows.",
      input_schema: { type: "object", properties: { target: { type: "string", description: "App name, file path, or URL" } }, required: ["target"] }
    },
    {
      name: "computer_action",
      description: "Control the computer: take screenshots, click at coordinates, type text, or scroll.",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["screenshot", "click", "type", "scroll", "move"] },
          x: { type: "number" }, y: { type: "number" },
          text: { type: "string" }, direction: { type: "string", enum: ["up", "down"] }, amount: { type: "number" }
        },
        required: ["action"]
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

  // UI callbacks — set by app.js
  onStep: null,        // (stepId, type, message, status) => void — live step display
  cancelled: false,    // BUG 4: abort flag
  avisPath: null,      // BUG 3: path to AVIS source for self-edit detection

  _stepCounter: 0,
  _loopStart: 0,
  _retryCount: 0,

  // BUG 3: Parse raw API errors into friendly messages
  parseError(rawMessage) {
    const raw = rawMessage || 'Unknown error';
    // Try to extract clean message from JSON error body
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed?.error?.message) return parsed.error.message;
      }
    } catch (e) {}
    // Map common error patterns to friendly messages
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
    for (const [re, msg] of patterns) {
      if (re.test(raw)) return msg;
    }
    // Clean up common prefix junk
    return raw.replace(/^Error:\s*\d+\s*/, '').replace(/^Error:\s*/, '').substring(0, 200);
  },

  // BUG 4: Check if error is auto-retryable
  isRetryableError(errMsg, code) {
    if (this._retryCount >= 3) return false;
    const msg = (errMsg || '') + (code || '');
    return /rate.?limit|429|overloaded|503|529/i.test(msg);
  },

  isContextLengthError(errMsg) {
    return /context.?length|too.?long|maximum.*tokens/i.test(errMsg || '');
  },

  // BUG 5: Validate tool results before returning to Claude
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

    // BUG 2: If files attached but no text, add default
    if ((!userMessage || !userMessage.trim()) && files.length > 0) {
      const hasImage = files.some(f => f.type === 'image');
      userMessage = hasImage ? 'Please analyze this image.' : 'Please analyze this file.';
    }

    // Block completely empty submissions
    if ((!userMessage || !userMessage.trim()) && files.length === 0) {
      return { text: 'Please type a message or attach a file.', provider: 'avis', model: 'system' };
    }

    // Resolve AVIS path for self-edit detection
    if (!this.avisPath) {
      try { this.avisPath = await window.avis.getAvisPath(); } catch (e) { this.avisPath = ''; }
    }

    const hasAnyKey = await this.hasAnyProvider();
    if (!hasAnyKey) {
      return { text: 'No API keys configured. Please open Settings and add at least one provider API key.', provider: 'avis', model: 'system' };
    }

    const hasClaude = await this.hasProvider('claude');
    const hasImages = files.some(f => f.type === 'image');

    if (hasImages && !hasClaude) {
      return await this.directCall('openai', userMessage, files);
    }

    if (this.isImageGenRequest(userMessage)) {
      const hasStability = await this.hasProvider('stability');
      if (hasStability) return await this.directCall('stability', userMessage, files);
    }

    if (hasClaude) {
      return await this.agenticLoop(userMessage, files);
    }

    return await this.fallbackRoute(userMessage, files);
  },

  // ====================================================================
  // BUG 2: Hardened Agentic Loop — max 10 iters, empty/null guards, abort
  // ====================================================================
  async agenticLoop(userMessage, files = []) {
    const avisPathNote = this.avisPath ? `\n\nYour own source code is located at: ${this.avisPath.replace(/\\/g, '/')}` : '';
    const systemPrompt = this.SYSTEM_PROMPT + avisPathNote +
      MemoryManager.getMemoriesForPrompt() +
      (HotConfig.get('customSystemPrompt') ? '\n\n' + HotConfig.get('customSystemPrompt') : '');

    const messages = [...MemoryManager.getConversationMessages()];
    const lastMsg = { role: 'user', content: userMessage };

    if (files.length > 0) {
      const images = files.filter(f => f.type === 'image').map(f => ({ data: f.data, mimeType: f.mimeType }));
      const textContent = files.filter(f => f.type === 'text').map(f => `[File: ${f.name}]\n${f.data}`).join('\n\n');
      if (textContent) lastMsg.content = textContent + '\n\n' + userMessage;
      if (images.length > 0) lastMsg.images = images;
    }

    messages.push(lastMsg);

    const MAX_ITERATIONS = 10;
    let iteration = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const toolUseLog = [];

    const thinkStepId = this.emitStep('thinking', 'Analyzing your request...');

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      // BUG 4: Check abort before each API call
      if (this.cancelled) {
        this.updateStep(thinkStepId, 'Stopped by user', 'error');
        return { text: 'Request cancelled.', provider: 'claude', model: 'cancelled', toolUseLog };
      }

      this.emitStep('thinking', `Iteration ${iteration}/${MAX_ITERATIONS} — calling Claude...`);

      const response = await window.avis.apiCallAgentic({
        model: ClaudeProvider.getCurrentModel().id,
        messages,
        systemPrompt,
        tools: this.TOOLS
      });

      // BUG 4: Check abort after API call
      if (this.cancelled) {
        this.updateStep(thinkStepId, 'Stopped by user', 'error');
        return { text: 'Request cancelled.', provider: 'claude', model: 'cancelled', toolUseLog };
      }

      // Handle errors with auto-retry (BUG 3+4)
      if (response.error) {
        const friendlyMsg = this.parseError(response.message);

        if (response.code === 'ABORT') {
          this.emitStep('done', 'Stopped by user', 'error');
          return { text: 'Request cancelled.', provider: 'claude', model: 'cancelled', toolUseLog };
        }
        if (response.code === 'TIMEOUT' || /timed?\s*out/i.test(response.message || '')) {
          this.emitStep('done', 'Timed out', 'error');
          return { text: friendlyMsg, provider: 'claude', model: 'timeout', error: true, timedOut: true, toolUseLog };
        }

        // BUG 4: Auto-retry on rate limit / overloaded
        if (this.isRetryableError(response.message, response.code)) {
          this._retryCount++;
          this.emitStep('warn', `${friendlyMsg} Retrying (${this._retryCount}/3)...`, 'warn');
          const stepped = StepDownManager.handleApiError(ClaudeProvider, response);
          await new Promise(r => setTimeout(r, 3000)); // wait 3s before retry
          continue;
        }

        // BUG 4: Auto-retry on context length — trim oldest messages
        if (this.isContextLengthError(response.message) && messages.length > 2) {
          this.emitStep('warn', 'Context too long — trimming old messages...', 'warn');
          messages.splice(1, Math.min(4, messages.length - 2)); // remove up to 4 oldest (keep first + last)
          continue;
        }

        // Non-retryable error
        const stepped = StepDownManager.handleApiError(ClaudeProvider, response);
        if (stepped && iteration <= 2) continue;
        this.emitStep('done', friendlyMsg, 'error');
        return { text: friendlyMsg, provider: 'claude', model: 'error', error: true, friendlyError: true, toolUseLog };
      }

      totalInputTokens += response.inputTokens || 0;
      totalOutputTokens += response.outputTokens || 0;

      // BUG 2: Guard — empty content array = break immediately
      if (!response.content || response.content.length === 0) {
        this.emitStep('done', 'Empty response received — stopping', 'warn');
        UsageMeter.record('claude', totalInputTokens, totalOutputTokens, ClaudeProvider);
        return { text: 'The AI returned an empty response. Please try again.', provider: 'claude', model: ClaudeProvider.getCurrentModel().name, toolUseLog };
      }

      // BUG 2: Guard — null/undefined stop_reason = treat as end_turn
      const stopReason = response.stop_reason || 'end_turn';

      if (stopReason === 'end_turn' || stopReason === 'stop' || stopReason === 'max_tokens') {
        const textParts = response.content.filter(b => b.type === 'text').map(b => b.text);
        const finalText = textParts.join('\n');

        UsageMeter.record('claude', totalInputTokens, totalOutputTokens, ClaudeProvider);
        ClaudeProvider.status = 'active';

        const elapsed = ((Date.now() - this._loopStart) / 1000).toFixed(1);
        this.emitStep('done', `Done in ${elapsed}s`, 'done');

        return {
          text: finalText || '(No text in response)',
          provider: 'claude',
          model: response.model || ClaudeProvider.getCurrentModel().name,
          toolUseLog
        };
      }

      if (stopReason === 'tool_use') {
        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

        // BUG 2: Guard — tool_use stop_reason but no tool blocks = break
        if (toolUseBlocks.length === 0) {
          const textParts = response.content.filter(b => b.type === 'text').map(b => b.text);
          UsageMeter.record('claude', totalInputTokens, totalOutputTokens, ClaudeProvider);
          this.emitStep('done', 'No tools to execute — stopping', 'warn');
          return { text: textParts.join('\n') || 'No response generated.', provider: 'claude', model: ClaudeProvider.getCurrentModel().name, toolUseLog };
        }

        messages.push({ role: 'assistant', content: response.content });
        const toolResults = [];

        for (const toolBlock of toolUseBlocks) {
          if (this.cancelled) break;

          const stepId = this.emitStep('tool', this.toolLabel(toolBlock.name, toolBlock.input));
          const toolStart = Date.now();

          const result = await this.executeTool(toolBlock.name, toolBlock.input);
          const toolMs = Date.now() - toolStart;
          const resultPreview = (typeof result === 'string' ? result : JSON.stringify(result)).substring(0, 80);

          toolUseLog.push({ tool: toolBlock.name, input: toolBlock.input, result, ms: toolMs });
          this.updateStep(stepId, `${this.toolLabel(toolBlock.name, toolBlock.input)} — ${(toolMs / 1000).toFixed(1)}s`, result.toString().toLowerCase().includes('failed') ? 'error' : 'done');

          // BUG 3: Detect self-edit and trigger hot-reload
          if (toolBlock.name === 'write_file' && this.avisPath && toolBlock.input.path) {
            const normalizedWrite = toolBlock.input.path.replace(/\\/g, '/').toLowerCase();
            const normalizedAvis = this.avisPath.replace(/\\/g, '/').toLowerCase();
            if (normalizedWrite.startsWith(normalizedAvis)) {
              this.emitStep('tool', `Hot-reloading AVIS after editing ${toolBlock.input.path.split(/[\\/]/).pop()}...`);
              // Small delay to let file write complete, then reload
              setTimeout(() => { try { window.avis.hotReload(); } catch (e) {} }, 500);
            }
          }

          // BUG 5: Validate tool result before sending to Claude
          const validatedResult = this.validateToolResult(result);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: validatedResult
          });
        }

        if (this.cancelled) {
          this.emitStep('done', 'Stopped by user', 'error');
          return { text: 'Request cancelled.', provider: 'claude', model: 'cancelled', toolUseLog };
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // BUG 2: Unknown stop_reason — extract text and break
      const textParts = response.content.filter(b => b.type === 'text').map(b => b.text);
      UsageMeter.record('claude', totalInputTokens, totalOutputTokens, ClaudeProvider);
      this.emitStep('done', `Unknown stop_reason: ${stopReason}`, 'warn');
      return { text: textParts.join('\n') || 'No response generated.', provider: 'claude', model: ClaudeProvider.getCurrentModel().name, toolUseLog };
    }

    // BUG 2: Hit max iterations
    UsageMeter.record('claude', totalInputTokens, totalOutputTokens, ClaudeProvider);
    this.emitStep('done', `Reached max iterations (${MAX_ITERATIONS}). Showing best answer.`, 'warn');
    return {
      text: `[AVIS reached maximum tool iterations (${MAX_ITERATIONS}). Showing best results so far.]`,
      provider: 'claude',
      model: ClaudeProvider.getCurrentModel().name,
      toolUseLog
    };
  },

  toolLabel(name, input) {
    const labels = {
      web_search: `Searching: "${input.query || ''}"`,
      fetch_url: `Fetching: ${input.url || ''}`,
      run_code: `Running ${input.language || ''} code`,
      read_file: `Reading: ${(input.path || '').split(/[\\/]/).pop()}`,
      write_file: `Writing: ${(input.path || '').split(/[\\/]/).pop()}`,
      open_app: `Opening: ${input.target || ''}`,
      computer_action: `Computer: ${input.action || ''}${input.text ? ' "' + input.text + '"' : ''}`
    };
    return labels[name] || name;
  },

  // Tool Execution
  async executeTool(name, input) {
    try {
      switch (name) {
        case 'web_search': return await this.toolWebSearch(input.query);
        case 'fetch_url': return await this.toolFetchUrl(input.url);
        case 'run_code': return await this.toolRunCode(input.language, input.code);
        case 'read_file': return await this.toolReadFile(input.path);
        case 'write_file': return await this.toolWriteFile(input.path, input.content);
        case 'open_app': return await this.toolOpenApp(input.target);
        case 'computer_action': return await this.toolComputerAction(input);
        default: return `Unknown tool: ${name}`;
      }
    } catch (err) {
      return `Tool error (${name}): ${err.message}`;
    }
  },

  async toolWebSearch(query) {
    // Cascading search: Perplexity → Brave → DuckDuckGo → SearXNG
    if (await this.hasProvider('perplexity')) {
      try {
        const result = await window.avis.apiCall({
          provider: 'perplexity', model: 'llama-3.1-sonar-large-128k-online',
          messages: [{ role: 'user', content: query }],
          systemPrompt: 'Provide concise, factual search results with sources.', options: {}
        });
        if (!result.error) {
          UsageMeter.record('perplexity', result.inputTokens || 0, result.outputTokens || 0, PerplexityProvider);
          let text = result.text;
          if (result.citations?.length > 0) text += '\n\nSources:\n' + result.citations.map((c, i) => `${i + 1}. ${c}`).join('\n');
          return text;
        }
      } catch (e) { /* fall through */ }
    }
    try {
      const results = await window.avis.braveSearch(query);
      if (results?.length > 0) return results.map(r => `**${r.title}**\n${r.snippet}\n${r.url}`).join('\n\n');
    } catch (e) { /* fall through */ }
    try {
      const results = await window.avis.searxSearch(query);
      if (results?.length > 0) return results.map(r => `**${r.title}**\n${r.snippet}\n${r.url || ''}`).join('\n\n');
    } catch (e) { /* fall through */ }
    try {
      const results = await window.avis.ddgSearch(query);
      if (results?.length > 0) return results.map(r => `**${r.title}**\n${r.snippet}\n${r.url || ''}`).join('\n\n');
    } catch (e) { /* fall through */ }
    return `Could not search for "${query}". All search providers failed.`;
  },

  async toolFetchUrl(url) {
    try {
      const result = await window.avis.fetchUrl(url);
      return `**Page: ${result.title}**\nURL: ${result.url}\n\n${result.text}`;
    } catch (err) {
      return `Failed to fetch ${url}: ${err.message}`;
    }
  },

  async toolRunCode(language, code) {
    const result = await window.avis.runCode({ language, code });
    return result.success
      ? `Code executed successfully.\nOutput:\n${result.output || '(no output)'}`
      : `Code execution failed.\nError: ${result.error}\nOutput:\n${result.output || ''}`;
  },

  async toolReadFile(filePath) {
    const result = await window.avis.toolReadFile(filePath);
    return result.success ? `File read: ${result.path} (${result.size} bytes)\n\n${result.content}` : `Failed to read file: ${result.error}`;
  },

  async toolWriteFile(filePath, content) {
    const result = await window.avis.toolWriteFile(filePath, content);
    return result.success ? `File written: ${result.path} (${result.size} bytes)` : `Failed to write file: ${result.error}`;
  },

  async toolOpenApp(target) {
    const result = await window.avis.openApp(target);
    return result.success ? `Opened: ${result.target}` : `Failed to open ${result.target}: ${result.error || 'unknown'}`;
  },

  async toolComputerAction(input) {
    const result = await window.avis.computerAction(input);
    if (result.success) {
      if (result.action === 'screenshot' && result.image) return 'Screenshot taken. [Image data available]';
      return `Action "${result.action}" completed.`;
    }
    return `Action "${input.action}" failed: ${result.error}`;
  },

  // Legacy direct call for non-Claude providers
  async directCall(providerName, message, files = [], modelOverride = null) {
    const providerObj = this.providerMap[providerName]?.();
    if (!providerObj) return { text: `Provider ${providerName} not found.`, provider: 'avis', model: 'system' };

    const hasKey = await this.hasProvider(providerName);
    if (!hasKey) return { text: `${providerObj.displayName} not configured.`, provider: 'avis', model: 'system' };

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
      const result = await window.avis.apiCall({
        provider: providerName, model: modelOverride || providerObj.getCurrentModel().id,
        messages, systemPrompt: providerName !== 'stability' ? systemPrompt : '', options: {}
      });
      if (result.error) {
        StepDownManager.handleApiError(providerObj, result);
        const friendly = this.parseError(result.message);
        return { text: friendly, provider: providerName, model: 'error', error: true, friendlyError: true };
      }
      UsageMeter.record(providerName, result.inputTokens || 0, result.outputTokens || 0, providerObj);
      providerObj.status = 'active';
      return { text: result.text || '', image: result.image || null, provider: providerName, model: result.model || providerObj.getCurrentModel().name, citations: result.citations || null };
    } catch (err) {
      return { text: `Error: ${err.message}`, provider: providerName, model: 'error', error: true };
    }
  },

  async fallbackRoute(userMessage, files) {
    for (const name of ['openai', 'gemini', 'mistral', 'grok', 'perplexity']) {
      if (await this.hasProvider(name)) return await this.directCall(name, userMessage, files);
    }
    return { text: 'No AI providers configured.', provider: 'avis', model: 'system' };
  },

  async hasProvider(name) { return !!(await window.avis.getApiKey(name)); },
  async hasAnyProvider() {
    for (const p of ['claude', 'deepseek', 'openai', 'gemini', 'grok', 'mistral', 'perplexity', 'stability']) {
      if (await this.hasProvider(p)) return true;
    }
    return false;
  },
  isImageGenRequest(text) {
    return ['generate an image', 'create an image', 'draw ', 'make a picture', 'generate a picture', 'image of', 'illustration of', 'paint '].some(k => text.toLowerCase().includes(k));
  }
};
