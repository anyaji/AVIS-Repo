// Browser Agent — executes browser tasks via Chrome MCP extension
// Uses Firecrawl for pre-reading, Claude for planning, Chrome for interaction
const BrowserAgent = {
  currentUrl: null,
  taskHistory: [],
  maxSteps: 50,

  // Main entry point — execute a browser task
  async executeTask(taskDescription) {
    const steps = [];
    let stepCount = 0;

    Orchestrator.emitStep('browser', '\u{1F310} Browser agent starting: ' + taskDescription);

    // Pre-read target page with Firecrawl for speed
    const targetUrl = DelegationProtocol.extractUrl(taskDescription);
    let pageContext = null;

    if (targetUrl) {
      Orchestrator.emitStep('browser', '\u{1F525} Firecrawl pre-reading: ' + targetUrl);
      try {
        const fc = await window.avis.firecrawlScrape(targetUrl);
        if (fc.success) {
          pageContext = fc.content;
          Orchestrator.emitStep('browser', '\u2713 Page mapped (' + pageContext.length + ' chars)', 'done');
        }
      } catch (e) {
        Orchestrator.emitStep('browser', 'Firecrawl unavailable \u2014 proceeding direct', 'warn');
      }
    }

    // Build task plan using Claude
    const taskType = DelegationProtocol.classifyBrowserTask(taskDescription);
    const plan = await this.buildTaskPlan(taskDescription, pageContext, targetUrl, taskType);

    Orchestrator.emitStep('browser', '\u{1F4CB} Plan ready: ' + plan.steps.length + ' steps');

    // Execute plan step by step
    for (const step of plan.steps) {
      if (stepCount >= this.maxSteps) {
        Orchestrator.emitStep('browser', '\u26A0\uFE0F Max steps reached', 'warn');
        break;
      }

      stepCount++;
      const result = await this.executeStep(step, stepCount);
      steps.push(result);

      if (!result.success && result.critical) {
        Orchestrator.emitStep('browser', '\u2717 Critical step failed: ' + step.description, 'error');
        break;
      }
    }

    // Final screenshot
    let finalShot = null;
    try { finalShot = await window.avis.chromeScreenshot(); } catch (e) {}

    return {
      success: steps.every(s => s.success || !s.critical),
      steps,
      screenshot: finalShot,
      summary: await this.summarizeResult(taskDescription, steps)
    };
  },

  // Build execution plan using Claude
  async buildTaskPlan(task, pageContext, url, taskType) {
    const prompt = `You are a browser automation planner for AVIS.
Create a step-by-step plan to complete this browser task:

TASK: ${task}
TARGET URL: ${url || 'Not specified'}
${pageContext ? 'PAGE CONTENT PREVIEW:\n' + pageContext.substring(0, 2000) : ''}

Return a JSON plan with this exact structure:
{
  "steps": [
    {
      "type": "navigate|click|type|wait|scroll|screenshot|verify",
      "description": "Human readable description",
      "selector": "CSS selector if clicking/typing",
      "value": "Text to type if type action",
      "url": "URL if navigating",
      "critical": true,
      "verifyAfter": "What to check after this step"
    }
  ],
  "estimatedTime": "X seconds",
  "complexity": "simple|medium|complex"
}

Rules:
- Use specific CSS selectors (id, class, type, name attributes)
- Mark steps critical:true if task fails without them
- Include screenshot steps after important actions
- Add verify steps to confirm success
- Keep it minimal \u2014 only necessary steps`;

    const model = DelegationProtocol.selectBrowserModel(taskType, pageContext ? 'simple' : 'medium');
    Orchestrator.emitStep('browser', '\u{1F916} Using ' + model + ' for ' + taskType + ' planning');

    try {
      const result = await window.avis.apiCallAgentic({
        model,
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: 'You are a browser automation planner. Return ONLY valid JSON.',
        tools: []
      });

      if (!result.error && result.content) {
        const text = result.content.filter(b => b.type === 'text').map(b => b.text).join('');
        const clean = text.replace(/```json|```/g, '').trim();
        return JSON.parse(clean);
      }
    } catch (e) {}

    // Fallback simple plan
    return {
      steps: [
        { type: 'navigate', url, description: 'Navigate to URL', critical: true },
        { type: 'screenshot', description: 'Capture page state', critical: false }
      ],
      complexity: 'simple'
    };
  },

  // Execute a single step
  async executeStep(step, stepNum) {
    Orchestrator.emitStep('browser', 'Step ' + stepNum + ': ' + step.description);

    try {
      let result = null;

      switch (step.type) {
        case 'navigate':
          result = await window.avis.chromeNavigate(step.url);
          await this.wait(1500);
          break;
        case 'click':
          await window.avis.chromeWaitFor(step.selector, 5000);
          result = await window.avis.chromeClick(step.selector);
          await this.wait(800);
          break;
        case 'type':
          await window.avis.chromeWaitFor(step.selector, 5000);
          result = await window.avis.chromeType(step.selector, step.value);
          await this.wait(400);
          break;
        case 'scroll':
          result = await window.avis.chromeScroll(step.direction, step.amount);
          await this.wait(500);
          break;
        case 'wait':
          await this.wait(step.duration || 2000);
          result = { success: true };
          break;
        case 'screenshot':
          result = await window.avis.chromeScreenshot();
          break;
        case 'verify':
          result = await this.verifyStep(step);
          break;
        case 'script':
          result = await window.avis.chromeExecuteScript(step.script);
          break;
      }

      Orchestrator.emitStep('browser', '\u2713 ' + step.description, 'done');
      return { step, success: true, result };

    } catch (err) {
      Orchestrator.emitStep('browser', '\u2717 ' + step.description + ': ' + err.message, 'error');

      // Try recovery on critical steps
      if (step.critical) {
        const recovery = await this.attemptRecovery(step, err);
        if (recovery.success) return { step, success: true, recovered: true };
      }

      return { step, success: false, critical: step.critical, error: err.message };
    }
  },

  // Smart recovery when a step fails
  async attemptRecovery(failedStep, error) {
    Orchestrator.emitStep('browser', '\u{1F504} Attempting recovery...');

    try {
      const result = await window.avis.apiCallAgentic({
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'user', content: `A browser automation step failed.
Failed step: ${JSON.stringify(failedStep)}
Error: ${error.message}

Suggest ONE recovery action as JSON: { "type": "click|type|navigate|wait", "selector": "...", "value": "...", "url": "..." }` }],
        systemPrompt: 'Return ONLY valid JSON for a single recovery action.',
        tools: []
      });

      if (!result.error && result.content) {
        const text = result.content.filter(b => b.type === 'text').map(b => b.text).join('');
        const action = JSON.parse(text.replace(/```json|```/g, '').trim());
        await this.executeStep({ ...action, critical: false, description: 'Recovery: ' + (action.type || 'action') }, 0);
        return { success: true };
      }
    } catch (e) {}
    return { success: false };
  },

  // Verify a step succeeded
  async verifyStep(step) {
    try {
      const content = await window.avis.chromeGetContent();
      const check = step.verifyAfter || step.value || '';
      return {
        success: content?.toLowerCase().includes(check.toLowerCase()),
        content: content?.substring(0, 500)
      };
    } catch (e) {
      return { success: false };
    }
  },

  // Summarize what was accomplished
  async summarizeResult(task, steps) {
    const completed = steps.filter(s => s.success).length;
    const total = steps.length;

    try {
      const result = await window.avis.apiCallAgentic({
        model: 'claude-haiku-4-5-20251001',
        messages: [{ role: 'user', content: `Summarize in 2-3 sentences.
Task: ${task}
Steps completed: ${completed}/${total}
Results: ${JSON.stringify(steps.map(s => ({ step: s.step.description, success: s.success })))}` }],
        systemPrompt: 'Summarize browser task results concisely.',
        tools: []
      });

      if (!result.error && result.content) {
        return result.content.filter(b => b.type === 'text').map(b => b.text).join('');
      }
    } catch (e) {}
    return `Completed ${completed}/${total} steps for: ${task}`;
  },

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};
