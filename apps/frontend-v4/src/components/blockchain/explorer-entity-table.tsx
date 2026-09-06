import Link from 'next/link';
import {
	buildEntityHref,
	entityText,
	recordValue,
	type AnalyticsCollection,
	type EntityRecord,
	type ExplorerFilters
} from '../../api/explorer-analytics';
import { LocalDateTime } from '../local-date-time';
import { entityColumns } from './explorer-entity-config';
import styles from './explorer-entity.module.css';

const shorten = (value: string): string =>
	value.length > 28 ? value.slice(0, 12) + '…' + value.slice(-8) : value;
export function EntityLink({
	collection,
	id,
	filters = {},
	label
}: {
	readonly collection: string;
	readonly id: string;
	readonly filters?: ExplorerFilters;
	readonly label?: string;
}): React.JSX.Element {
	return (
		<Link
			className={styles.hash}
			href={buildEntityHref(collection, id, filters)}
			title={id}
		>
			{label ?? shorten(id)}
		</Link>
	);
}
function Field({
	collection,
	row,
	field,
	filters
}: {
	readonly collection: AnalyticsCollection;
	readonly row: EntityRecord;
	readonly field: string;
	readonly filters: ExplorerFilters;
}): React.JSX.Element {
	const text = entityText(row, field);
	if (field === 'id')
		return (
			<EntityLink
				collection={collection}
				id={text}
				filters={filters}
				label={
					collection === 'assets'
						? entityText(row, 'code') ||
							(text === 'native' ? 'XLM' : shorten(text))
						: undefined
				}
			/>
		);
	if (field === 'closedAt')
		return text ? <LocalDateTime dateTime={text} /> : <>—</>;
	if (field === 'deleted')
		return <>{row.deleted === true ? 'Removed' : 'Open at observation'}</>;
	if (field === 'sellingAsset' || field === 'buyingAsset') {
		const asset = recordValue(row[field]),
			id = entityText(asset, 'id');
		return id ? (
			<EntityLink
				collection="assets"
				id={id}
				filters={filters}
				label={
					entityText(asset, 'code') || (id === 'native' ? 'XLM' : shorten(id))
				}
			/>
		) : (
			<>—</>
		);
	}
	if (field === 'price') {
		const price = recordValue(row.price);
		return (
			<span title="Exact numerator / denominator">
				{entityText(price, 'numerator') || '—'} /{' '}
				{entityText(price, 'denominator') || '—'}
			</span>
		);
	}
	if (
		field === 'sourceAccount' ||
		field === 'seller' ||
		field === 'buyer' ||
		field === 'issuer'
	)
		return text ? (
			<EntityLink collection="accounts" id={text} />
		) : (
			<>Native asset</>
		);
	if (field === 'transactionId') {
		const id = entityText(row, 'transactionHash');
		if (!id)
			return (
				<span title="No transaction hash published for this operation">
					{text || '—'}
				</span>
			);
		return id ? (
			<EntityLink
				collection="transactions"
				id={id}
				filters={{ ledger_sequence: entityText(row, 'ledgerSequence') }}
			/>
		) : (
			<>—</>
		);
	}
	if (field === 'ledgerSequence')
		return <EntityLink collection="ledgers" id={text} />;
	return <>{text || '—'}</>;
}
export function ExplorerEntityTable({
	collection,
	rows,
	filters
}: {
	readonly collection: AnalyticsCollection;
	readonly rows: readonly EntityRecord[];
	readonly filters: ExplorerFilters;
}): React.JSX.Element {
	if (rows.length === 0)
		return (
			<p className={styles.empty}>
				No matching {collection} in this published ledger window. Change the
				filters or choose another range.
			</p>
		);
	return (
		<div className={styles.tableWrap}>
			<table className={styles.table}>
				<thead>
					<tr>
						{entityColumns[collection].map(([key, label]) => (
							<th key={key} scope="col">
								{label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, index) => (
						<tr
							key={
								entityText(row, 'id') +
								':' +
								entityText(row, 'ledgerSequence') +
								':' +
								index
							}
						>
							{entityColumns[collection].map(([key, label]) => (
								<td key={key} data-label={label}>
									<Field
										collection={collection}
										row={row}
										field={key}
										filters={filters}
									/>
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
export function ExplorerEntityDetails({
	collection,
	row,
	filters
}: {
	readonly collection: AnalyticsCollection;
	readonly row: EntityRecord;
	readonly filters: ExplorerFilters;
}): React.JSX.Element {
	const details = recordValue(row.details);
	const shownFields = Object.entries(details)
		.filter(
			([, value]) =>
				typeof value === 'string' ||
				typeof value === 'number' ||
				typeof value === 'boolean'
		)
		.slice(0, 30);
	return (
		<>
			<dl className={styles.details}>
				{entityColumns[collection].flatMap(([key, label]) => [
					<dt key={key + 'label'}>{label}</dt>,
					<dd key={key}>
						<Field
							collection={collection}
							row={row}
							field={key}
							filters={filters}
						/>
					</dd>
				])}
			</dl>
			{shownFields.length > 0 && (
				<section>
					<h3>Operation details</h3>
					<dl className={styles.details}>
						{shownFields.flatMap(([key, value]) => [
							<dt key={key + 'label'}>{key.replaceAll('_', ' ')}</dt>,
							<dd key={key}>{String(value)}</dd>
						])}
					</dl>
				</section>
			)}
			{collection === 'assets' && (
				<div className={styles.actions}>
					<Link
						href={buildEntityHref('transfers', undefined, {
							asset: entityText(row, 'id'),
							...filters
						})}
					>
						Transfers
					</Link>
					<Link
						href={buildEntityHref('trades', undefined, {
							selling_asset: entityText(row, 'id'),
							...filters
						})}
					>
						Trades selling this asset
					</Link>
					<Link
						href={buildEntityHref('trades', undefined, {
							buying_asset: entityText(row, 'id'),
							...filters
						})}
					>
						Trades buying this asset
					</Link>
					<Link
						href={buildEntityHref('offers', undefined, {
							selling_asset: entityText(row, 'id'),
							...filters
						})}
					>
						Offer history
					</Link>
				</div>
			)}
			{collection === 'trades' && entityText(row, 'operationId') && (
				<Link
					href={buildEntityHref('operations', entityText(row, 'operationId'))}
				>
					Open trade operation
				</Link>
			)}
		</>
	);
}
