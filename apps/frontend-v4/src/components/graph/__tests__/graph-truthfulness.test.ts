/// <reference types="jest" />

import * as THREE from 'three';
import type { NetworkV1, NodeV1 } from 'shared';
import type { PublicScpGraphStatement } from '../../../api/types';
import {
	activateStatementFlowPath,
	getStatementLaunchDeadlineMs
} from '../graph-animation-effects';
import { getGraphLinkArrowLength } from '../graph-node-object';
import { defaultGraphVisualState } from '../graph-visual-state';
import {
	buildStatementWaveSchedule,
	statementLaunchSafetyMarginMs
} from '../graph-wave-schedule';
import { createWaveShaderMaterial } from '../graph-wave-shader';
import { buildGraph3DModel } from '../model-3d';
import { getStatementFlowPath } from '../scp-flow-paths';
import { TestClock } from './graph-animation-test-harness';

describe('graph model truthfulness', () => {
	it('renders validators and active listeners without retaining inactive listener groups or links', () => {
		const inactiveListener = createNode('inactive-listener', {
			active: false,
			homeDomain: 'inactive.example'
		});
		const validator = createNode('validator', {
			isValidator: true,
			quorumSet: {
				innerQuorumSets: [],
				threshold: 1,
				validators: [inactiveListener.publicKey]
			}
		});
		const activeListener = createNode('active-listener', {
			active: true,
			homeDomain: 'active.example'
		});

		const model = buildGraph3DModel(
			createNetwork([validator, activeListener, inactiveListener])
		);

		expect(model.nodes.map(({ id }) => id)).toEqual([
			'validator',
			'active-listener'
		]);
		expect(model.links).toHaveLength(0);
		expect(model.organizations.map(({ name }) => name)).not.toContain(
			'inactive.example'
		);
	});

	it('retains every directed quorum dependency instead of truncating the model', () => {
		const publicKeys = Array.from(
			{ length: 48 },
			(_, index) => `validator-${index}`
		);
		const validators = publicKeys.map((publicKey) =>
			createNode(publicKey, {
				isValidator: true,
				quorumSet: {
					innerQuorumSets: [],
					threshold: 32,
					validators: publicKeys.filter((candidate) => candidate !== publicKey)
				}
			})
		);

		const model = buildGraph3DModel(createNetwork(validators));

		expect(model.links).toHaveLength(48 * 47);
		expect(
			model.links.every((link) => link.relationship === 'quorum-dependency')
		).toBe(true);
	});

	it('creates directional arrows only for links attached to the inspected node', () => {
		const link = { source: 'validator-1', target: 'validator-2' };

		expect(getGraphLinkArrowLength(link, defaultGraphVisualState)).toBe(0);
		expect(
			getGraphLinkArrowLength(link, {
				...defaultGraphVisualState,
				selectedNodeId: 'validator-1'
			})
		).toBe(2.6);
		expect(
			getGraphLinkArrowLength(link, {
				...defaultGraphVisualState,
				hoveredNodeId: 'unrelated-validator'
			})
		).toBe(0);
	});
});

describe('SCP statement flow truthfulness', () => {
	const signer = createNode('signer', { isValidator: true });
	const relay = createNode('relay', { active: true });
	const model = buildGraph3DModel(createNetwork([signer, relay]));
	const nodesById = new Map(model.nodes.map((node) => [node.id, node]));

	it('records the observed peer without presenting it as a direct relay path', () => {
		const path = getStatementFlowPath(createStatement('relay'), nodesById);

		expect(path).toMatchObject({
			label:
				'prepare signed by signer; observed through relay; relay path unknown',
			observedPeer: { id: 'relay' },
			source: { id: 'signer' },
			target: { id: 'signer' }
		});
	});

	it('does not substitute an unrelated quorum edge when the observed relay is absent', () => {
		const path = getStatementFlowPath(
			createStatement('missing-relay'),
			nodesById
		);

		expect(path).toMatchObject({
			label: 'prepare observed; relay peer unavailable',
			observedPeer: null,
			source: { id: 'signer' },
			target: { id: 'signer' }
		});
	});

	it('schedules the final statement before the hard launch deadline', () => {
		const ledger = {
			animationBudgetMs: 3_300,
			playbackDurationMs: 5_000,
			slotIndex: '63380000',
			statements: [
				createStatement('relay'),
				{
					...createStatement('relay'),
					observedAt: '2026-07-13T00:00:01.000Z',
					statementHash: 'statement-relay-2'
				}
			]
		};
		const schedule = buildStatementWaveSchedule({
			animatedStatementHashes: new Set<string>(),
			elapsedMs: 0,
			ledger,
			nodesById
		});

		expect(schedule).toHaveLength(2);
		expect(schedule.at(-1)?.delayMs).toBeLessThanOrEqual(
			getStatementLaunchDeadlineMs(ledger) - statementLaunchSafetyMarginMs
		);
	});

	it('keeps overlapping node activity until each activation expires', () => {
		const path = getStatementFlowPath(createStatement('relay'), nodesById);
		expect(path).not.toBeNull();
		if (!path) return;
		const clock = new TestClock();
		clock.install();
		const activityTimeoutsRef = { current: [] as number[] };
		const nodeActivityRef = { current: new Map<string, number>() };
		const activate = (): void =>
			activateStatementFlowPath({
				activityTimeoutsRef,
				nodeActivityRef,
				path,
				refreshGraphVisuals: jest.fn()
			});

		activate();
		clock.advanceBy(500);
		activate();
		clock.advanceBy(500);
		activate();
		clock.advanceBy(500);
		activate();
		expect(nodeActivityRef.current.get('signer')).toBeCloseTo(1.52);
		clock.advanceBy(150);
		expect(nodeActivityRef.current.get('signer')).toBeCloseTo(1.14);
		clock.advanceBy(1_499);
		expect(nodeActivityRef.current.get('signer')).toBeGreaterThan(0);
		clock.advanceBy(1);
		expect(nodeActivityRef.current.has('signer')).toBe(false);
		Reflect.deleteProperty(globalThis, 'window');
	});

	it('drops statements whose signer is not represented in the graph', () => {
		expect(
			getStatementFlowPath(
				{ ...createStatement('relay'), nodeId: 'missing-signer' },
				nodesById
			)
		).toBeNull();
	});
});

describe('wave shader fades', () => {
	it('uses monotonically ordered smoothstep edges', () => {
		const material = createWaveShaderMaterial(THREE, 0.5, 4);

		expect(material.fragmentShader).toContain(
			'1.0 - smoothstep(0.0, width, abs(phase - 0.5))'
		);
		expect(material.fragmentShader).toContain(
			'1.0 - smoothstep(0.58, 1.0, vWaveUv.y)'
		);
		expect(material.fragmentShader).not.toContain('smoothstep(width, 0.0');
		expect(material.fragmentShader).not.toContain(
			'smoothstep(1.0, 0.58, vWaveUv.y)'
		);

		material.dispose();
	});
});

function createStatement(observedFromPeer: string): PublicScpGraphStatement {
	return {
		nodeId: 'signer',
		observedAt: '2026-07-13T00:00:00.000Z',
		observedFromPeer,
		slotIndex: '63380000',
		statementHash: `statement-${observedFromPeer}`,
		statementType: 'prepare',
		values: []
	};
}

function createNode(
	publicKey: string,
	overrides: Partial<NodeV1> = {}
): NodeV1 {
	return {
		active: false,
		activeInScp: false,
		alias: null,
		connectivityError: false,
		dateDiscovered: '2026-07-13T00:00:00.000Z',
		dateUpdated: '2026-07-13T00:00:00.000Z',
		geoData: null,
		historyArchiveHasError: false,
		historyUrl: null,
		homeDomain: null,
		host: null,
		index: 0,
		ip: '127.0.0.1',
		isFullValidator: false,
		isValidating: false,
		isValidator: false,
		isp: null,
		lag: null,
		ledgerVersion: null,
		name: publicKey,
		organizationId: null,
		overLoaded: false,
		overlayMinVersion: null,
		overlayVersion: null,
		port: 11625,
		publicKey,
		quorumSet: null,
		quorumSetHashKey: null,
		statistics: {
			active24HoursPercentage: 0,
			active30DaysPercentage: 0,
			has24HourStats: false,
			has30DayStats: false,
			overLoaded24HoursPercentage: 0,
			overLoaded30DaysPercentage: 0,
			validating24HoursPercentage: 0,
			validating30DaysPercentage: 0
		},
		stellarCoreVersionBehind: false,
		versionStr: null,
		...overrides
	};
}

function createNetwork(nodes: NodeV1[]): NetworkV1 {
	return {
		id: 'public',
		latestLedger: '63380000',
		name: 'Public network',
		nodes,
		organizations: [],
		passPhrase: 'Public Global Stellar Network ; September 2015',
		scc: [],
		statistics: {
			hasQuorumIntersection: true,
			hasSymmetricTopTier: true,
			hasTransitiveQuorumSet: true,
			minBlockingSetCountryFilteredSize: 1,
			minBlockingSetCountrySize: 1,
			minBlockingSetFilteredSize: 1,
			minBlockingSetISPFilteredSize: 1,
			minBlockingSetISPSize: 1,
			minBlockingSetOrgsFilteredSize: 1,
			minBlockingSetOrgsSize: 1,
			minBlockingSetSize: 1,
			minSplittingSetCountrySize: 1,
			minSplittingSetISPSize: 1,
			minSplittingSetOrgsSize: 1,
			minSplittingSetSize: 1,
			nrOfActiveFullValidators: 0,
			nrOfActiveOrganizations: 0,
			nrOfActiveValidators: 0,
			nrOfActiveWatchers: 0,
			nrOfConnectableNodes: 0,
			time: '2026-07-13T00:00:00.000Z',
			topTierOrgsSize: 0,
			topTierSize: 0,
			transitiveQuorumSetSize: 0
		},
		time: '2026-07-13T00:00:00.000Z',
		transitiveQuorumSet: []
	};
}
