import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const screenshotsSource = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const screenshotsTarget = fileURLToPath(new URL('../public/screenshots/', import.meta.url));
const iconSource = fileURLToPath(new URL('../../../public/app-icon.svg', import.meta.url));
const iconTarget = fileURLToPath(new URL('../public/app-icon.svg', import.meta.url));

await mkdir(screenshotsTarget, { recursive: true });

// The product screenshots do not ship with the open source tree: without the folder there is nothing to copy.
for (const name of await readdir(screenshotsSource).catch(() => [])) {
  if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
  await copyFile(`${screenshotsSource}/${name}`, `${screenshotsTarget}/${name}`);
}

await copyFile(iconSource, iconTarget);
