interface PageHeadingProps {
	eyebrow: string;
	title: string;
	description?: string;
	aside?: React.ReactNode;
}

export function PageHeading({
	aside,
	description,
	eyebrow,
	title
}: PageHeadingProps): React.JSX.Element {
	return (
		<header className="page-heading">
			<div>
				<p className="eyebrow">{eyebrow}</p>
				<h1>{title}</h1>
				{description && <p className="lede">{description}</p>}
			</div>
			{aside && <div className="heading-aside">{aside}</div>}
		</header>
	);
}
