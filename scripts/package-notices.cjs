const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const { ensureSpawnHelpersExecutable } = require('./native.cjs');

module.exports = async ({ packager }) => {
  const root = packager.projectDir;
  ensureSpawnHelpersExecutable(root);
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const dependencies = Object.entries(lock.packages)
    .filter(([path, entry]) => path && !entry.dev)
    .map(([path, entry]) => ({
      name: path.split('node_modules/').at(-1),
      version: entry.version,
      license: entry.license ?? 'See package license',
      path,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  await mkdir(join(root, 'out'), { recursive: true });
  await writeFile(
    join(root, 'out/dependency-licenses.json'),
    JSON.stringify({ application: lock.name, version: lock.version, dependencies }, null, 2) + '\n',
  );
};
