'use client';

import { useId, useState } from 'react';
import {
	copyExampleSource,
	type CopyExampleResult
} from './copy-example-source';

export function DeveloperGuideCode({
	source,
	language
}: {
	readonly source: string;
	readonly language: string;
}): React.JSX.Element {
	const feedbackId = useId();
	const [state, setState] = useState<CopyExampleResult | 'idle' | 'copying'>(
		'idle'
	);
	async function copy(): Promise<void> {
		setState('copying');
		setState(await copyExampleSource(source));
	}
	const feedback =
		state === 'copied'
			? 'Copied code to clipboard.'
			: state === 'failed'
				? 'Could not copy. Select the example and copy it manually.'
				: state === 'unavailable'
					? 'Clipboard access is unavailable. Select the example and copy it manually.'
					: '';
	return (
		<div className="developer-guide-code">
			<div className="developer-guide-code-tools">
				<span>Example</span>
				<button
					type="button"
					aria-label="Copy code"
					aria-describedby={feedbackId}
					disabled={state === 'copying'}
					onClick={() => void copy()}
				>
					{state === 'copying'
						? 'Copying…'
						: state === 'copied'
							? 'Copied'
							: 'Copy code'}
				</button>
			</div>
			<p
				id={feedbackId}
				role="status"
				aria-live="polite"
				className="developer-guide-code-feedback"
			>
				{feedback}
			</p>
			<pre tabIndex={0} aria-label="Example source">
				<code className={`language-${language}`}>{source}</code>
			</pre>
		</div>
	);
}
