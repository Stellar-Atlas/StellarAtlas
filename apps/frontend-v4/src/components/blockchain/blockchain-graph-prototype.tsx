'use client';

import { useCallback, useEffect, useState } from 'react';
import {
	fetchBrowserLatestLedger,
	fetchBrowserLedgerTransactions
} from '@api/browser-client';
import type { PublicLedgerTransactions, PublicLatestLedger } from '@api/types';
import { StatCard } from '@components/stat-card';
import {
	buildBlockchainGraphModel,
	type BlockchainGraphModel,
	type BlockchainGraphNode
} from './blockchain-graph-model';

const nodeRadius = 4.8;

interface ExplorerGraphState {
	readonly latestLedger: PublicLatestLedger | null;
	readonly message: string | null;
	readonly transactions: PublicLedgerTransactions | null;
	readonly status: 'error' | 'loaded' | 'loading';
}

export function BlockchainGraphPrototype(): React.JSX.Element {
	const [state, setState] = useState<ExplorerGraphState>({
		latestLedger: null,
		message: null,
		status: 'loading',
		transactions: null
	});
	const loadGraph = useCallback((signal: AbortSignal): void => {
		setState({
			latestLedger: null,
			message: null,
			status: 'loading',
			transactions: null
		});
		void fetchBrowserLatestLedger(signal)
			.then(async (latestLedger) => {
				const transactions = await fetchBrowserLedgerTransactions(
					latestLedger.sequence,
					signal
				);
				setState({
					latestLedger,
					message: transactions.truncated
						? `Showing ${transactions.records.length} returned transactions.`
						: null,
					status: 'loaded',
					transactions
				});
			})
			.catch((error: Error) => {
				if (signal.aborted) return;
				setState({
					latestLedger: null,
					message: error.message,
					status: 'error',
					transactions: null
				});
			});
	}, []);

	useEffect(() => {
		const abortController = new AbortController();
		loadGraph(abortController.signal);
		return () => abortController.abort();
	}, [loadGraph]);

	const model =
		state.latestLedger && state.transactions
			? buildBlockchainGraphModel(state.latestLedger, state.transactions)
			: null;

	return (
		<div className="blockchain-explorer">
			<div className="stats-grid blockchain-stats">
				<StatCard
					detail="Latest Horizon ledger"
					label="Ledger"
					value={state.latestLedger?.sequence ?? '...'}
				/>
				<StatCard
					detail="Returned for this ledger"
					label="Transactions"
					value={state.transactions?.records.length.toString() ?? '...'}
				/>
				<StatCard
					detail="Unique source accounts"
					label="Accounts"
					value={model ? getAccountCount(model).toString() : '...'}
				/>
				<StatCard detail="One-ledger fetch" label="Source" value="API" />
			</div>

			<section className="blockchain-graph-shell">
				<div className="blockchain-graph-stage">
					{state.status === 'loading' && (
						<div className="blockchain-graph-state">Loading latest ledger</div>
					)}
					{state.status === 'error' && (
						<div className="blockchain-graph-state danger">
							<span>{state.message ?? 'Explorer graph unavailable'}</span>
							<button
								onClick={() => {
									const abortController = new AbortController();
									loadGraph(abortController.signal);
								}}
								type="button"
							>
								Retry
							</button>
						</div>
					)}
					{state.status === 'loaded' && model && (
						<BlockchainGraphSvg model={model} />
					)}
				</div>

				<aside className="blockchain-inspector">
					<div className="panel-heading">
						<div>
							<strong>Ledger Graph</strong>
							<span>{state.message ?? 'Latest fetched ledger'}</span>
						</div>
					</div>
					<div className="status-list">
						{model?.metrics.map((metric) => (
							<div className="status-row" key={metric.label}>
								<div>
									<strong>{metric.label}</strong>
									<small>{metric.value}</small>
								</div>
							</div>
						))}
						{state.status === 'error' && (
							<div className="status-row">
								<div>
									<strong>Unavailable</strong>
									<small>{state.message}</small>
								</div>
							</div>
						)}
					</div>
				</aside>
			</section>
		</div>
	);
}

function BlockchainGraphSvg({
	model
}: {
	readonly model: BlockchainGraphModel;
}): React.JSX.Element {
	const nodesById = new Map(model.nodes.map((node) => [node.id, node]));

	if (model.records.length === 0) {
		return (
			<div className="blockchain-graph-state">No transactions returned</div>
		);
	}

	return (
		<svg
			aria-label="Blockchain explorer graph prototype"
			className="blockchain-graph-svg"
			role="img"
			viewBox="0 0 100 76"
		>
			<defs>
				<marker
					id="blockchain-edge-arrow"
					markerHeight="4"
					markerWidth="4"
					orient="auto"
					refX="3.2"
					refY="2"
				>
					<path d="M0,0 L4,2 L0,4 Z" />
				</marker>
			</defs>
			{model.edges.map((edge) => {
				const source = nodesById.get(edge.source);
				const target = nodesById.get(edge.target);
				if (!source || !target) return null;
				return (
					<g className={`blockchain-edge ${edge.tone}`} key={edge.id}>
						<title>{edge.label}</title>
						<path d={getEdgePath(source, target)} />
						<text x={(source.x + target.x) / 2} y={(source.y + target.y) / 2}>
							{edge.label}
						</text>
					</g>
				);
			})}
			{model.nodes.map((node) => (
				<g
					className={`blockchain-node ${node.tone} ${node.type}`}
					key={node.id}
					transform={`translate(${node.x} ${node.y})`}
				>
					<title>{`${node.label}: ${node.detail}`}</title>
					<circle
						r={node.type === 'ledger' ? nodeRadius + 5 : nodeRadius + 2.8}
					/>
					<circle
						className="node-core"
						r={node.type === 'ledger' ? nodeRadius + 1.8 : nodeRadius}
					/>
					<text className="node-label" y="0.8">
						{node.label}
					</text>
				</g>
			))}
		</svg>
	);
}

function getAccountCount(model: BlockchainGraphModel): number {
	return model.nodes.filter((node) => node.type === 'account').length;
}

function getEdgePath(
	source: BlockchainGraphNode,
	target: BlockchainGraphNode
): string {
	const midX = (source.x + target.x) / 2;
	const midY = (source.y + target.y) / 2 - 8;
	return `M ${source.x} ${source.y} Q ${midX} ${midY} ${target.x} ${target.y}`;
}
