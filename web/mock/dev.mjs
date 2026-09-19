// Starts the mock API (8787) and the Vite dev server (5173) together: `node mock/dev.mjs`
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..');
const opts = { stdio: 'inherit', cwd: web };
const mock = spawn(process.execPath, [path.join(here, 'server.mjs')], opts);
const vite = spawn(process.execPath, [path.join(web, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'], opts);
const stop = () => { mock.kill(); vite.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
vite.on('exit', stop); mock.on('exit', stop);
