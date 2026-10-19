import { ExplorerLink as Link } from './explorer-investigation';
import {
	buildEntityHref,
	entityText,
	type EntityRecord,
	type ExplorerFilters
} from '../../api/explorer-analytics';
import { decodeContractEventValue } from '../../domain/contract-event-value';
import { flattenContractEventValue } from '../../domain/contract-event-fields';
import { ScalarValue } from './explorer-contract-event-table';
import { operationInvocation } from './explorer-operation-invocation';
import styles from './explorer-entity.module.css';

export function ExplorerOperationCall({
	row,
	filters
}: {
	readonly row: EntityRecord;
	readonly filters: ExplorerFilters;
}): React.JSX.Element | null {
	const invocation = operationInvocation(row);
	if (!invocation) return null;
	return (
		<div className={styles.invocation}>
			<strong>
				<code>{invocation.functionName}</code>
			</strong>
			<Link
				className={styles.hash}
				href={buildEntityHref('contracts', invocation.contractId, filters)}
			>
				{invocation.contractId}
			</Link>
			<details>
				<summary>
					{invocation.arguments.length}{' '}
					{invocation.arguments.length === 1 ? 'argument' : 'arguments'}
				</summary>
				<dl className={styles.argumentFields}>
					{invocation.arguments.flatMap((argument, index) => {
						const { fields, truncated } = flattenContractEventValue(
							decodeContractEventValue(argument),
							64
						);
						return (
							<div key={index}>
								<dt>Argument {index + 1}</dt>
								<dd>
									{fields.map((field, fieldIndex) => (
										<div key={fieldIndex}>
											{fields.length > 1 && (
												<span className={styles.muted}>{field.path}: </span>
											)}
											<ScalarValue value={field.value} field={field.path} />
										</div>
									))}
									{truncated && (
										<span className={styles.muted}>
											Additional fields in the API response.
										</span>
									)}
								</dd>
							</div>
						);
					})}
				</dl>
			</details>
			{entityText(row, 'transactionHash') && (
				<Link
					href={buildEntityHref(
						'transactions',
						entityText(row, 'transactionHash'),
						{ ledger_sequence: entityText(row, 'ledgerSequence') }
					)}
				>
					Transaction result →
				</Link>
			)}
		</div>
	);
}
