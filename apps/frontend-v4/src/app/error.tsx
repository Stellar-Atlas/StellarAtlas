'use client';

interface ErrorPageProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function ErrorPage({
	error,
	reset
}: ErrorPageProps): React.JSX.Element {
	return (
		<main className="shell">
			<section className="error-panel">
				<p className="eyebrow">StellarAtlas</p>
				<h1>Network API unavailable</h1>
				<p>{error.message}</p>
				<button className="primary-button" onClick={reset} type="button">
					Retry
				</button>
			</section>
		</main>
	);
}
