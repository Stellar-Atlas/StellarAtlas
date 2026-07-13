/// <reference types="jest" />

import { readFileSync } from 'node:fs';

describe('current archive evidence route contract', () => {
	it.each([
		['node', '../nodes/[publicKey]/page.tsx'],
		['organization', '../organizations/[organizationId]/page.tsx']
	])('%s detail route uses the object-evidence surface', (_label, path) => {
		const source = readRoute(path);

		expect(source).toContain('known-archive-evidence-route');
		expect(source).not.toContain('history-archive-scan-log');
	});

	it.each([
		['archive source', '../archive-scans/[...historyUrl]/page.tsx'],
		['status', '../status/page.tsx']
	])('%s route excludes the legacy range-scan component', (_label, path) => {
		expect(readRoute(path)).not.toContain('history-archive-scan-log');
	});
});

function readRoute(path: string): string {
	return readFileSync(new URL(path, import.meta.url), 'utf8');
}
