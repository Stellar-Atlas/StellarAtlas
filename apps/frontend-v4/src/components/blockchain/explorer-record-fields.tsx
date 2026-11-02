'use client';

import { Fragment, useId, useMemo, useState } from 'react';
import type { ExplorerFilters } from '../../api/explorer-analytics';
import { ExplorerRecordValue } from './explorer-record-value';
import { recordFieldInput, recordFieldTree, recordTreeLimits, type RecordFieldLevel } from './record-field-tree';
import styles from './explorer-record-fields.module.css';

/** Generic source fields, not a contract-specific interpretation or unit conversion. */
export function ExplorerRecordFields({ value, filters, exclude = [], rawFallback = true }: {
	readonly value: unknown;
	readonly filters?: ExplorerFilters;
	readonly exclude?: readonly string[];
	readonly rawFallback?: boolean;
}): React.JSX.Element {
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const [rawOpen, setRawOpen] = useState(false);
	const input = useMemo(() => recordFieldInput(value), [value]);
	const id = useId();
	const toggle = (path: string): void => setExpanded((previous) => {
		if (previous.has(path)) return new Set([...previous].filter((item) => item !== path && !item.startsWith(path + '.')));
		return previous.size < recordTreeLimits.expanded ? new Set([...previous, path]) : previous;
	});
	const renderLevel = (level: RecordFieldLevel): React.JSX.Element => <>
		<dl className={styles.fields}>
			{level.nodes.map((node) => <Fragment key={node.path}>
				<dt>{node.label}</dt>
				<dd>{node.count === null ? node.value == null ? <span className={styles.muted}>Not recorded</span>
					: <ExplorerRecordValue field={node.field} value={node.value} filters={filters} />
					: <>
						{node.expandable ? <button type="button" className={styles.expand} aria-expanded={!!node.children}
							aria-controls={id + node.path} disabled={!node.children && expanded.size >= recordTreeLimits.expanded}
							onClick={() => toggle(node.path)} aria-label={(node.children ? 'Collapse ' : 'Expand ') + node.label}>
							<span aria-hidden="true">{node.children ? '▾' : '▸'}</span> {countLabel(node.count, node.array)}
						</button> : <span className={styles.muted}>{countLabel(node.count, node.array)}{node.count > 0 ? ' · See raw details' : ''}</span>}
						<div id={id + node.path} hidden={!node.children}>{node.children && renderLevel(node.children)}</div>
					</>}
				</dd>
			</Fragment>)}
		</dl>
		{level.omitted > 0 && <p className={styles.muted}>{level.omitted} more {level.omitted === 1 ? 'entry' : 'entries'} in raw details.</p>}
	</>;
	return <div className={styles.record}>
		{typeof input === 'object' && input !== null ? renderLevel(recordFieldTree(input, expanded, exclude))
			: <p className={styles.muted}>Structured fields unavailable. View the raw details.</p>}
		{expanded.size >= recordTreeLimits.expanded && <p className={styles.muted}>Collapse a section to expand another.</p>}
		{rawFallback && <details onToggle={(event) => setRawOpen(event.currentTarget.open)}>
			<summary>Raw details</summary>
			{rawOpen && <pre className={styles.raw}>{rawDetails(value)}</pre>}
		</details>}
	</div>;
}

function rawDetails(value: unknown): string {
	if (typeof value === 'string') return value;
	try { return JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? String(item) : item, 2) ?? 'Not recorded'; }
	catch { return 'Raw details could not be rendered.'; }
}
function countLabel(count: number, array: boolean): string {
	return count + ' ' + (array ? 'item' : 'field') + (count === 1 ? '' : 's');
}
