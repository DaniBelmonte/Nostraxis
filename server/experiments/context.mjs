import { createHash } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value).digest('hex');

export function materializeContext({ strategy, task, promptTemplate = '{{context}}\n\n{{task}}', repository, contextItems = [] }) {
  if (!['raw-repo', 'knowledge-base', 'llm-wiki'].includes(strategy)) throw new Error('Unsupported context strategy.');
  const items = contextItems.map((item, index) => {
    const content = String(item.content || '');
    if (!content.trim()) throw new Error(`Context item ${index + 1} is empty.`);
    return { type: item.type || strategy, name: String(item.name || `context-${index + 1}`), content, sha256: hash(content), metadata: item.metadata || {} };
  });
  const contextText = items.map((item) => `### ${item.name}\n${item.content}`).join('\n\n');
  const renderedPrompt = promptTemplate.replaceAll('{{context}}', contextText).replaceAll('{{task}}', task).trim();
  return {
    version: 1,
    strategy,
    capturedAt: new Date().toISOString(),
    repository: repository ? { id: repository.id, name: repository.name, path: repository.path, branch: repository.branch || null, headSha: repository.headSha || null } : null,
    promptTemplate,
    task,
    renderedPrompt,
    items,
    digest: hash(JSON.stringify({ strategy, repository, promptTemplate, task, items })),
    reproducible: Boolean(repository?.headSha || strategy !== 'raw-repo'),
  };
}
