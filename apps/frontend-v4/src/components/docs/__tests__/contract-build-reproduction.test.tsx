import { describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { contractReproductionSection } from '../developer-guide-contract-reproduction';
import {
	compareBuildCommands,
	offlineBuildCommands,
	reproductionExample as example
} from '../contract-build-reproduction-example';
import { contractVerificationGuide } from '../developer-guide-contract-verification';

function artifact(name: string): Buffer {
	return readFileSync(
		new URL(
			`../../../../../../examples/contract-build-reproduction/${name}`,
			import.meta.url
		)
	);
}
const sha256 = (value: Buffer): string =>
	createHash('sha256').update(value).digest('hex');

describe('controlled contract reproduction guide', () => {
	it('renders a bounded real-contract lookup and separates it from the rebuild', () => {
		const lookup = contractVerificationGuide.sections.find(
			(section) => section.id === 'lookup-provenance'
		);
		const boundaries = contractVerificationGuide.sections.find(
			(section) => section.id === 'verification-boundaries'
		);
		const html = renderToStaticMarkup(lookup?.content);
		expect(html).toContain('curl -q --include --fail-with-body --connect-timeout 5 --max-time 60');
		expect(html).toContain('/v1/contracts/CBQSUF57OYX4RIMCZV62DKN6JFOTEKPHIZASMJYOUOCNHGNG2P3XQLSE/provenance');
		expect(html).toContain('f60d33ec57eecee04b52d048c1c079983ff1b3834c8195fea811b025fb889361');
		expect(html).toContain('build.record.commit');
		const copy = renderToStaticMarkup(boundaries?.content);
		expect(copy).toContain('Build attested');
		expect(copy).toContain('source-to-Wasm match');
		expect(copy).toContain('href="#offline-reproduction"');
	});
	it('uses the accepted derived manifests without changing dependencies', () => {
		expect(sha256(artifact('Cargo.toml'))).toBe(example.rootSha256);
		expect(sha256(artifact('Cargo.lock'))).toBe(example.lockSha256);
		expect(
			artifact('Cargo.lock')
				.toString()
				.match(/\[\[package\]\]/g)
		).toHaveLength(155);
		const target = artifact('wasm-target.sha256').toString().trim().split('\n');
		expect(target).toHaveLength(27);
		for (const line of target)
			expect(line).toMatch(/^[a-f0-9]{64}  lib\/[a-zA-Z0-9_.-]+$/);
	});
	it('renders within the existing guide with explicit evidence limits', () => {
		expect(contractVerificationGuide.sections.at(-1)).toBe(
			contractReproductionSection
		);
		const html = renderToStaticMarkup(contractReproductionSection.content);
		for (const phrase of [
			'Build attested',
			'not_run',
			'newly authored local reference',
			'same operator',
			'Fresh-machine bootstrap',
			'deployed identity were not tested',
			'network disabled',
			'read-only root filesystem'
		])
			expect(html).toContain(phrase);
		for (const [, bytes, hash] of example.results) {
			expect(html).toContain(String(bytes));
			expect(html).toContain(hash);
		}
		expect(html).not.toMatch(/\.runtime|[A-Z]:\\Users|\/home\/node/);
	});
	it('keeps compilation frozen and optimization before comparison', () => {
		expect(offlineBuildCommands).toContain('--frozen --offline');
		expect(offlineBuildCommands).toContain(
			'run_clean /tools/stellar contract optimize'
		);
		expect(offlineBuildCommands).toContain('--profile=test-wasms');
		expect(offlineBuildCommands).toContain('env -i');
		expect(offlineBuildCommands).not.toMatch(
			/cargo (fetch|install)|docker pull|--image|--locked/
		);
		expect(compareBuildCommands).toContain(
			'cmp --silent reference.wasm rebuilt.wasm'
		);
		expect(compareBuildCommands).toContain('>1 = comparison error');
	});
	it('preserves the measured positive and negative comparisons', () => {
		expect(example.results[0][2]).toBe(example.results[1][2]);
		expect(example.results[2][2]).not.toBe(example.results[0][2]);
		expect(example.results[3][1]).toBe(example.results[0][1] + 3);
		expect(example.results[3][2]).not.toBe(example.results[1][2]);
	});
});
