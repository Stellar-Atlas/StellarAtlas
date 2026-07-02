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

export function GraphLoadingPanel(): React.JSX.Element {
	return (
		<main className="graph-workspace">
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
