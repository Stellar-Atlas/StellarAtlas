import type { PublicExplorerOperation } from '@api/types';
import {
	formatDate,
	formatExplorerSource,
	formatTransactionHash
} from './blockchain-explorer-format';

export function ExplorerOperationTable({
	operations
}: {
	readonly operations: readonly PublicExplorerOperation[];
}): React.JSX.Element {
	if (operations.length === 0) {
		return <p className="explorer-state neutral">No operations returned.</p>;
	}

	return (
		<div className="explorer-table operations">
			{operations.slice(0, 50).map((operation) => {
				const outcome = formatOperationOutcome(operation);
				const participants = formatOperationParticipants(operation);
				return (
					<div className="explorer-table-row" key={operation.id}>
						<strong>{operation.type}</strong>
						<span
							className={`operation-outcome ${outcome.tone}`}
							title={outcome.detail}
						>
							{outcome.label}
						</span>
						<span className="operation-cell">
							{formatDate(operation.createdAt)}
							<small>{operation.ledger ?? 'ledger unknown'}</small>
						</span>
						<span
							className="operation-cell"
							title={participants?.detail}
						>
							{operation.sourceAccount ?? 'source unknown'}
							{participants ? <small>{participants.label}</small> : null}
						</span>
						<span
							className="operation-cell"
							title={operation.transactionHash ?? undefined}
						>
							{operation.transactionHash === null
								? 'transaction unknown'
								: formatTransactionHash(operation.transactionHash)}
							<small>{formatExplorerSource(operation.source)}</small>
						</span>
					</div>
				);
			})}
		</div>
	);
}

interface OperationParticipantLabel {
	readonly detail: string;
	readonly label: string;
}

function formatOperationParticipants(
	operation: PublicExplorerOperation
): OperationParticipantLabel | null {
	if (operation.source === 'horizon') return null;
	if (operation.evidence.accountReferenceDecoderVersion === null) {
		return {
			detail: 'Envelope account participants have not been indexed for this batch',
			label: 'Participants not indexed'
		};
	}

	const references = operation.accountReferences;
	const additional = references.filter(
		(reference) =>
			reference.role !== 'effective_source' ||
			reference.accountId !== operation.sourceAccount
	);
	const detail = references
		.map(
			(reference) =>
				`${formatParticipantRole(reference.role)}: ${reference.accountId}`
		)
		.join('\n');
	const first = additional[0];
	if (first === undefined) {
		return {
			detail,
			label: `${references.length} indexed account ${references.length === 1 ? 'reference' : 'references'}`
		};
	}
	const remainder = additional.length - 1;
	return {
		detail,
		label: `${formatParticipantRole(first.role)} ${formatTransactionHash(first.accountId)}${remainder === 0 ? '' : ` +${remainder}`}`
	};
}

function formatParticipantRole(role: string): string {
	return role.replaceAll('_', ' ');
}

interface OperationOutcomeLabel {
	readonly detail: string;
	readonly label: string;
	readonly tone: 'failed' | 'neutral' | 'succeeded';
}

export function formatOperationOutcome(
	operation: PublicExplorerOperation
): OperationOutcomeLabel {
	if (operation.source === 'horizon') {
		if (operation.successful === true) {
			return {
				detail: 'Reported successful by Horizon',
				label: 'Succeeded',
				tone: 'succeeded'
			};
		}
		if (operation.successful === false) {
			return {
				detail: 'Reported failed by Horizon',
				label: 'Failed',
				tone: 'failed'
			};
		}
		return {
			detail: 'Horizon did not provide an operation outcome',
			label: 'Unknown',
			tone: 'neutral'
		};
	}

	if (!operation.outcomeAvailable) {
		return {
			detail: 'Transaction result XDR has not been indexed for this batch',
			label: 'Not indexed',
			tone: 'neutral'
		};
	}

	const resultCode = operation.operationResultCode ?? 'none';
	const specificCode = operation.operationSpecificResultCode ?? 'none';
	return {
		detail: `Transaction result XDR; decoder ${operation.outcomeEvidence.decoderVersion}; result code ${resultCode}; operation-specific code ${specificCode}`,
		label:
			operation.outcome === 'not_applied'
				? 'Not applied'
				: operation.outcome === 'succeeded'
					? 'Succeeded'
					: 'Failed',
		tone: operation.outcome === 'succeeded' ? 'succeeded' : 'failed'
	};
}
