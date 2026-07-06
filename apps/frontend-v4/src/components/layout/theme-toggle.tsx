'use client';

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

const storageKey = 'stellaratlas-theme';

export function ThemeToggle(): React.JSX.Element {
	const [theme, setTheme] = useState<Theme>('dark');

	useEffect(() => {
		const resolvedTheme = resolveStoredTheme();
		setTheme(resolvedTheme);
		applyTheme(resolvedTheme);
	}, []);

	const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';

	return (
		<button
			aria-label={`Switch to ${nextTheme} theme`}
			aria-pressed={theme === 'dark'}
			className="theme-toggle"
			onClick={() => {
				try {
					window.localStorage.setItem(storageKey, nextTheme);
				} catch {
					// The DOM theme still changes when storage is unavailable.
				}
				applyTheme(nextTheme);
				setTheme(nextTheme);
			}}
			title={`Switch to ${nextTheme} theme`}
			type="button"
		>
			<span aria-hidden="true">{theme === 'dark' ? 'D' : 'L'}</span>
			<span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
		</button>
	);
}

function resolveStoredTheme(): Theme {
	let stored: string | null = null;
	try {
		stored = window.localStorage.getItem(storageKey);
	} catch {
		return 'dark';
	}
	if (stored === 'dark' || stored === 'light') return stored;
	if (
		stored === 'system' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-color-scheme: light)').matches
	) {
		return 'light';
	}
	return 'dark';
}

function applyTheme(theme: Theme): void {
	document.documentElement.dataset.theme = theme;
	document.documentElement.style.colorScheme = theme;
}
