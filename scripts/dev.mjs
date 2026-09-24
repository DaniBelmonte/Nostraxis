import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'server/start.mjs');
const serverDirectory = path.join(root, 'server');
let child;
let restartTimer;
let forceTimer;
let restarting = false;
let stopping = false;

const watcher = watch(serverDirectory, { recursive: true }, (_event, filename) => {
  if (stopping || !filename || !/\.(mjs|js|json)$/.test(filename)) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (!child || restarting) return;
    restarting = true;
    console.log(`Backend changed (${filename}); restarting local API…`);
    child.kill('SIGTERM');
    forceTimer = setTimeout(() => child?.kill('SIGKILL'), 3000);
  }, 180);
});

function start() {
  child = spawn(process.execPath, [serverPath, '--dev', ...process.argv.slice(2)], { cwd: root, env: process.env, stdio: 'inherit' });
  child.once('exit', (code) => {
    clearTimeout(forceTimer);
    child = null;
    if (stopping) return;
    if (restarting) { restarting = false; start(); return; }
    watcher.close();
    process.exitCode = code ?? 1;
  });
}

function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(restartTimer);
  watcher.close();
  child?.kill('SIGTERM');
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
watcher.on('error', (error) => { console.error('Backend watcher failed:', error); stop(); process.exitCode = 1; });
start();
