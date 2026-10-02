export function validFileEvent(event) {
  return Boolean(event.data?.path) && !(event.data.inferred && /[<>$*]/.test(event.data.path));
}
export function warningsFor(event) {
  const data = event.data || {};
  const warnings = [];
  if (data.path && /(^|[/\\])(?:\.env(?:\.[^/\\]+)?|\.ssh|\.aws|credentials[^/\\]*|id_rsa|id_ed25519)|\.(?:pem|p12|key)$/i.test(data.path)) {
    warnings.push({ severity: 'warning', kind: 'sensitive-file', message: 'Archivo potencialmente sensible: credenciales o claves.', target: data.path });
  }
  if (data.command && /\b(?:sudo|chmod\s+777|rm\s+[^\n]*-[a-z]*r|git\s+(?:reset\s+--hard|push\s+--force)|curl\b[^\n]*\|\s*(?:sh|bash)|printenv|env\s*$)/i.test(data.command)) {
    warnings.push({ severity: 'warning', kind: 'sensitive-command', message: 'Command may be destructive, privileged or expose variables.', target: data.command });
  }
  return warnings.map((warning) => ({ ...warning, eventId: event.id, timestamp: event.timestamp }));
}

export function activityFor(events) {
  const commands = new Map();
  const files = new Map();
  const warnings = [];
  for (const event of events) {
    const data = event.data || {};
    if (!event.type.endsWith('completed')) warnings.push(...warningsFor(event));
    if (data.command && !event.type.endsWith('completed')) {
      const words = data.command.trim().split(/\s+/).filter(word => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
      const name = words.slice(0, /^(git|npm|pnpm|yarn|docker)$/.test(words[0]) ? 2 : 1).join(' ') || 'Variable assignment';
      commands.set(name, (commands.get(name) || 0) + 1);
    }
    if (validFileEvent(event) && /file_(read|modified)/.test(event.type)) {
      const item = files.get(data.path) || { path: data.path, reads: 0, writes: 0 };
      if (event.type.endsWith('modified')) item.writes++; else item.reads++;
      files.set(item.path, item);
    }
  }
  return { commands: [...commands].map(([name, count]) => ({ name, count })).sort((a,b) => b.count-a.count), files: [...files.values()], warnings };
}

// Command families are a presentation-neutral grouping of the observed command
// name; anything we do not recognise stays 'other' instead of being guessed.
const COMMAND_CATEGORIES = [
  ['navigation', /^(?:cd|pushd|popd)\b/],
  ['git', /^git\b/],
  ['search', /^(?:grep|rg|ag|ack|find|fd|locate|which|jq)\b/],
  ['edit', /^(?:sed|awk|patch|apply_patch|vi|vim|nano|tee|ed)\b/],
  ['file system', /^(?:ls|cat|cp|mv|rm|mkdir|rmdir|touch|head|tail|wc|stat|chmod|chown|tree|du|df|less|more|open|diff|file|ln|tar|zip|unzip)\b/],
  ['process', /^(?:python3?|node|npm|pnpm|yarn|bun|deno|docker|make|bash|sh|zsh|kill|ps|go|cargo|java|ruby|php|pytest|jest|swift|xcodebuild|curl|wget|sleep)\b/],
  ['environment', /^(?:export|env|printenv|set|source|echo|history|alias|Variable assignment)\b/],
];

export const commandCategory = (name) => COMMAND_CATEGORIES.find(([, pattern]) => pattern.test(name))?.[0] || 'other';

export function buildObservability(runs, store) {
  const commands = new Map(), nodes = new Map(), links = new Map();
  const perRun = [];
  let warningCount = 0, fileReads = 0, fileWrites = 0, errors = 0;
  const add = (bucket, key, amount) => { bucket[key] = (bucket[key] || 0) + amount; };
  const node = (item, weight) => {
    const existing = nodes.get(item.id) || { ...item, weight: 0 };
    existing.weight += weight;
    nodes.set(item.id, existing);
    return existing;
  };
  const connect = (a, b, count = 1) => {
    const key = a.id + '|' + b.id;
    const link = links.get(key) || { source: a.id, target: b.id, count: 0 };
    link.count += count; links.set(key, link);
  };
  for (const run of runs) {
    const events = store.eventsFor(run.id);
    const activity = activityFor(events);
    warningCount += activity.warnings.length;
    errors += events.filter(e => e.type === 'agent.error').length;
    const project = node({ id: 'project:' + run.repositoryPath, name: run.repositoryName || 'No project', kind: 'project' }, 1);
    const model = node({ id: 'model:' + run.provider + ':' + run.model, name: run.model || run.provider, kind: 'model', provider: run.provider }, 1);
    connect(project, model);
    for (const command of activity.commands) {
      const entry = commands.get(command.name)
        || { name: command.name, count: 0, category: commandCategory(command.name), byProvider: {}, byModel: {}, byProject: {}, byPair: {} };
      entry.count += command.count;
      add(entry.byProvider, run.provider, command.count);
      add(entry.byModel, run.model || run.provider, command.count);
      add(entry.byProject, project.name, command.count);
      add(entry.byPair, `${project.name}\u0001${model.name}`, command.count);
      commands.set(command.name, entry);
      connect(model, node({ id: 'command:' + command.name, name: command.name, kind: 'command' }, command.count), command.count);
    }
    for (const file of activity.files) {
      fileReads += file.reads; fileWrites += file.writes;
      const fileNode = node({ id: 'file:' + run.repositoryPath + ':' + file.path, name: file.path, kind: 'file', reads: 0, writes: 0 }, file.reads + file.writes);
      fileNode.reads += file.reads; fileNode.writes += file.writes;
      connect(model, fileNode);
    }
    perRun.push({
      commands: activity.commands.map((command) => 'command:' + command.name),
      files: activity.files.map((file) => 'file:' + run.repositoryPath + ':' + file.path),
    });
  }
  // Commands and files are only related through the session that touched both, so
  // the co-occurrence is limited to the nodes the graph actually draws.
  const top = (kind, limit) => new Set([...nodes.values()].filter((item) => item.kind === kind)
    .sort((a, b) => b.weight - a.weight).slice(0, limit).map((item) => item.id));
  const topCommands = top('command', 10), topFiles = top('file', 14);
  for (const run of perRun) {
    for (const command of new Set(run.commands.filter((id) => topCommands.has(id)))) {
      for (const file of new Set(run.files.filter((id) => topFiles.has(id)))) connect(nodes.get(command), nodes.get(file));
    }
  }
  const commandList = [...commands.values()].sort((a, b) => b.count - a.count);
  return { warningCount, fileReads, fileWrites, errors,
    commands: commandList,
    commandCalls: commandList.reduce((total, command) => total + command.count, 0),
    graph: { nodes: [...nodes.values()], links: [...links.values()] } };
}
