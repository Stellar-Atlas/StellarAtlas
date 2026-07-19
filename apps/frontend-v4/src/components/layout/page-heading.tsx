import {
	getScopeContextDataAttributes,
	ScopeContext,
	type ScopeContextProps
} from './scope-context';

interface PageHeadingProps {
	eyebrow: string;
	title: string;
	description?: string;
	aside?: React.ReactNode;
	scopeContext?: ScopeContextProps;
}

export function PageHeading({
	aside,
	description,
	eyebrow,
	scopeContext,
	title
}: PageHeadingProps): React.JSX.Element {
	return (
		<header
			className="page-heading"
			{...(scopeContext ? getScopeContextDataAttributes(scopeContext) : {})}
		>
			<div>
				<p className="eyebrow">{eyebrow}</p>
				<h1>{title}</h1>
				{description && <p className="lede">{description}</p>}
				{scopeContext ? <ScopeContext {...scopeContext} /> : null}
			</div>
			{aside && <div className="heading-aside">{aside}</div>}
		</header>
	);
}
