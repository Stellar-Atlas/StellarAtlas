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

	it('keeps repair plans on the live node archive-evidence composition', () => {
		const page = readRoute('../nodes/[publicKey]/page.tsx');
		const route = readRoute(
			'../../components/archive-scans/known-archive-evidence-route.tsx'
		);
		const nodeEvidence = readRoute(
			'../../components/nodes/node-archive-evidence.tsx'
		);
		const evidence = readRoute(
			'../../components/archive-scans/known-archive-evidence.tsx'
		);
		const views = readRoute(
			'../../components/archive-scans/known-archive-evidence-views.tsx'
		);

		expect(page).toContain('NodeArchiveEvidenceRoute');
		expect(page).not.toContain('NodeArchiveHealth');
		expect(route).toContain('NodeArchiveEvidence');
		expect(nodeEvidence).toContain('KnownArchiveEvidence');
		expect(evidence).toContain('KnownArchiveEvidenceTabContent');
		expect(views).toContain('<RepairView');
		expect(views).toContain('<ArchiveRepairPlanPanel');
	});
});

function readRoute(path: string): string {
	return readFileSync(new URL(path, import.meta.url), 'utf8');
}
