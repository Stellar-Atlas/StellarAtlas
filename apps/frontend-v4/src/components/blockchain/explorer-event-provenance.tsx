import {
	entityText,
	recordValue,
	type EntityRecord
} from '../../api/explorer-analytics';
import styles from './explorer-entity.module.css';
export function ExplorerEventProvenance({
	row
}: {
	readonly row: EntityRecord;
}): React.JSX.Element {
	const classification = recordValue(row.classification);
	const kind = entityText(classification, 'eventKind');
	const names: Readonly<Record<string, string>> = {
		diagnostic: 'Diagnostic event',
		contract: 'Contract event',
		system: 'System event',
		fee: 'Fee event',
		classic: 'Classic event'
	};
	const transactionKind = entityText(classification, 'transactionKind');
	const execution = classification.sorobanExecutionEvidence === true;
	return (
		<div className={styles.status} aria-label="Event provenance">
			<span>
				{names[kind] ??
					(kind ? kind.replaceAll('_', ' ') : 'Unclassified event')}
			</span>
			<span>
				{transactionKind === 'soroban'
					? 'Soroban transaction'
					: transactionKind === 'classic'
						? 'Classic transaction'
						: 'Transaction kind unknown'}
			</span>
			<span>
				{execution
					? 'Soroban execution evidence present'
					: 'No confirmed Soroban execution evidence'}
			</span>
			{classification.provenance !== 'complete' && (
				<span>Incomplete event provenance</span>
			)}
		</div>
	);
}
