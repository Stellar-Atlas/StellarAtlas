import { describeBalanceFlags, type BalanceFlagEvidence } from '../../api/balance-flag-evidence';
import styles from './explorer-entity.module.css';

export function ObservedBalanceFlags({evidence}: {readonly evidence: BalanceFlagEvidence}): React.JSX.Element {
	const description = describeBalanceFlags(evidence);
	return <details className={styles.flagEvidence}>
		<summary>{description.label}{description.clawback && <span>Clawback enabled</span>}</summary>
		<p>{description.context}</p>
		{evidence.flags !== undefined && <p>Raw flags: {evidence.flags} (0x{evidence.flags.toString(16)})</p>}
		{evidence.flagStatus === 'invalid' && <p>Invalid flag or asset-type metadata.</p>}
		{evidence.flagStatus !== 'recorded' && evidence.flagStatus !== 'invalid' && <p>Flag or asset-type metadata was not recorded.</p>}
		{description.known.length > 0 && <ul>{description.known.map((flag) => <li key={flag}>{flag}</li>)}</ul>}
		{evidence.flagStatus === 'recorded' && description.known.length === 0 && <p>No known flags set.</p>}
		{description.unknownBits > 0 && <p>Unknown flag bits: {description.unknownBits} (0x{description.unknownBits.toString(16)}).</p>}
		{evidence.assetType?.startsWith('credit_') && evidence.flags !== undefined && (evidence.flags & 3) === 3 && <p>Both authorization bits were recorded; authorization is not interpreted.</p>}
	</details>;
}
