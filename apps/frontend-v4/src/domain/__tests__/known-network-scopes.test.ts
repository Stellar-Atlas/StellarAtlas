/// <reference types="jest" />

import type {
	PublicKnownNodeListItem,
	PublicKnownOrganizationListItem
} from '../../api/known-network-types';
import {
	defaultNodeInventoryFilter,
	defaultOrganizationInventoryFilter,
	matchesNodeInventoryFilter,
	matchesOrganizationInventoryFilter,
	nodeInventoryFilterLabels
} from '../known-network-scopes';

describe('known network scopes', () => {
	it('defaults to current validators and current organizations', () => {
		expect(defaultNodeInventoryFilter).toBe('current-validator');
		expect(defaultOrganizationInventoryFilter).toBe('current');
		expect(nodeInventoryFilterLabels['public-key-only']).toBe(
			'Public-key only'
		);
	});

	it('uses canonical record scopes rather than inferring archived state', () => {
		const knownNode: PublicKnownNodeListItem = {
			current: false,
			dateDiscovered: '2026-07-01T00:00:00.000Z',
			lastMeasurementAt: null,
			lastSeen: '2026-07-10T00:00:00.000Z',
			metadataState: 'public_key_only',
			node: null,
			publicKey: 'GA_SCOPE_TEST',
			scope: 'archived',
			snapshotEndDate: '2026-07-10T00:00:00.000Z',
			snapshotStartDate: null
		};

		expect(matchesNodeInventoryFilter(knownNode, 'archived')).toBe(true);
		expect(matchesNodeInventoryFilter(knownNode, 'current-validator')).toBe(
			false
		);
		expect(matchesNodeInventoryFilter(knownNode, 'all-known')).toBe(true);
	});

	it('filters organizations by explicit current/archive state', () => {
		const knownOrganization = {
			scope: 'archived'
		} as PublicKnownOrganizationListItem;
		expect(
			matchesOrganizationInventoryFilter(knownOrganization, 'archived')
		).toBe(true);
		expect(
			matchesOrganizationInventoryFilter(knownOrganization, 'current')
		).toBe(false);
	});
});
