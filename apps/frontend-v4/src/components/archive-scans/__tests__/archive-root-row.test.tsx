import { renderToStaticMarkup } from 'react-dom/server';
import { ArchiveRootRow } from '../archive-root-row';
import type { ArchiveSource } from '../archive-inventory-model';

const source = {
	archiveUrl:
		'https://stellar-validator-mainnet.s3.us-east-1.amazonaws.com/history/validator-01',
	archiveUrlIdentity: 'alchemy-01',
	stateUrl: 'https://archive.example/.well-known/stellar-history.json',
	stateStatus: 'available',
	rootObjectStatus: 'verified',
	currentLedger: 64_309_119,
	latestCheckpointLedger: 64_309_119,
	latestDiscoveredCheckpointLedger: 64_062_143,
	durableVerifiedCheckpointProofs: 88,
	verifiedCheckpointProofs: 23,
	totalCheckpointProofs: 54_322,
	pendingCheckpointProofs: 4_645,
	notEvaluableCheckpointProofs: 49_654,
	objectCompleteCheckpointProofs: 310,
	archiveEvidenceFailures: 48_722,
	scannerIssueFailures: 1,
	unclassifiedFailures: 0,
	mismatchCheckpointProofs: 0,
	activeObjectChecks: 0,
	listingGapCount: 0,
	observedAt: '2026-09-06T23:00:00Z'
} as ArchiveSource;

function render(overrides: Partial<ArchiveSource> = {}): string {
	return renderToStaticMarkup(
		<table>
			<tbody>
				<ArchiveRootRow
					advertisers={[]}
					canonicalArchiveUrlIdentity={null}
					organizationNames={new Map()}
					source={{ ...source, ...overrides }}
				/>
			</tbody>
		</table>
	);
}

describe('archive inventory source evidence', () => {
	it('does not present the advertised head as a verified attestation or queue counts as live activity', () => {
		const html = render();
		expect(html).toContain('Advertised ledger 64,309,119');
		expect(html).toContain('88 /');
		expect(html).toContain('1,004,830');
		expect(html).toContain('Current-version verified proofs</dt><dd>23</dd>');
		expect(html).toContain('Tracked checkpoint records</dt><dd>54,322</dd>');
		expect(html).toContain(
			'Incomplete or older proof version</dt><dd>49,654</dd>'
		);
		expect(html).toContain(
			'Highest tracked checkpoint ledger (not verified coverage)'
		);
		expect(html).not.toContain('Highest attested');
		expect(html).not.toContain('proof-version attestations');
		expect(html).not.toContain('0 active');
		expect(html).toContain('<details class="archive-check-details">');
		expect(html).not.toContain('<details class="archive-check-details" open');
	});

	it('keeps listing gaps, direct failures, and infrastructure issues separate', () => {
		const html = render({ listingGapCount: 2 });
		expect(html).toContain(
			'48,722 unresolved checks; reason summary is being prepared'
		);
		expect(html).toContain('2 ranges absent from filename listings');
		expect(html).toContain(
			'Scanner issues (not archive faults)</dt><dd>1</dd>'
		);
		expect(html).not.toContain('48,723 unresolved checks');
		expect(html).toContain('data-label="Archive findings"');
		expect(html).toContain('href="' + source.archiveUrl + '"');
	});
});
