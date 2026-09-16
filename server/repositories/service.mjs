import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const repositoryId = (value) => `repo-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;

async function git(cwd, args) {
  try { return (await exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, timeout: 5000, maxBuffer: 128_000 })).stdout.trim(); }
  catch { return null; }
}

export function createRepositoryService(store) {
  return {
    list: () => store.listRepositories(),
    get: (id) => store.getRepository(id),
    async match(workspace) {
      if (!workspace) return null;
      const candidate = await realpath(workspace).catch(() => path.resolve(workspace));
      return store.listRepositories()
        .filter((repository) => candidate === repository.path || candidate.startsWith(`${repository.path}${path.sep}`))
        .sort((a, b) => b.path.length - a.path.length)[0] || null;
    },
    async add(inputPath) {
      const requestedPath = String(inputPath || '').trim();
      if (!requestedPath) throw new Error('Enter the absolute repository path.');
      if (!path.isAbsolute(requestedPath)) throw new Error('The repository path must be absolute.');

      let resolved;
      try {
        resolved = await realpath(requestedPath);
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
          throw new Error('The specified path does not exist or cannot be read.');
        }
        throw error;
      }

      if (!(await stat(resolved)).isDirectory()) throw new Error('The path must point to a folder.');
      const root = await git(resolved, ['rev-parse', '--show-toplevel']) || resolved;
      const repository = {
        id: repositoryId(root), name: path.basename(root), path: root,
        branch: await git(root, ['branch', '--show-current']),
        headSha: await git(root, ['rev-parse', 'HEAD']),
        createdAt: new Date().toISOString(),
      };
      return store.saveRepository(repository);
    },
  };
}
