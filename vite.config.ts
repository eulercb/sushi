import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Include every emitted asset, including public files, and change the cache when
// any byte changes. The worker itself is excluded to avoid a circular hash.
function offlineBundle(): Plugin {
  let output = '';
  return {
    name: 'sushi-offline-bundle',
    apply: 'build',
    configResolved(config) { output = resolve(config.root, config.build.outDir); },
    async closeBundle() {
      async function files(directory: string, prefix = ''): Promise<string[]> {
        const entries = await readdir(directory, { withFileTypes: true });
        const nested = await Promise.all(entries.map(entry => entry.isDirectory()
          ? files(resolve(directory, entry.name), `${prefix}${entry.name}/`)
          : Promise.resolve([`${prefix}${entry.name}`])));
        return nested.flat();
      }
      const paths = (await files(output)).filter(path => path !== 'sw.js').sort();
      const source = await readFile(resolve(output, 'sw.js'), 'utf8');
      const hash = createHash('sha256').update(source);
      for (const path of paths) hash.update(path).update(await readFile(resolve(output, path)));
      await writeFile(resolve(output, 'sw.js'), source
        .replace('__BUILD_VERSION__', hash.digest('hex').slice(0, 20))
        .replace('/* __PRECACHE__ */ []', JSON.stringify(paths)));
    },
  };
}

export default defineConfig({
  base: process.env.BASE_PATH || '/sushi/',
  plugins: [offlineBundle()],
});
