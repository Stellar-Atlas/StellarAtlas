import { ExplorerLink as Link } from './explorer-investigation';
import {
	entityText,
	normalizeWarehouseTimestamp,
	type EntityRecord,
	buildEntityHref
} from '../../api/explorer-analytics';
import {
	decodeContractEventValue,
	type ContractEventValue
} from '../../domain/contract-event-value';
import { flattenContractEventValue } from '../../domain/contract-event-fields';
import { LocalDateTime } from '../local-date-time';
import styles from './explorer-contract-state-change-table.module.css';

function labelText(value: string): string {
	const spaced = value.replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function scalarText(value: ContractEventValue): string {
	if (value.kind === 'typed') return scalarText(value.value);
	if (value.kind === 'string' || value.kind === 'number') return value.value;
	if (value.kind === 'boolean') return String(value.value);
	if (value.kind === 'null') return 'null';
	if (value.kind === 'void') return 'No value';
	if (value.kind === 'bytes')
		return value.text ?? `Binary payload · ${value.hex.length / 2} bytes`;
	if (value.kind === 'raw')
		return value.text === 'void' ? 'No value' : value.text;
	if (value.kind === 'object')
		return value.entries.length ? 'Structured key' : 'Empty map';
	return value.items.length ? 'Structured key' : 'Empty list';
}

function StateKey({
	value,
	ledger
}: {
	readonly value: ContractEventValue;
	readonly ledger: string;
}): React.JSX.Element {
	const { fields, truncated } = flattenContractEventValue(value);
	return (
		<>
			<span className={styles.keyParts}>
				{fields.map((field, index) => {
					const text = scalarText(field.value);
					const label =
						field.type === 'symbol' && text.length > 0
							? text.charAt(0).toUpperCase() + text.slice(1)
							: text;
					const href = valueHref(text, field.path, ledger);
					return (
						<span key={`${field.path}:${index}`}>
							{index > 0 && ' / '}
							{href ? (
								<Link className={styles.reference} href={href}>
									{label}
								</Link>
							) : (
								label
							)}
						</span>
					);
				})}
			</span>
			{truncated && (
				<span className={styles.warning}>Key omitted after field limit</span>
			)}
		</>
	);
}

function valueHref(text: string, field: string, ledger: string): string | null {
	const window: Readonly<Record<string, string>> = ledger
		? { min_ledger: ledger, max_ledger: ledger }
		: {};
	if (/^G[A-Z2-7]{55}$/.test(text)) return buildEntityHref('accounts', text);
	if (/^C[A-Z2-7]{55}$/.test(text))
		return buildEntityHref('contracts', text, window);
	if (
		/^(ledger|ledger_sequence|ledgerSequence)$/.test(field) &&
		/^\d{1,10}$/.test(text)
	)
		return buildEntityHref('ledgers', text);
	if (
		/^(transaction_hash|transactionHash|tx_hash)$/.test(field) &&
		/^[a-fA-F0-9]{64}$/.test(text)
	)
		return buildEntityHref(
			'transactions',
			text,
			ledger ? { ledger_sequence: ledger } : {}
		);
	return null;
}

function LeafValue({
	value,
	field,
	ledger
}: {
	readonly value: ContractEventValue;
	readonly field: string;
	readonly ledger: string;
}): React.JSX.Element {
	if (value.kind === 'typed')
		return <LeafValue value={value.value} field={field} ledger={ledger} />;
	if (value.kind === 'object')
		return (
			<span className={styles.muted}>
				{value.entries.length ? 'Structured value' : 'Empty map'}
			</span>
		);
	if (value.kind === 'array')
		return (
			<span className={styles.muted}>
				{value.items.length ? 'Structured value' : 'Empty list'}
			</span>
		);
	if (value.kind === 'void')
		return <span className={styles.muted}>No value</span>;
	if (value.kind === 'null') return <span className={styles.muted}>null</span>;
	if (value.kind === 'bytes')
		return (
			<span className={styles.text}>
				{value.text ?? `Binary payload · ${value.hex.length / 2} bytes`}
			</span>
		);
	if (value.kind === 'raw')
		return value.text === 'void' ? (
			<span className={styles.muted}>No value</span>
		) : (
			<span className={styles.text}>{value.text}</span>
		);
	const text = String(value.value);
	const href = valueHref(text, field, ledger);
	return href ? (
		<Link className={styles.reference} href={href}>
			<code>{text}</code>
		</Link>
	) : (
		<code className={value.kind === 'number' ? styles.number : styles.text}>
			{text}
		</code>
	);
}

function StateValue({
	value,
	ledger
}: {
	readonly value: ContractEventValue;
	readonly ledger: string;
}): React.JSX.Element {
	if (value.kind === 'typed')
		return <StateValue value={value.value} ledger={ledger} />;
	if (value.kind === 'object' && value.entries.length === 0)
		return <span className={styles.muted}>Empty map</span>;
	if (value.kind === 'array' && value.items.length === 0)
		return <span className={styles.muted}>Empty list</span>;
	const { fields, truncated } = flattenContractEventValue(value);
	const groups = new Map<string, typeof fields>();
	const plain: (typeof fields)[number][] = [];
	for (const field of fields) {
		const match = /^(.*)\[(\d+)\]\.([^.[\]]+)$/.exec(field.path);
		if (match && match[1] !== undefined)
			groups.set(match[1], [...(groups.get(match[1]) ?? []), field]);
		else plain.push(field);
	}
	return (
		<>
			{[...groups].map(([name, entries]) => {
				const records = new Map<string, Map<string, (typeof fields)[number]>>();
				const columns = new Set<string>();
				for (const entry of entries) {
					const match = /\[(\d+)\]\.([^.[\]]+)$/.exec(entry.path);
					if (!match || match[1] === undefined || match[2] === undefined)
						continue;
					columns.add(match[2]);
					const record =
						records.get(match[1]) ?? new Map<string, (typeof fields)[number]>();
					record.set(match[2], entry);
					records.set(match[1], record);
				}
				return (
					<div className={styles.valueGroup} key={name}>
						<strong>
							{labelText(name)}{' '}
							<span className={styles.muted}>
								· {records.size} {records.size === 1 ? 'record' : 'records'}
							</span>
						</strong>
						<div className={styles.valueScroll}>
							<table className={styles.valueTable} aria-label={labelText(name)}>
								<thead>
									<tr>
										<th scope="col">#</th>
										{[...columns].map((column) => (
											<th scope="col" key={column}>
												{labelText(column)}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{[...records].map(([index, record]) => (
										<tr key={index}>
											<td className={styles.muted}>{index}</td>
											{[...columns].map((column) => {
												const field = record.get(column);
												return (
													<td
														key={column}
														title={
															field
																? `${field.path} · ${field.type}`
																: undefined
														}
													>
														{field ? (
															<LeafValue
																value={field.value}
																field={column}
																ledger={ledger}
															/>
														) : (
															'—'
														)}
													</td>
												);
											})}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				);
			})}
			<dl className={styles.fields}>
				{plain.map((field) => {
					const separator = field.path.lastIndexOf('.');
					const group = separator < 0 ? '' : field.path.slice(0, separator);
					const name =
						separator < 0 ? field.path : field.path.slice(separator + 1);
					return (
						<div className={styles.field} key={`${field.path}:${field.type}`}>
							<dt title={`${field.path} · ${field.type}`}>
								{group
									? `${labelText(group)} · ${labelText(name)}`
									: labelText(name)}
							</dt>
							<dd>
								<LeafValue value={field.value} field={name} ledger={ledger} />
							</dd>
						</div>
					);
				})}
			</dl>
			{truncated && (
				<p className={styles.warning}>
					Large value: showing the first 256 fields. Full record is available
					below.
				</p>
			)}
		</>
	);
}

export function ExplorerContractStateChangeTable({
	rows
}: {
	readonly rows: readonly EntityRecord[];
}): React.JSX.Element {
	const hasTransactions = rows.some(
		(row) => entityText(row, 'transaction_hash') !== ''
	);
	return (
		<div className={styles.scroll}>
			<table
				className={styles.table}
				data-transactions={hasTransactions}
				aria-label="Contract state changes"
			>
				<thead>
					<tr>
						<th scope="col">Ledger / time</th>
						<th scope="col">Key</th>
						<th scope="col">Value</th>
						<th scope="col">{hasTransactions ? 'Transaction' : 'Record'}</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row, index) => {
						const ledger =
							entityText(row, 'ledger_sequence') ||
							entityText(row, '_ledger_sequence');
						const transaction = entityText(row, 'transaction_hash');
						const timestamp = entityText(row, 'closed_at');
						const key = decodeContractEventValue(row.key_decoded ?? row.key);
						const value = decodeContractEventValue(
							row.val_decoded ?? row.val ?? row.value
						);
						return (
							<tr key={entityText(row, 'id') || `${ledger}:${index}`}>
								<td>
									<strong>
										{ledger ? (
											<Link
												className={styles.reference}
												href={buildEntityHref('ledgers', ledger)}
											>
												{ledger}
											</Link>
										) : (
											'Not reported'
										)}
									</strong>
									{timestamp && (
										<LocalDateTime
											dateTime={normalizeWarehouseTimestamp(timestamp)}
										/>
									)}
								</td>
								<td>
									<StateKey value={key} ledger={ledger} />
								</td>
								<td>
									<StateValue value={value} ledger={ledger} />
								</td>
								<td>
									{transaction && (
										<Link
											className={styles.reference}
											href={buildEntityHref(
												'transactions',
												transaction,
												ledger ? { ledger_sequence: ledger } : {}
											)}
										>
											<code>{transaction}</code>
										</Link>
									)}
									<details className={styles.raw}>
										<summary>View raw</summary>
										<pre>{JSON.stringify(row, null, 2)}</pre>
									</details>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
