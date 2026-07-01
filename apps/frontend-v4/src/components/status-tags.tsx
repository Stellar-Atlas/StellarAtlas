import type { NodeTag } from '../domain/network';

interface StatusTagsProps {
	tags: NodeTag[];
}

export function StatusTags({ tags }: StatusTagsProps): React.JSX.Element {
	return (
		<div className="tags">
			{tags.map((tag) => (
				<span className={`tag ${tag.tone}`} key={tag.label}>
					{tag.label}
				</span>
			))}
		</div>
	);
}
