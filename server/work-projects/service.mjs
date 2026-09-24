import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { statSync } from 'node:fs';

const folderId = (folderPath) => `folder:${createHash('sha256').update(folderPath).digest('hex').slice(0, 16)}`;
const pathContains = (folderPath, candidate) => {
  if (!path.isAbsolute(candidate)) return false;
  const folder = path.resolve(folderPath);
  const child = path.resolve(candidate);
  return child === folder || child.startsWith(`${folder}${path.sep}`);
};
const normalizeFolderPath = (value, mustExist = true) => {
  const rawPath = String(value || '').trim();
  if (!path.isAbsolute(rawPath)) throw new Error('Choose a folder or enter an absolute workspace path.');
  const normalized = path.resolve(rawPath);
  if (normalized === path.parse(normalized).root) throw new Error('Choose a folder inside the filesystem root.');
  if (mustExist) try { if (!statSync(normalized).isDirectory()) throw new Error('The workspace path is not a folder.'); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('Workspace folder not found.'); throw error; }
  return normalized;
};

export function createWorkProjectService(store) {
  function inventory(runs = store.listRuns()) {
    const manual = store.listWorkProjects().map((project) => ({ ...project, source: 'manual' }));
    const manualPaths = manual.flatMap((project) => project.folderPaths);
    const hiddenPaths = store.hiddenWorkProjectPaths();
    const folders = [...new Set(runs.map((run) => run.repositoryPath).filter((folderPath) => folderPath && folderPath !== path.parse(folderPath).root))]
      .filter((folderPath) => !manualPaths.some((manualPath) => path.resolve(manualPath) === path.resolve(folderPath)) && !hiddenPaths.some((hiddenPath) => pathContains(hiddenPath, folderPath)))
      .map((folderPath) => ({ id: folderId(folderPath), name: path.basename(folderPath) || folderPath, folderPath, source: 'detected' }));
    return [...manual, ...folders].sort((a, b) => (a.source === b.source ? 0 : a.source === 'manual' ? -1 : 1) || a.name.localeCompare(b.name) || (a.folderPath || '').localeCompare(b.folderPath || ''));
  }

  function resolve(runs = store.listRuns()) {
    const projects = inventory(runs);
    const manual = projects.filter((project) => project.source === 'manual');
    const detected = new Map(projects.filter((project) => project.source === 'detected').map((project) => [project.folderPath, project]));
    const assignments = new Map(store.runWorkProjectAssignments().map((item) => [item.runId, item.projectId]));
    const itemAssignments = new Map(store.runWorkItemAssignments().map((item) => [item.runId, item.workItemId]));
    const items = store.listWorkItems();
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const manualById = new Map(manual.map((project) => [project.id, project]));
    const orderedPaths = manual.flatMap((project) => project.folderPaths.map((folderPath) => ({ project, folderPath }))).sort((a, b) => b.folderPath.length - a.folderPath.length);
    const decorated = runs.map((run) => {
      const assigned = assignments.has(run.id);
      const events = store.organizationEvidenceFor(run.id);
      const observedCwds = events.filter((event) => event.type === 'agent.workspace').map((event) => event.data?.cwd).filter((cwd) => cwd && path.isAbsolute(cwd));
      const cwdPaths = [...new Set([run.repositoryPath, ...observedCwds].filter((cwd) => cwd && path.isAbsolute(cwd)))];
      const matchProjects = (candidate) => new Set(orderedPaths.filter((item) => pathContains(item.folderPath, candidate)).map((item) => item.project.id));
      const cwdProjectSets = cwdPaths.map(matchProjects);
      const fileProjectSets = [];
      for (const event of events) {
        const filePath = event.data?.path;
        if (filePath && path.isAbsolute(filePath)) {
          const matches = matchProjects(filePath);
          if (matches.size) fileProjectSets.push(matches);
        }
      }
      const evidenceSets = [...cwdProjectSets, ...fileProjectSets];
      const commonIds = evidenceSets.length && cwdProjectSets.every((set) => set.size)
        ? [...evidenceSets[0]].filter((id) => evidenceSets.every((set) => set.has(id))) : [];
      let automatic = commonIds.map((id) => manualById.get(id)).filter(Boolean);
      let evidence = automatic.length ? cwdPaths.length ? 'working-directory' : 'observed-files' : null;
      if (!automatic.length && !evidenceSets.some((set) => set.size) && cwdPaths.length === 1 && run.repositoryPath) {
        const detectedProject = detected.get(run.repositoryPath);
        if (detectedProject) { automatic = [detectedProject]; evidence = 'detected-folder'; }
      }
      const assignedProject = assigned ? manualById.get(assignments.get(run.id)) : null;
      const projectsForRun = assigned ? assignedProject ? [assignedProject] : [] : automatic;
      const project = projectsForRun[0];
      const item = itemsById.get(itemAssignments.get(run.id));
      const validItem = item && projectsForRun.some((candidate) => candidate.id === item.projectId);
      return { ...run, workProjectId: project?.id || null, workProjectName: project?.name || null, workProjectIds: projectsForRun.map((candidate) => candidate.id), workProjectNames: projectsForRun.map((candidate) => candidate.name), workProjectSource: project?.source || null, workProjectAssignment: assigned ? assignments.get(run.id) || 'unassigned' : 'auto', projectEvidence: assigned ? 'manual' : evidence, workItemId: validItem ? item.id : null, workItemName: validItem ? item.title : null, workItemKind: validItem ? item.kind : null };
    });
    const counts = new Map();
    decorated.forEach((run) => { for (const id of run.workProjectIds) counts.set(id, (counts.get(id) || 0) + 1); });
    const itemCounts = new Map();
    decorated.forEach((run) => { if (run.workItemId) itemCounts.set(run.workItemId, (itemCounts.get(run.workItemId) || 0) + 1); });
    return { projects: projects.map((project) => ({ ...project, sessionCount: counts.get(project.id) || 0 })), workItems: items.map((item) => ({ ...item, sessionCount: itemCounts.get(item.id) || 0 })), runs: decorated };
  }

  function create(input) {
    const name = String(input?.name || '').trim();
    if (!name || name.length > 100) throw new Error('Enter a project name of up to 100 characters.');
    const provided = Array.isArray(input?.folderPaths) ? input.folderPaths : [input?.folderPath];
    if (!provided.length || provided.some((value) => !String(value || '').trim())) throw new Error('Choose at least one workspace folder for this project.');
    const folderPaths = provided.map((value) => normalizeFolderPath(value));
    if (new Set(folderPaths).size !== folderPaths.length) throw new Error('A workspace folder was selected more than once.');
    const project = store.saveWorkProject({ id: `work:${randomUUID()}`, name, folderPath: folderPaths[0], createdAt: new Date().toISOString() });
    folderPaths.slice(1).forEach((folderPath) => store.addWorkProjectFolder(project.id, folderPath));
    folderPaths.forEach(store.showWorkProjectPath);
    return store.getWorkProject(project.id);
  }

  function addFolder(projectId, value) {
    if (!store.getWorkProject(projectId)) throw new Error('Work project not found.');
    const folderPath = normalizeFolderPath(value);
    if (store.getWorkProject(projectId).folderPaths.includes(folderPath)) throw new Error('This workspace already belongs to this work project.');
    const project = store.addWorkProjectFolder(projectId, folderPath);
    store.showWorkProjectPath(folderPath);
    return project;
  }

  function removeFolder(projectId, value) {
    const project = store.getWorkProject(projectId);
    if (!project) throw new Error('Work project not found.');
    const folderPath = normalizeFolderPath(value, false);
    const storedPath = project.folderPaths.find((item) => path.resolve(item) === folderPath);
    if (!storedPath) throw new Error('Workspace not found in this project.');
    const updated = store.removeWorkProjectFolder(projectId, storedPath);
    store.hideWorkProjectPath(storedPath);
    return updated;
  }

  function remove(id) {
    const manual = store.getWorkProject(id);
    if (manual) {
      manual.folderPaths.forEach((folderPath) => store.hideWorkProjectPath(folderPath));
      store.deleteWorkProject(id);
      return;
    }
    const detected = inventory().find((project) => project.id === id && project.source === 'detected');
    if (!detected) throw new Error('Work project not found.');
    store.hideWorkProjectPath(detected.folderPath);
  }

  function restore(folderPath) {
    const normalized = path.normalize(String(folderPath || '').trim());
    if (!path.isAbsolute(normalized) || !store.hiddenWorkProjectPaths().includes(normalized)) throw new Error('Hidden folder not found.');
    store.showWorkProjectPath(normalized);
  }

  function assign(runId, projectId) {
    if (!store.getRun(runId)) throw new Error('Session not found.');
    if (projectId === 'auto') store.clearRunWorkProject(runId);
    else {
      if (projectId && !store.getWorkProject(projectId)) throw new Error('Assign sessions to a user-created work project.');
      store.setRunWorkProject(runId, projectId || null);
    }
    const resolved = resolve().runs.find((run) => run.id === runId);
    const assignedItem = store.runWorkItemAssignments().find((item) => item.runId === runId);
    if (assignedItem && !resolved.workProjectIds.includes(store.getWorkItem(assignedItem.workItemId)?.projectId)) store.setRunWorkItem(runId, null);
  }

  function assignMany(runIds, projectId) {
    if (!Array.isArray(runIds) || runIds.length === 0 || runIds.length > 2000 || runIds.some((id) => typeof id !== 'string')) throw new Error('Select between 1 and 2000 sessions.');
    const ids = [...new Set(runIds)];
    if (ids.some((id) => !store.getRun(id))) throw new Error('A selected session was not found.');
    if (projectId !== 'auto' && projectId && !store.getWorkProject(projectId)) throw new Error('Assign sessions to a user-created work project.');
    ids.forEach((id) => projectId === 'auto' ? store.clearRunWorkProject(id) : store.setRunWorkProject(id, projectId || null));
    const resolved = new Map(resolve().runs.map((run) => [run.id, run.workProjectIds]));
    const itemAssignments = new Map(store.runWorkItemAssignments().map((item) => [item.runId, item.workItemId]));
    ids.forEach((id) => {
      const itemId = itemAssignments.get(id);
      if (itemId && !resolved.get(id)?.includes(store.getWorkItem(itemId)?.projectId)) store.setRunWorkItem(id, null);
    });
    return ids.length;
  }

  function createItem(input) {
    const project = store.getWorkProject(input?.projectId);
    if (!project) throw new Error('Work project not found.');
    const title = String(input?.title || '').trim();
    const kind = String(input?.kind || 'task').toLowerCase();
    if (!title || title.length > 160) throw new Error('Enter a work item title of up to 160 characters.');
    if (!['feature','task','bug','research','issue','pull-request','experiment'].includes(kind)) throw new Error('Unsupported work item type.');
    return store.saveWorkItem({ id: `item:${randomUUID()}`, projectId: project.id, title, kind, createdAt: new Date().toISOString() });
  }

  function removeItem(id) {
    if (!store.getWorkItem(id)) throw new Error('Work item not found.');
    store.deleteWorkItem(id);
  }

  function assignItems(runIds, workItemId) {
    if (!Array.isArray(runIds) || runIds.length < 1 || runIds.length > 2000 || runIds.some((id) => typeof id !== 'string')) throw new Error('Select between 1 and 2000 sessions.');
    const ids = [...new Set(runIds)];
    const item = workItemId ? store.getWorkItem(workItemId) : null;
    if (workItemId && !item) throw new Error('Work item not found.');
    const resolved = new Map(resolve().runs.map((run) => [run.id, run]));
    if (ids.some((id) => !resolved.has(id))) throw new Error('A selected session was not found.');
    if (item && ids.some((id) => !resolved.get(id).workProjectIds.includes(item.projectId))) throw new Error('Move sessions to the work item project first.');
    ids.forEach((id) => store.setRunWorkItem(id, workItemId || null));
    return ids.length;
  }

  function moveMany(runIds, projectId, workItemId = null) {
    const item = workItemId ? store.getWorkItem(workItemId) : null;
    if (workItemId && !item) throw new Error('Work item not found.');
    if (item && item.projectId !== projectId) throw new Error('The Work Item belongs to another Project.');
    store.db.exec('BEGIN');
    try {
      const count = assignMany(runIds, projectId);
      if (item) assignItems(runIds, item.id);
      store.db.exec('COMMIT');
      return count;
    } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  }

  return { inventory, resolve, create, addFolder, removeFolder, remove, restore, assign, assignMany, createItem, removeItem, assignItems, moveMany };
}
