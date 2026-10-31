import data from '../../../../../seeds/hackathons.json' with { type: 'json' };
import { record } from './ContractBuildAttestation.js';

export interface HackathonParticipation {
	readonly slug: string;
	readonly name: string;
	readonly network: string;
	readonly award: 'first' | 'runner-up' | null;
	readonly track: 'genesis' | 'scale' | null;
	readonly evidence: 'verified' | 'likely';
}

type Index = ReadonlyMap<string, readonly HackathonParticipation[]>;

function text(value: unknown, path: string): string {
	if (typeof value === 'string' && value.length > 0) return value;
	throw new Error(`hackathons.json: ${path} must be a non-empty string`);
}

function oneOf<T extends string>(
	value: unknown,
	path: string,
	allowed: readonly T[]
): T {
	if (
		typeof value === 'string' &&
		(allowed as readonly string[]).includes(value)
	)
		return value as T;
	throw new Error(
		`hackathons.json: ${path} must be one of ${allowed.join(', ')}`
	);
}

function orNull<T extends string>(
	value: unknown,
	path: string,
	allowed: readonly T[]
): T | null {
	return value === null ? null : oneOf(value, path, allowed);
}

export function readHackathons(raw: unknown): Index {
	const source = record(raw);
	const events = record(source.events);
	const index = new Map<string, HackathonParticipation[]>();

	for (const [repository, entries] of Object.entries(
		record(source.repositories)
	)) {
		if (repository !== repository.toLowerCase() || !Array.isArray(entries))
			throw new Error(
				`hackathons.json: ${repository} must be lowercase with a list`
			);
		index.set(
			repository,
			entries.map((entry: unknown, position) => {
				const path = `${repository}[${position}]`;
				const item = record(entry);
				const slug = text(item.event, `${path}.event`);
				const event = record(events[slug]);
				if (!events[slug])
					throw new Error(
						`hackathons.json: ${path} names unknown event ${slug}`
					);

				return {
					slug,
					name: text(event.name, `events.${slug}.name`),
					network: text(event.network, `events.${slug}.network`),
					award: orNull(item.award, `${path}.award`, ['first', 'runner-up']),
					track: orNull(item.track, `${path}.track`, ['genesis', 'scale']),
					evidence: oneOf(item.evidence, `${path}.evidence`, [
						'verified',
						'likely'
					])
				};
			})
		);
	}

	return index;
}

const hackathons = readHackathons(data);

export function hackathonsOf(
	repository: string | null
): readonly HackathonParticipation[] {
	return (repository && hackathons.get(repository.toLowerCase())) || [];
}
