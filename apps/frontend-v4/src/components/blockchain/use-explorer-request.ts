'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
	executeExplorerRequest,
	explorerResponseError
} from './explorer-request';

export function useExplorerRequest<T>(initialValue: T, failureMessage: string) {
	const [result, setResult] = useState(initialValue);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const generation = useRef(0);
	const mounted = useRef(true);
	const lastAction = useRef<(() => Promise<T>) | null>(null);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			generation.current += 1;
		};
	}, []);

	const accept = useCallback((value: T) => {
		if (!mounted.current) return;
		generation.current += 1;
		setLoading(false);
		const message = explorerResponseError(value);
		setError(message);
		if (message === null) setResult(value);
	}, []);

	const run = useCallback(
		async (action: () => Promise<T>): Promise<T | null> => {
			const requestGeneration = ++generation.current;
			lastAction.current = action;
			setLoading(true);
			setError(null);
			const outcome = await executeExplorerRequest(action, failureMessage);
			if (!mounted.current || generation.current !== requestGeneration)
				return null;
			setLoading(false);
			if (!outcome.ok) {
				setError(outcome.message);
				return null;
			}
			setResult(outcome.value);
			return outcome.value;
		},
		[failureMessage]
	);

	const retry = useCallback(() => {
		if (lastAction.current !== null) void run(lastAction.current);
	}, [run]);

	return { result, error, loading, run, retry, accept };
}
