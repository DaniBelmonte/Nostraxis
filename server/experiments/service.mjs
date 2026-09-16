import { randomUUID } from 'node:crypto';
import { materializeContext } from './context.mjs';
import { evaluatorCatalog } from '../evaluators/index.mjs';

export function createExperimentService({ store, repositories, runs }) {
  function create(body) {
    const repository = repositories.get(body.repositoryId);
    if (!repository) throw new Error('Select a registered repository.');
    const task = String(body.task || '').trim();
    if (!task) throw new Error('Experiment task is required.');
    if (!Array.isArray(body.variants) || body.variants.length < 2 || body.variants.length > 12) throw new Error('Experiments require between 2 and 12 variants.');
    const now = new Date().toISOString();
    const experiment = {
      id: randomUUID(), name: String(body.name || 'Untitled experiment').slice(0, 120), task,
      repositoryId: repository.id, evaluatorId: body.evaluatorId || 'manual', status: 'draft',
      createdAt: now, updatedAt: now, metadata: body.metadata || {},
      variants: body.variants.map((variant, index) => ({
        id: randomUUID(), label: String(variant.label || `Variant ${index + 1}`),
        provider: variant.provider, model: String(variant.model || ''),
        promptTemplate: String(variant.promptTemplate || '{{context}}\n\n{{task}}'),
        contextStrategy: variant.contextStrategy || 'raw-repo',
        contextSnapshot: materializeContext({ strategy: variant.contextStrategy || 'raw-repo', task, promptTemplate: variant.promptTemplate || '{{context}}\n\n{{task}}', repository, contextItems: variant.contextItems || [] }),
        runId: null, status: 'draft',
      })),
    };
    return store.saveExperiment(experiment);
  }

  async function start(id) {
    const experiment = store.getExperiment(id);
    if (!experiment) throw new Error('Experiment not found.');
    experiment.status = 'running'; experiment.updatedAt = new Date().toISOString();
    for (const variant of experiment.variants) {
      const run = await runs.create({
        name: `${experiment.name} · ${variant.label}`, repositoryId: experiment.repositoryId,
        provider: variant.provider, model: variant.model, prompt: experiment.task,
        contextSnapshot: variant.contextSnapshot, allowWrites: false, allowShell: true,
        evaluator: { id: experiment.evaluatorId, config: experiment.metadata?.evaluatorConfig || {} },
      }, { experimentId: experiment.id });
      variant.runId = run.id; variant.status = 'running';
    }
    store.saveExperiment(experiment);
    return experiment;
  }

  return {
    list: () => store.listExperiments(), get: (id) => store.getExperiment(id), create, start,
    catalog: () => ({ strategies: [
      { id: 'raw-repo', name: 'Raw repository', reproducibility: 'Pinned by repository HEAD; file reads captured as events.' },
      { id: 'knowledge-base', name: 'Knowledge Base', reproducibility: 'Exact injected content and SHA-256 are persisted.' },
      { id: 'llm-wiki', name: 'LLM Wiki', reproducibility: 'Exact generated wiki snapshot and SHA-256 are persisted.' },
    ], evaluators: evaluatorCatalog() }),
  };
}
