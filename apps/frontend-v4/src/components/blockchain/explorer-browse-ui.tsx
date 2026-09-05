export const explorerBrowseSections = [
	'Transactions',
	'Operations',
	'Assets',
	'Contracts'
] as const;
export type ExplorerBrowseSection = (typeof explorerBrowseSections)[number];

export function ExplorerBrowseNavigation({
	active,
	onChange
}: {
	readonly active: ExplorerBrowseSection;
	readonly onChange: (section: ExplorerBrowseSection) => void;
}): React.JSX.Element {
	return (
		<nav className="explorer-browse-nav" aria-label="Browse blockchain data">
			{explorerBrowseSections.map((section) => (
				<button
					key={section}
					type="button"
					aria-pressed={active === section}
					onClick={() => onChange(section)}
				>
					{section}
				</button>
			))}
		</nav>
	);
}

export function ExplorerRequestNotice({
	error,
	loading,
	onRetry
}: {
	readonly error: string | null;
	readonly loading: boolean;
	readonly onRetry: () => void;
}): React.JSX.Element | null {
	if (loading)
		return (
			<p className="explorer-state neutral" role="status">
				Loading data. Previous results remain visible.
			</p>
		);
	if (error === null) return null;
	return (
		<div
			className="explorer-state warning explorer-request-notice"
			role="alert"
		>
			<span>{error} Previous results remain visible when available.</span>
			<button className="inspect-action" onClick={onRetry} type="button">
				Try again
			</button>
		</div>
	);
}

export function ExplorerIndexUnavailable({
	label,
	loading,
	onRetry
}: {
	readonly label: string;
	readonly loading: boolean;
	readonly onRetry: () => void;
}): React.JSX.Element {
	return (
		<div className="explorer-state neutral explorer-request-notice">
			<div>
				<strong>
					{loading ? 'Checking availability' : label + ' index not ready'}
				</strong>
				<p>
					Complete indexed coverage is not currently available from this API.
					Transaction, account, and ledger lookup remains available above.
				</p>
			</div>
			<button
				className="inspect-action"
				disabled={loading}
				onClick={onRetry}
				type="button"
			>
				Check availability
			</button>
		</div>
	);
}

export function ExplorerInput({
	label,
	onChange,
	type = 'text',
	value
}: {
	readonly label: string;
	readonly onChange: (value: string) => void;
	readonly type?: string;
	readonly value: string;
}): React.JSX.Element {
	return (
		<label>
			<span>{label}</span>
			<input
				onChange={(event) => onChange(event.currentTarget.value)}
				type={type}
				value={value}
			/>
		</label>
	);
}
