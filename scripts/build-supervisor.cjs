const { existsSync, mkdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform === 'win32') {
  const compiler = join(
    process.env.SystemRoot || 'C:\\Windows',
    'Microsoft.NET',
    'Framework64',
    'v4.0.30319',
    'csc.exe',
  );
  if (!existsSync(compiler))
    throw new Error(
      'The Windows .NET Framework C# compiler is required to build process supervision.',
    );
  const output = resolve('out/main/runtime-supervisor.exe');
  mkdirSync(resolve('out/main'), { recursive: true });
  const result = spawnSync(
    compiler,
    [
      '/nologo',
      '/optimize+',
      '/target:exe',
      '/platform:anycpu',
      `/out:${output}`,
      resolve('src/main/native/RuntimeSupervisor.cs'),
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
