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

export function buildObservability(runs, store) {
  const commandCounts = new Map(), nodes = new Map(), links = new Map();
  let warningCount = 0, fileReads = 0, fileWrites = 0, errors = 0;
  const connect = (a, b) => {
    nodes.set(a.id, a); nodes.set(b.id, b);
    const key = a.id + '|' + b.id;
    const link = links.get(key) || { source: a.id, target: b.id, count: 0 };
    link.count++; links.set(key, link);
  };
  for (const run of runs) {
    const events = store.eventsFor(run.id);
    const activity = activityFor(events);
    warningCount += activity.warnings.length;
    errors += events.filter(e => e.type === 'agent.error').length;
    const project = { id: 'project:' + run.repositoryPath, name: run.repositoryName || 'No project', kind: 'project' };
    const model = { id: 'model:' + run.provider + ':' + run.model, name: run.model || run.provider, kind: 'model' };
    connect(project, model);
    for (const command of activity.commands) {
      commandCounts.set(command.name, (commandCounts.get(command.name) || 0) + command.count);
      connect(model, { id: 'command:' + command.name, name: command.name, kind: 'command' });
    }
    for (const file of activity.files) {
      fileReads += file.reads; fileWrites += file.writes;
      connect(model, { id: 'file:' + run.repositoryPath + ':' + file.path, name: file.path, kind: 'file' });
    }
  }
  return { warningCount, fileReads, fileWrites, errors,
    commands: [...commandCounts].map(([name,count]) => ({ name,count })).sort((a,b) => b.count-a.count),
    graph: { nodes: [...nodes.values()], links: [...links.values()] } };
}
