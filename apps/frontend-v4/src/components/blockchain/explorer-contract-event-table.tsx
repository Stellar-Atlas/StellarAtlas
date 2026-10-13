'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
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

function valueText(value: ContractEventValue): string {
	if (value.kind === 'typed') return valueText(value.value);
	if (
		value.kind === 'string' ||
		value.kind === 'number' ||
		value.kind === 'boolean'
	)
		return String(value.value);
	return '';
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
	token
}: {
	readonly rows: readonly EntityRecord[];
	readonly token?: EventTokenContext;
}): React.JSX.Element {
	const [selected, setSelected] = useState<EntityRecord | null>(null);
	return (
		<div className={styles.workspace}>
			<div className={styles.scroll}>
				<table className={styles.table} aria-label="Contract events">
					<colgroup>
						<col className={styles.ledgerColumn} />
						<col className={styles.eventColumn} />
						<col className={styles.dataColumn} />
						<col className={styles.txColumn} />
						<col className={styles.detailsColumn} />
					</colgroup>
					<thead>
						<tr>
							<th>Ledger / time</th>
							<th>Event</th>
							<th>Data</th>
							<th>Transaction</th>
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
							const topic = valueText(
								topics[0] ?? decodeContractEventValue(null)
							);
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
											<strong>{topic || 'Event'}</strong>
											<span
												title={
													row.successful === true
														? 'Transaction succeeded'
														: 'Transaction failed'
												}
											>
												{row.successful === true ? '✓' : '!'}
											</span>
										</div>
										<div className={styles.muted}>
											{kind === 'diagnostic'
												? 'Diagnostic'
												: kind === 'contract'
													? 'Contract'
													: kind}{' '}
											· {topics.length} topics
										</div>
									</td>
									<td>
										<PayloadPreview row={row} token={token} />
									</td>
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
								<td colSpan={5} className={styles.empty}>
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
		return <span className={styles.muted}>No return value</span>;
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

function ScalarValue({
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
	return (
		<dialog
			ref={dialog}
			className={styles.raw}
			aria-labelledby="event-details-title"
			onCancel={onClose}
			onClose={onClose}
		>
			<div className={styles.rawHeading}>
				<h3 id="event-details-title">Event details</h3>
				<button type="button" autoFocus onClick={onClose}>
					Close
				</button>
			</div>
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
