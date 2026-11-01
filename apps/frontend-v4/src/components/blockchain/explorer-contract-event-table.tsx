'use client';

import { useEffect, useRef, useState } from 'react';
import { ExplorerLink as Link } from './explorer-investigation';
import { LocalDateTime } from '../local-date-time';
import {
	buildEntityHref,
	entityText,
	normalizeWarehouseTimestamp,
	recordValue,
	type EntityRecord
} from '../../api/explorer-analytics';
import {
	decodeContractEventValue,
	type ContractEventValue
} from '../../domain/contract-event-value';
import { flattenContractEventValue } from '../../domain/contract-event-fields';
import {
	contractEventText as valueText,
	contractEventOutcome,
	summarizeContractEvent
} from '../../domain/contract-event-summary';
import {
	formatAtomic,
	formatDecimal,
	timestampValue
} from './explorer-format-values';
import styles from './explorer-contract-event-table.module.css';

export interface EventTokenContext {
	readonly contractId: string;
	readonly assetId: string;
	readonly symbol: string;
	readonly decimals: number;
}

function eventTopics(row: EntityRecord): readonly ContractEventValue[] {
	const topics = decodeContractEventValue(row.topicsJson);
	return topics.kind === 'array' ? topics.items : [topics];
}

function payload(row: EntityRecord): ContractEventValue {
	const value = decodeContractEventValue(row.dataJson);
	return value.kind === 'bytes'
		? row.decodedBytes != null
			? decodeContractEventValue(row.decodedBytes)
			: (value.interpretation?.value ?? value)
		: value;
}

export function ExplorerContractEventTable({
	rows,
	token,
	showTransaction = true
}: {
	readonly rows: readonly EntityRecord[];
	readonly token?: EventTokenContext;
	readonly showTransaction?: boolean;
}): React.JSX.Element {
	const [selected, setSelected] = useState<EntityRecord | null>(null);
	return (
		<div className={styles.workspace}>
			<div className={styles.scroll}>
				<table
					className={`${styles.table} ${showTransaction ? '' : styles.transactionEvents}`}
					aria-label="Contract events"
				>
					<colgroup>
						<col className={styles.ledgerColumn} />
						<col className={styles.eventColumn} />
						<col className={styles.dataColumn} />
						{showTransaction && <col className={styles.txColumn} />}
						<col className={styles.detailsColumn} />
					</colgroup>
					<thead>
						<tr>
							<th>Ledger / time</th>
							<th>Event</th>
							<th>Data</th>
							{showTransaction && <th>Transaction</th>}
							<th>
								<span className={styles.srOnly}>Details</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row, index) => {
							const ledger = entityText(row, 'ledgerSequence');
							const tx = entityText(row, 'transactionHash');
							const kind =
								entityText(recordValue(row.classification), 'eventKind') ||
								'event';
							const topics = eventTopics(row);
							const summary = summarizeContractEvent(kind, topics);
							const outcome = contractEventOutcome(row.successful);
							return (
								<tr key={entityText(row, 'id') || index}>
									<td className={styles.ledgerCell}>
										<Link
											className={styles.reference}
											href={buildEntityHref('ledgers', ledger)}
										>
											{formatDecimal(ledger, 0)}
										</Link>
										<LocalDateTime
											dateTime={normalizeWarehouseTimestamp(
												entityText(row, 'closedAt')
											)}
										/>
									</td>
									<td>
										<div className={styles.eventName}>
											<strong title={summary.title}>{summary.title}</strong>
											<span title={outcome.label} aria-label={outcome.label}>
												{outcome.mark}
											</span>
										</div>
										<div
											className={`${styles.muted} ${styles.eventContext}`}
											title={summary.context}
										>
											{summary.context}
										</div>
									</td>
									<td>
										<PayloadPreview row={row} token={token} />
									</td>
									{showTransaction && (
										<td>
											<Link
												className={styles.transaction}
												href={buildEntityHref(
													'transactions',
													tx,
													ledger ? { ledger_sequence: ledger } : {}
												)}
											>
												<code>{tx}</code>
											</Link>
										</td>
									)}
									<td>
										<button
											type="button"
											aria-haspopup="dialog"
											onClick={() => setSelected(row)}
										>
											Details
										</button>
									</td>
								</tr>
							);
						})}
						{rows.length === 0 && (
							<tr>
								<td colSpan={showTransaction ? 5 : 4} className={styles.empty}>
									No events match these filters.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
			{selected && (
				<EventDialog
					row={selected}
					token={token}
					onClose={() => setSelected(null)}
				/>
			)}
		</div>
	);
}

function PayloadPreview({
	row,
	token
}: {
	readonly row: EntityRecord;
	readonly token?: EventTokenContext;
}): React.JSX.Element {
	const value = payload(row);
	const topic = valueText(
		eventTopics(row)[0] ?? decodeContractEventValue(null)
	);
	const amount = valueText(value);
	const tokenAmount =
		token?.contractId === row.contractId &&
		['mint', 'burn', 'transfer', 'clawback'].includes(topic) &&
		/^-?\d+$/.test(amount);
	if (row.dataJson === 'void' || value.kind === 'void')
		return <span className={styles.muted}>No value</span>;
	if (tokenAmount)
		return (
			<div className={styles.preview}>
				<strong>
					{formatAtomic(amount, token!.decimals)}{' '}
					<Link href={'/explorer/assets/' + encodeURIComponent(token!.assetId)}>
						{token!.symbol}
					</Link>
				</strong>
				<span className={styles.muted}>
					{topic === 'transfer'
						? 'Transferred'
						: topic === 'mint'
							? 'Minted'
							: topic === 'burn'
								? 'Burned'
								: 'Clawed back'}
				</span>
			</div>
		);
	const { fields } = flattenContractEventValue(value);
	const addressField = fields.find((field) =>
		/^(?:[GC][A-Z2-7]{55}|[^:]{1,12}:G[A-Z2-7]{55})$/.test(
			valueText(field.value)
		)
	);
	if (addressField)
		return (
			<div className={styles.previewAddress}>
				<ScalarValue value={addressField.value} />
			</div>
		);
	return (
		<div className={styles.preview}>
			{fields.slice(0, 2).map((field, index) => (
				<div className={styles.previewLine} key={index}>
					{field.path !== 'value' && (
						<span className={styles.muted}>
							{field.path.replaceAll('_', ' ')}:{' '}
						</span>
					)}
					<ScalarValue value={field.value} field={field.path} />
				</div>
			))}
		</div>
	);
}

export function ScalarValue({
	value,
	field = ''
}: {
	readonly value: ContractEventValue;
	readonly field?: string;
}): React.JSX.Element {
	if (value.kind === 'typed')
		return <ScalarValue value={value.value} field={field} />;
	if (value.kind === 'void' || value.kind === 'null')
		return (
			<span className={styles.muted}>
				{value.kind === 'void' ? 'No value' : 'null'}
			</span>
		);
	if (value.kind === 'bytes')
		return <code>{value.text ?? `${value.hex.length / 2} bytes`}</code>;
	if (value.kind === 'raw') return <code>{value.text}</code>;
	if (value.kind === 'array' || value.kind === 'object')
		return (
			<span>
				{value.kind === 'array' ? value.items.length : value.entries.length}{' '}
				fields
			</span>
		);
	const text = String(value.value);
	const href = /^G[A-Z2-7]{55}$/.test(text)
		? buildEntityHref('accounts', text)
		: /^C[A-Z2-7]{55}$/.test(text)
			? buildEntityHref('contracts', text)
			: /^[^:]{1,12}:G[A-Z2-7]{55}$/.test(text)
				? '/explorer/assets/' + encodeURIComponent(text)
				: /ledger(?:_sequence)?$/i.test(field) && /^\d{1,10}$/.test(text)
					? buildEntityHref('ledgers', text)
					: /(?:transaction_hash|transactionHash|tx_hash)$/.test(field) &&
						  /^[a-fA-F0-9]{64}$/.test(text)
						? buildEntityHref('transactions', text)
						: null;
	if (href)
		return (
			<Link className={styles.reference} href={href}>
				<code>{text}</code>
			</Link>
		);
	const date = timestampValue(text, field);
	if (date) return <LocalDateTime dateTime={date} />;
	return (
		<code>
			{value.kind === 'number' || /^-?\d+(?:\.\d+)?$/.test(text)
				? formatDecimal(text, 18)
				: text}
		</code>
	);
}

function EventDialog({
	row,
	token,
	onClose
}: {
	readonly row: EntityRecord;
	readonly token?: EventTokenContext;
	readonly onClose: () => void;
}): React.JSX.Element {
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const element = dialog.current;
		element?.showModal();
		return () => element?.close();
	}, []);
	const { fields, truncated } = flattenContractEventValue(payload(row));
	const summary = summarizeContractEvent(
		entityText(recordValue(row.classification), 'eventKind'),
		eventTopics(row)
	);
	return (
		<dialog
			ref={dialog}
			className={styles.raw}
			aria-labelledby="event-details-title"
			onCancel={onClose}
			onClose={onClose}
		>
			<div className={styles.rawHeading}>
				<h3 id="event-details-title">{summary.title}</h3>
				<button type="button" autoFocus onClick={onClose}>
					Close
				</button>
			</div>
			<p className={styles.muted}>{summary.context}</p>
			<dl className={styles.fields}>
				{(['contractId', 'ledgerSequence', 'transactionHash'] as const).map(
					(field) => {
						const id = entityText(row, field);
						const [collection, label] =
							field === 'contractId'
								? (['contracts', 'Contract'] as const)
								: field === 'ledgerSequence'
									? (['ledgers', 'Ledger'] as const)
									: (['transactions', 'Transaction'] as const);
						return id ? (
							<div className={styles.field} key={field}>
								<dt>{label}</dt>
								<dd>
									<Link
										className={styles.reference}
										href={buildEntityHref(
											collection,
											id,
											field === 'transactionHash'
												? { ledger_sequence: entityText(row, 'ledgerSequence') }
												: {}
										)}
									>
										<code>
											{field === 'ledgerSequence' ? formatDecimal(id, 0) : id}
										</code>
									</Link>
								</dd>
							</div>
						) : null;
					}
				)}
			</dl>
			<PayloadPreview row={row} token={token} />
			<h4>Topics</h4>
			<dl className={styles.fields}>
				{eventTopics(row).map((topic, index) => (
					<div className={styles.field} key={index}>
						<dt>Topic {index + 1}</dt>
						<dd>
							<ScalarValue value={topic} />
						</dd>
					</div>
				))}
			</dl>
			<h4>Data</h4>
			<dl className={styles.fields}>
				{fields.map((field, index) => (
					<div className={styles.field} key={index}>
						<dt>{field.path.replaceAll('_', ' ')}</dt>
						<dd>
							<ScalarValue value={field.value} field={field.path} />
						</dd>
					</div>
				))}
			</dl>
			{truncated && (
				<p className={styles.muted}>
					Additional fields are in the original record.
				</p>
			)}
			<details>
				<summary>Original record and XDR</summary>
				<pre>{JSON.stringify(row, null, 2)}</pre>
			</details>
		</dialog>
	);
}
