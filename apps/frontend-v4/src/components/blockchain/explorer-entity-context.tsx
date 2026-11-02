import Link from 'next/link';
import { Fragment } from 'react';
import { buildEntityApiPath, entityText, recordValue, type AnalyticsCollection, type AnalyticsEntityPage, type ExplorerFilters } from '../../api/explorer-analytics';
import styles from './explorer-entity.module.css';

/** Accepted response context, never the controls' unsubmitted range. */
export function ExplorerEntityContext({collection,identifier,page,submitted,elapsed,sourceRecord=false}:{
	readonly collection:AnalyticsCollection;readonly identifier?:string;readonly page:AnalyticsEntityPage;
	readonly submitted:ExplorerFilters;readonly elapsed:number|null;readonly sourceRecord?:boolean;
}):React.JSX.Element {
	const source=recordValue(page.rows[0]?.sourceRecord);
	return <>
		<div className={styles.status}>
			<span>Ledgers {page.window.minLedger.toLocaleString('en-US')}–{page.window.maxLedger.toLocaleString('en-US')}</span>
			<span>{page.coverageStatus==='complete'?'Selected window fully published':'Selected window has incomplete or unknown coverage'}</span>
			{elapsed!==null&&<span>{elapsed} ms</span>}
			<a href={'https://api.stellaratlas.io'+buildEntityApiPath(collection,identifier,submitted,page.offset)} target="_blank" rel="noreferrer">View API response ↗</a>
			<Link href="/docs/rest">API guide</Link>
		</div>
		{sourceRecord&&<dl className={styles.details}>
			<dt>Dataset</dt><dd>Published parsed history</dd>
			{([['batchId','Source batch'],['digest','Source digest'],['rowNumber','Source row']] as const).map(([key,label])=>entityText(source,key)?<Fragment key={key}><dt>{label}</dt><dd className={styles.hash}>{entityText(source,key)}</dd></Fragment>:null)}
		</dl>}
	</>;
}
