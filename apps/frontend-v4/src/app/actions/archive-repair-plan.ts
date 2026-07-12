'use server';

import type { PublicHistoryArchiveRepairPlan } from '../../api/archive-repair-types';
import { fetchHistoryArchiveRepairPlanForArchive } from '../../api/archive-scans-client';
import { hasControlCharacters } from '../../domain/known-archive-evidence';

export type ArchiveRepairPlanActionResult =
	| { readonly plan: PublicHistoryArchiveRepairPlan; readonly status: 'loaded' }
	| {
			readonly message: string;
			readonly plan: null;
			readonly status: 'invalid' | 'unavailable';
	  };

export async function loadArchiveRepairPlan(
	archiveUrlValue: unknown
): Promise<ArchiveRepairPlanActionResult> {
	const archiveUrl = readArchiveUrl(archiveUrlValue);
	if (archiveUrl === null) {
		return {
			message: 'Invalid archive source.',
			plan: null,
			status: 'invalid'
		};
	}

	try {
		return {
			plan: await fetchHistoryArchiveRepairPlanForArchive(archiveUrl, 100, {
				cache: 'no-store',
				timeoutMs: 12_000
			}),
			status: 'loaded'
		};
	} catch {
		return {
			message: 'Repair evidence is currently unavailable.',
			plan: null,
			status: 'unavailable'
		};
	}
}

function readArchiveUrl(value: unknown): string | null {
	if (
		typeof value !== 'string' ||
		value.length < 1 ||
		value.length > 2_048 ||
		value.trim() !== value ||
		hasControlCharacters(value)
	) {
		return null;
	}
	try {
		const url = new URL(value);
		if (
			(url.protocol !== 'http:' && url.protocol !== 'https:') ||
			url.username !== '' ||
			url.password !== ''
		) {
			return null;
		}
		return value;
	} catch {
		return null;
	}
}
