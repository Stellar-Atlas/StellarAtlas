'use client';

import { useEffect, useState } from 'react';
import { swaggerReferenceUrl } from './swagger-reference-configuration';
import styles from './api-reference.module.css';

export function PublicOpenApiReference(): React.JSX.Element {
	const [theme, setTheme] = useState<'dark' | 'light'>('dark');
	const [hash, setHash] = useState('');
	useEffect(() => {
		if (window.location.hash === '#graphql') {
			window.location.replace('/docs/graphql');
			return;
		}
		setHash(window.location.hash);
		const updateTheme = (): void => {
			setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
		};
		updateTheme();
		const observer = new MutationObserver(updateTheme);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		return () => observer.disconnect();
	}, []);
	return (
		<iframe
			className={styles.reference}
			src={swaggerReferenceUrl(theme, hash)}
			title="Complete StellarAtlas OpenAPI reference with request testing"
		/>
	);
}
