import type { EntityRecord } from '../../api/explorer-analytics';

/** Operation result codes are not decoded contract return values. */
export function OperationResultFields({ row }: { readonly row: EntityRecord }): React.JSX.Element {
	const result = typeof row.resultCode === 'string' && row.resultCode.trim() ? row.resultCode : null;
	const trace = typeof row.traceCode === 'string' && row.traceCode.trim() ? row.traceCode : null;
	return <>
		<dt>Operation result</dt>
		<dd>{result ? <code>{result}</code> : 'Not provided'}</dd>
		{trace && <><dt>Trace code</dt><dd><code>{trace}</code></dd></>}
	</>;
}
