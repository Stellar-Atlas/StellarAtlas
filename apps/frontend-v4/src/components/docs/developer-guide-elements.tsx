import type { ReactNode } from 'react';
import { graphqlAnalyticsExamples } from './graphql-analytics-examples';

export interface DeveloperGuideSection {
	readonly id: string;
	readonly title: string;
	readonly content: ReactNode;
}
export interface DeveloperGuidePage {
	readonly slug: string;
	readonly title: string;
	readonly description: string;
	readonly group: 'Getting started' | 'Querying data' | 'Reference';
	readonly sections: readonly DeveloperGuideSection[];
}

export const api = 'https://api.stellaratlas.io';
export const sampleWindow = 'min_ledger=63490364&max_ledger=63490365';

export function Code({
	children,
	language = 'bash'
}: {
	readonly children: string;
	readonly language?: string;
}): React.JSX.Element {
	return (
		<pre>
			<code className={`language-${language}`}>{children}</code>
		</pre>
	);
}
export function GraphqlExample({
	example
}: {
	readonly example: keyof typeof graphqlAnalyticsExamples;
}): React.JSX.Element {
	const value = graphqlAnalyticsExamples[example];
	return (
		<>
			<Code language="graphql">{value.query}</Code>
			<p>Variables</p>
			<Code language="json">{JSON.stringify(value.variables, null, 2)}</Code>
		</>
	);
}
