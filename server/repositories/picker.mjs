import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
let pending = false;
export async function chooseRepositoryFolder() {
  if (pending) throw new Error('A folder picker is already open.');
  pending = true;
  try {
    if (process.platform !== 'darwin') throw new Error('The native picker is available on macOS. Enter the path on this system.');
    const { stdout } = await exec('/usr/bin/osascript', ['-e', 'POSIX path of (choose folder with prompt "Select a repository for Nostraxis")'], { timeout: 120000 });
    return { path: stdout.trim() };
  } catch (error) {
    if (String(error.stderr).includes('(-128)')) return { path: null, cancelled: true };
    throw error;
  } finally { pending = false; }
}
