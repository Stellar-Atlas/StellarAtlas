'use client';

import { useState } from 'react';
import type { PublicExplorerOperationFilters } from '@api/types';
import {
	lookupExplorerContract,
	searchExplorerAssets,
	searchExplorerOperations
} from '../../app/actions/network-data';
import { stellarOperationTypes } from '../../domain/stellar-operation-types';
import {
	AssetsView,
	ContractView,
	OperationsView,
	toDateInputValue
} from './blockchain-explorer-results';
import {
	initialExplorerAssets,
	initialExplorerContract,
	initialExplorerOperations
} from './blockchain-explorer-state';
import {
	ExplorerIndexUnavailable,
	ExplorerInput,
	ExplorerRequestNotice
} from './explorer-browse-ui';
import { useExplorerRequest } from './use-explorer-request';

interface BrowsePanelProps {
	readonly ready: boolean;
	readonly checking: boolean;
	readonly onCheck: () => void;
}

export function ExplorerOperationsPanel({
	ready,
	checking,
	onCheck
}: BrowsePanelProps): React.JSX.Element {
	const [filters, setFilters] = useState<PublicExplorerOperationFilters>({});
	const request = useExplorerRequest(
		initialExplorerOperations,
		'Operation search could not be completed.'
	);
	const updateFilter = (
		key: keyof PublicExplorerOperationFilters,
		value: string
	): void => {
		setFilters((current) => ({ ...current, [key]: value || undefined }));
	};
	return (
		<section
			className="explorer-panel"
			aria-label="Browse operations"
			aria-busy={request.loading}
		>
			<div className="panel-heading">
				<div>
					<h2>Operations</h2>
					<span>Filter the available operation index</span>
				</div>
			</div>
			{ready ? (
				<form
					className="explorer-filter-form"
					onSubmit={(event) => {
						event.preventDefault();
						void request.run(() => searchExplorerOperations(filters));
					}}
				>
					<ExplorerInput
						label="Ledger"
						value={filters.ledger ?? ''}
						onChange={(value) => updateFilter('ledger', value)}
					/>
					<ExplorerInput
						label="Address"
						value={filters.accountId ?? ''}
						onChange={(value) => updateFilter('accountId', value)}
					/>
					<label>
						<span>Type</span>
						<select
							value={filters.operationType ?? ''}
							onChange={(event) =>
								updateFilter('operationType', event.currentTarget.value)
							}
						>
							{stellarOperationTypes.map((type) => (
								<option key={type || 'all'} value={type}>
									{type || 'All types'}
								</option>
							))}
						</select>
					</label>
					<ExplorerInput
						label="From"
						type="datetime-local"
						value={toDateInputValue(filters.from)}
						onChange={(value) => updateFilter('from', toValidIso(value))}
					/>
					<ExplorerInput
						label="To"
						type="datetime-local"
						value={toDateInputValue(filters.to)}
						onChange={(value) => updateFilter('to', toValidIso(value))}
					/>
					<button disabled={request.loading} type="submit">
						{request.loading ? 'Loading' : 'Find operations'}
					</button>
				</form>
			) : (
				<ExplorerIndexUnavailable
					label="Operation"
					loading={checking}
					onRetry={onCheck}
				/>
			)}
			<ExplorerRequestNotice
				error={request.error}
				loading={request.loading}
				onRetry={request.retry}
			/>
			<OperationsView result={request.result} />
		</section>
	);
}

export function ExplorerAssetsPanel({
	ready,
	checking,
	onCheck
}: BrowsePanelProps): React.JSX.Element {
	const [code, setCode] = useState('');
	const [issuer, setIssuer] = useState('');
	const request = useExplorerRequest(
		initialExplorerAssets,
		'Asset search could not be completed.'
	);
	return (
		<section
			className="explorer-panel"
			aria-label="Browse assets"
			aria-busy={request.loading}
		>
			<div className="panel-heading">
				<div>
					<h2>Assets</h2>
					<span>Find an asset by code and issuer</span>
				</div>
			</div>
			{ready ? (
				<form
					className="explorer-filter-form"
					onSubmit={(event) => {
						event.preventDefault();
						void request.run(() => searchExplorerAssets(code, issuer));
					}}
				>
					<ExplorerInput label="Asset code" value={code} onChange={setCode} />
					<ExplorerInput label="Issuer" value={issuer} onChange={setIssuer} />
					<button disabled={request.loading} type="submit">
						{request.loading ? 'Searching' : 'Find assets'}
					</button>
				</form>
			) : (
				<ExplorerIndexUnavailable
					label="Asset"
					loading={checking}
					onRetry={onCheck}
				/>
			)}
			<ExplorerRequestNotice
				error={request.error}
				loading={request.loading}
				onRetry={request.retry}
			/>
			<AssetsView result={request.result} />
		</section>
	);
}

export function ExplorerContractsPanel({
	ready,
	checking,
	onCheck
}: BrowsePanelProps): React.JSX.Element {
	const [contractId, setContractId] = useState('');
	const request = useExplorerRequest(
		initialExplorerContract,
		'Contract lookup could not be completed.'
	);
	return (
		<section
			className="explorer-panel"
			aria-label="Browse contracts"
			aria-busy={request.loading}
		>
			<div className="panel-heading">
				<div>
					<h2>Contracts</h2>
					<span>
						Look up a Soroban contract; readiness is reported with the result
					</span>
				</div>
			</div>
			{ready ? (
				<form
					className="explorer-filter-form"
					onSubmit={(event) => {
						event.preventDefault();
						void request.run(() => lookupExplorerContract(contractId));
					}}
				>
					<ExplorerInput
						label="Contract ID"
						value={contractId}
						onChange={setContractId}
					/>
					<button
						disabled={request.loading || !contractId.trim()}
						type="submit"
					>
						{request.loading ? 'Checking' : 'Look up contract'}
					</button>
				</form>
			) : (
				<ExplorerIndexUnavailable
					label="Contract"
					loading={checking}
					onRetry={onCheck}
				/>
			)}
			<ExplorerRequestNotice
				error={request.error}
				loading={request.loading}
				onRetry={request.retry}
			/>
			<ContractView result={request.result} />
		</section>
	);
}

function toValidIso(value: string): string {
	if (!value) return '';
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}
