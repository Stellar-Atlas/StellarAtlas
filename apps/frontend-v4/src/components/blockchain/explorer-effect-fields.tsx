import { entityText, type EntityRecord } from '../../api/explorer-analytics';
import { ExplorerRecordValue } from './explorer-record-value';

/** Typed effect identity is separate from supplemental details (for example an asset issuer). */
export function ExplorerEffectFields({ row, ledger }: {
	readonly row: EntityRecord;
	readonly ledger: string;
}): React.JSX.Element {
	return <>
		<dt>Effect ID</dt><dd>{entityText(row, 'id') || 'Not recorded'}</dd>
		<dt>Account</dt><dd>{row.account ? <ExplorerRecordValue field="account" value={row.account} /> : 'Not recorded'}</dd>
		{row.accountMuxed ? <><dt>Account (muxed)</dt><dd><ExplorerRecordValue field="accountMuxed" value={row.accountMuxed} /></dd></> : null}
		<dt>Operation</dt><dd>{row.operationId ? <ExplorerRecordValue field="operation_id" value={row.operationId} filters={{ min_ledger: ledger, max_ledger: ledger }} /> : 'Not recorded'}</dd>
	</>;
}
