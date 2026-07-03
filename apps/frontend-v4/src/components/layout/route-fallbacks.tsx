import Link from 'next/link';

export function RouteLoadingPanel(): React.JSX.Element {
	return (
		<main className="shell">
			<section className="panel loading-panel" aria-label="Loading page">
				<div />
				<div />
				<div />
			</section>
		</main>
	);
}

interface RouteErrorPanelProps {
	readonly eyebrow: string;
	readonly message: string;
	readonly onRetry: () => void;
	readonly title: string;
}

export function RouteErrorPanel({
	eyebrow,
	message,
	onRetry,
	title
}: RouteErrorPanelProps): React.JSX.Element {
	return (
		<main className="shell">
			<section className="error-panel">
				<p className="eyebrow">{eyebrow}</p>
				<h1>{title}</h1>
				<p>{message}</p>
				<button className="primary-button" onClick={onRetry} type="button">
					Retry
				</button>
			</section>
		</main>
	);
}

interface RouteNotFoundPanelProps {
	readonly description: string;
	readonly href: string;
	readonly linkLabel: string;
	readonly title: string;
}

export function RouteNotFoundPanel({
	description,
	href,
	linkLabel,
	title
}: RouteNotFoundPanelProps): React.JSX.Element {
	return (
		<main className="shell">
			<section className="error-panel">
				<p className="eyebrow">StellarAtlas</p>
				<h1>{title}</h1>
				<p>{description}</p>
				<Link className="primary-button" href={href}>
					{linkLabel}
				</Link>
			</section>
		</main>
	);
}

export function GraphLoadingPanel(): React.JSX.Element {
	return (
		<main className="graph-workspace graph-loading-workspace">
			<div className="graph-canvas loading-graph" />
			<section className="graph-overlay graph-summary">
				<p className="eyebrow">Public Stellar Network</p>
				<h1>Network topology</h1>
				<div className="loading-lines">
					<span />
					<span />
					<span />
				</div>
			</section>
		</main>
	);
}
