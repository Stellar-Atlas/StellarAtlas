export default function ArchivesLoading(): React.JSX.Element {
	return (
		<main className="shell archive-inventory-route" aria-busy="true">
			<header className="page-heading">
				<div>
					<p className="eyebrow">Network operations</p>
					<h1>Archive inventory</h1>
					<p>Loading archive roots and checkpoint coverage…</p>
				</div>
			</header>
			<section className="panel detail-panel" role="status">
				Loading the latest archive snapshot. Previously loaded inventory will
				remain visible while updates are checked.
			</section>
		</main>
	);
}
