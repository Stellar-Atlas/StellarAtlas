interface StatCardProps {
	label: string;
	value: string;
	detail: string;
	tone?: 'good' | 'warning' | 'danger';
}

export function StatCard({
	detail,
	label,
	tone,
	value
}: StatCardProps): React.JSX.Element {
	return (
		<article className={`stat-card ${tone ?? ''}`}>
			<span>{label}</span>
			<strong>{value}</strong>
			<small>{detail}</small>
		</article>
	);
}
