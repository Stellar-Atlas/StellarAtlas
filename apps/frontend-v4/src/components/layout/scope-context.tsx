import type {
	PublicKnownNodeRecordScope,
	PublicKnownNodeScope,
	PublicKnownOrganizationRecordScope,
	PublicKnownOrganizationScope,
	PublicNetwork
} from '../../api/types';
import {
	currentValidatingNetworkScopeLabel,
	nodeInventoryFilterLabels,
	nodeRecordScopeLabels,
	organizationInventoryFilterLabels,
	organizationRecordScopeLabels
} from '../../domain/known-network-scopes';

export type ScopeContextProps =
	| {
			readonly kind: 'network';
			readonly scope: PublicNetwork['scope'];
	  }
	| {
			readonly kind: 'quorum';
			readonly scope: PublicNetwork['scope'];
	  }
	| {
			readonly kind: 'node-inventory';
			readonly scope: PublicKnownNodeScope;
	  }
	| {
			readonly kind: 'organization-inventory';
			readonly scope: PublicKnownOrganizationScope;
	  }
	| {
			readonly kind: 'node-record';
			readonly scope: PublicKnownNodeRecordScope;
	  }
	| {
			readonly kind: 'organization-record';
			readonly scope: PublicKnownOrganizationRecordScope;
	  };

interface ScopeDataAttributes {
	readonly 'data-inventory-kind'?: 'nodes' | 'organizations';
	readonly 'data-inventory-scope'?: string;
	readonly 'data-network-scope'?: PublicNetwork['scope'];
	readonly 'data-record-kind'?: 'node' | 'organization';
	readonly 'data-record-scope'?: string;
	readonly 'data-scope': string;
	readonly 'data-scope-kind': ScopeContextProps['kind'];
}

interface ResolvedScopeContext {
	readonly attributes: ScopeDataAttributes;
	readonly primaryLabel: string;
	readonly primaryPrefix: string;
	readonly primaryScope: string;
	readonly recordLabel?: string;
	readonly recordScope?: string;
}

export function ScopeContext(props: ScopeContextProps): React.JSX.Element {
	const context = resolveScopeContext(props);

	return (
		<p className="scope-context" {...context.attributes}>
			<span>{context.primaryPrefix}:</span>
			<data value={context.primaryScope}>{context.primaryLabel}</data>
			{context.recordScope && context.recordLabel ? (
				<>
					<span aria-hidden="true" className="scope-context-separator">
						&middot;
					</span>
					<span>Record scope:</span>
					<data value={context.recordScope}>{context.recordLabel}</data>
				</>
			) : null}
		</p>
	);
}

export function getScopeContextDataAttributes(
	props: ScopeContextProps
): ScopeDataAttributes {
	return resolveScopeContext(props).attributes;
}

function resolveScopeContext(props: ScopeContextProps): ResolvedScopeContext {
	if (props.kind === 'network' || props.kind === 'quorum') {
		return {
			attributes: {
				'data-network-scope': props.scope,
				'data-scope': props.scope,
				'data-scope-kind': props.kind
			},
			primaryLabel: currentValidatingNetworkScopeLabel,
			primaryPrefix: props.kind === 'quorum' ? 'Quorum scope' : 'Network scope',
			primaryScope: props.scope
		};
	}

	if (props.kind === 'node-inventory') {
		return inventoryContext(
			'nodes',
			props,
			nodeInventoryFilterLabels[props.scope]
		);
	}

	if (props.kind === 'organization-inventory') {
		return inventoryContext(
			'organizations',
			props,
			organizationInventoryFilterLabels[props.scope]
		);
	}

	if (props.kind === 'node-record') {
		return recordContext(
			'node',
			'nodes',
			props,
			nodeRecordScopeLabels[props.scope]
		);
	}

	return recordContext(
		'organization',
		'organizations',
		props,
		organizationRecordScopeLabels[props.scope]
	);
}

function inventoryContext(
	inventoryKind: 'nodes' | 'organizations',
	props: Extract<
		ScopeContextProps,
		{ readonly kind: 'node-inventory' | 'organization-inventory' }
	>,
	label: string
): ResolvedScopeContext {
	return {
		attributes: {
			'data-inventory-kind': inventoryKind,
			'data-inventory-scope': props.scope,
			'data-scope': props.scope,
			'data-scope-kind': props.kind
		},
		primaryLabel: label,
		primaryPrefix: 'Inventory scope',
		primaryScope: props.scope
	};
}

function recordContext(
	recordKind: 'node' | 'organization',
	inventoryKind: 'nodes' | 'organizations',
	props: Extract<
		ScopeContextProps,
		{ readonly kind: 'node-record' | 'organization-record' }
	>,
	recordLabel: string
): ResolvedScopeContext {
	return {
		attributes: {
			'data-inventory-kind': inventoryKind,
			'data-inventory-scope': 'all-known',
			'data-record-kind': recordKind,
			'data-record-scope': props.scope,
			'data-scope': props.scope,
			'data-scope-kind': props.kind
		},
		primaryLabel: 'All known',
		primaryPrefix: 'Inventory scope',
		primaryScope: 'all-known',
		recordLabel,
		recordScope: props.scope
	};
}
