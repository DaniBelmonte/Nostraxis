import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

const folderId = (folderPath) => `folder:${createHash('sha256').update(folderPath).digest('hex').slice(0, 16)}`;
const pathContains = (folderPath, candidate) => {
  if (!path.isAbsolute(candidate)) return false;
  const folder = path.resolve(folderPath);
  const child = path.resolve(candidate);
  return child === folder || child.startsWith(`${folder}${path.sep}`);
};
const normalizeFolderPath = (value) => {
  const rawPath = String(value || '').trim();
  if (!path.isAbsolute(rawPath)) throw new Error('Choose a folder or enter an absolute workspace path.');
  const normalized = path.resolve(rawPath);
  if (normalized === path.parse(normalized).root) throw new Error('Choose a folder inside the filesystem root.');
  return normalized;
};

export function createWorkProjectService(store) {
  function inventory(runs = store.listRuns()) {
    const manual = store.listWorkProjects().map((project) => ({ ...project, source: 'manual' }));
    const manualPaths = manual.flatMap((project) => project.folderPaths);
    const hiddenPaths = store.hiddenWorkProjectPaths();
    const folders = [...new Set(runs.map((run) => run.repositoryPath).filter((folderPath) => folderPath && folderPath !== path.parse(folderPath).root))]
      .filter((folderPath) => !manualPaths.some((manualPath) => pathContains(manualPath, folderPath)) && !hiddenPaths.some((hiddenPath) => pathContains(hiddenPath, folderPath)))
      .map((folderPath) => ({ id: folderId(folderPath), name: path.basename(folderPath) || folderPath, folderPath, source: 'detected' }));
    return [...manual, ...folders].sort((a, b) => (a.source === b.source ? 0 : a.source === 'manual' ? -1 : 1) || a.name.localeCompare(b.name) || (a.folderPath || '').localeCompare(b.folderPath || ''));
  }

  function resolve(runs = store.listRuns()) {
    const projects = inventory(runs);
    const manual = projects.filter((project) => project.source === 'manual');
    const detected = new Map(projects.filter((project) => project.source === 'detected').map((project) => [project.folderPath, project]));
    const assignments = new Map(store.runWorkProjectAssignments().map((item) => [item.runId, item.projectId]));
    const manualById = new Map(manual.map((project) => [project.id, project]));
    const orderedPaths = manual.flatMap((project) => project.folderPaths.map((folderPath) => ({ project, folderPath }))).sort((a, b) => b.folderPath.length - a.folderPath.length);
    const decorated = runs.map((run) => {
      const assigned = assignments.has(run.id);
      const project = assigned
        ? manualById.get(assignments.get(run.id))
        : orderedPaths.find((item) => run.repositoryPath && pathContains(item.folderPath, run.repositoryPath))?.project || detected.get(run.repositoryPath);
      return { ...run, workProjectId: project?.id || null, workProjectName: project?.name || null, workProjectSource: project?.source || null, workProjectAssignment: assigned ? assignments.get(run.id) || 'unassigned' : 'auto' };
    });
    const counts = new Map();
    decorated.forEach((run) => { if (run.workProjectId) counts.set(run.workProjectId, (counts.get(run.workProjectId) || 0) + 1); });
    return { projects: projects.map((project) => ({ ...project, sessionCount: counts.get(project.id) || 0 })), runs: decorated };
  }

  function create(input) {
    const name = String(input?.name || '').trim();
    const rawPath = String(input?.folderPath || '').trim();
    if (!name || name.length > 100) throw new Error('Enter a project name of up to 100 characters.');
    const folderPath = rawPath ? normalizeFolderPath(rawPath) : null;
    if (folderPath && store.listWorkProjects().some((project) => project.folderPaths.some((item) => path.resolve(item) === folderPath))) throw new Error('A work project already uses that folder.');
    const project = store.saveWorkProject({ id: `work:${randomUUID()}`, name, folderPath, createdAt: new Date().toISOString() });
    if (folderPath) store.showWorkProjectPath(folderPath);
    return project;
  }

  function addFolder(projectId, value) {
    if (!store.getWorkProject(projectId)) throw new Error('Work project not found.');
    const folderPath = normalizeFolderPath(value);
    if (store.listWorkProjects().some((project) => project.folderPaths.some((item) => path.resolve(item) === folderPath))) throw new Error('This workspace already belongs to a work project.');
    const project = store.addWorkProjectFolder(projectId, folderPath);
    store.showWorkProjectPath(folderPath);
    return project;
  }

  function removeFolder(projectId, value) {
    const project = store.getWorkProject(projectId);
    if (!project) throw new Error('Work project not found.');
    const folderPath = normalizeFolderPath(value);
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
  }

  function assignMany(runIds, projectId) {
    if (!Array.isArray(runIds) || runIds.length === 0 || runIds.length > 500 || runIds.some((id) => typeof id !== 'string')) throw new Error('Select between 1 and 500 sessions.');
    const ids = [...new Set(runIds)];
    if (ids.some((id) => !store.getRun(id))) throw new Error('A selected session was not found.');
    if (projectId !== 'auto' && projectId && !store.getWorkProject(projectId)) throw new Error('Assign sessions to a user-created work project.');
    ids.forEach((id) => assign(id, projectId));
    return ids.length;
  }

  return { inventory, resolve, create, addFolder, removeFolder, remove, restore, assign, assignMany };
}
