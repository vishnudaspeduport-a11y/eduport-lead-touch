// Deploys the Worker with a BUILD_ID var (git commit, plus "-dirty" when the tree has uncommitted changes).
// cache.ts puts BUILD_ID into every cache key, so a deploy never serves answers computed by the previous build.
import { execSync, spawnSync } from 'node:child_process';

const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim() ? '-dirty' : '';
const buildId = `${sha}${dirty}-${Date.now().toString(36)}`;
console.log(`BUILD_ID=${buildId}`);
const r = spawnSync('npx', ['wrangler', 'deploy', '--var', `BUILD_ID:${buildId}`], { stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
