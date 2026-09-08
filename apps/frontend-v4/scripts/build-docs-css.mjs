import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { scopeDocsCss } from './scope-docs-css.mjs';

const app = fileURLToPath(new URL('../', import.meta.url));
const input = path.join(app, 'src/components/docs/fumadocs.input.css');
const output = path.join(app, 'generated/fumadocs.css');
const source = await readFile(input, 'utf8');
if (
	/tailwindcss\/(?:preflight|index)|@import\s+['"]tailwindcss['"]/.test(source)
) {
	throw new Error('Docs styles must not import global Tailwind preflight.');
}
const result = await postcss([
	tailwind({ base: app, optimize: false }),
	scopeDocsCss()
]).process(source, { from: input, to: output, map: false });
await mkdir(path.dirname(output), { recursive: true });
const temporary = output + '.' + process.pid + '.tmp';
await writeFile(temporary, result.css);
await rename(temporary, output);
console.log(
	'Generated route-scoped docs stylesheet (' +
		Buffer.byteLength(result.css) +
		' bytes).'
);
