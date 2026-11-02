import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@jest/globals';

test('pinned contract source and fixture digests match reviewed artifacts', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const manifest = JSON.parse(fs.readFileSync(here + 'manifest.json', 'utf8'));
  expect(manifest.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
  expect(manifest.sourceFiles.length).toBeGreaterThan(30);
  for (const entry of manifest.sourceFiles) {
    const bytes = fs.readFileSync(root + '/' + entry.path);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
  }
  if (process.env.UPDATE_SDK_FIXTURES !== '1') {
    for (const entry of manifest.fixtures) {
      const bytes = fs.readFileSync(here + entry.path);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
    }
    expect(fs.readdirSync(here + 'fixtures').length).toBe(manifest.fixtures.length);
  }
});
