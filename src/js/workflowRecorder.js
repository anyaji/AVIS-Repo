// Workflow Recorder — save and replay successful browser workflows
const WorkflowRecorder = {
  async saveWorkflow(name, taskDescription, steps) {
    return await window.avis.workflowSave(name, taskDescription, steps);
  },

  async listWorkflows() {
    return await window.avis.workflowList();
  },

  async loadWorkflow(filename) {
    return await window.avis.workflowLoad(filename);
  },

  async findMatchingWorkflow(message) {
    return await window.avis.workflowFind(message);
  },

  // Replay a saved workflow through BrowserAgent
  async replayWorkflow(workflow) {
    Orchestrator.emitStep('browser', '\u26A1 Replaying saved workflow: ' + workflow.name);
    const results = [];

    for (const step of workflow.steps) {
      const result = await BrowserAgent.executeStep(step, results.length + 1);
      results.push(result);
      if (!result.success && result.critical) break;
    }

    const completed = results.filter(r => r.success).length;
    return {
      success: results.every(s => s.success || !s.critical),
      steps: results,
      summary: `Completed workflow "${workflow.name}" (${completed}/${results.length} steps)`
    };
  }
};
