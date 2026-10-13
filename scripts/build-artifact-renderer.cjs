const { build } = require('esbuild');
build({
  entryPoints: ['src/renderer/artifact-diagram.ts'],
  outfile: 'out/main/artifact-diagram.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome148',
  minify: true,
  legalComments: 'eof',
}).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
