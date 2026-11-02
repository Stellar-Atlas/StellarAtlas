import data from '../../../../../seeds/hackathons.json' with { type: 'json' };
import { record } from './ContractBuildAttestation.js';

type ElementOf<T extends readonly unknown[]> = T[number];

const AWARDS = ['first', 'runner-up'] as const;
const TRACKS = ['genesis', 'scale'] as const;
const EVIDENCE = ['verified', 'likely'] as const;

export interface HackathonParticipation {
	readonly slug: string;
	readonly name: string;
	readonly network: string;
	readonly award: ElementOf<typeof AWARDS> | null;
	readonly track: ElementOf<typeof TRACKS> | null;
	readonly evidence: ElementOf<typeof EVIDENCE>;
}

type Index = ReadonlyMap<string, readonly HackathonParticipation[]>;

function text(value: unknown, path: string): string {
	if (typeof value === 'string' && value.length > 0) return value;
	throw new Error(`hackathons.json: ${path} must be a non-empty string`);
}

function oneOf<const T extends readonly string[]>(
	value: unknown,
	path: string,
	allowed: T
): ElementOf<T> {
	if (
		typeof value === 'string' &&
		(allowed as readonly string[]).includes(value)
	)
		return value as ElementOf<T>;
	throw new Error(
		`hackathons.json: ${path} must be one of ${allowed.join(', ')}`
	);
}

function orNull<R>(
	value: unknown,
	path: string,
	parse: (value: unknown, path: string) => R
): R | null {
	return value === null ? null : parse(value, path);
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
				if (!events[slug])
					throw new Error(
						`hackathons.json: ${path} names unknown event ${slug}`
					);
				const event = record(events[slug]);

				return {
					slug,
					name: text(event.name, `events.${slug}.name`),
					network: text(event.network, `events.${slug}.network`),
					award: orNull(item.award, `${path}.award`, (value, at) =>
						oneOf(value, at, AWARDS)
					),
					track: orNull(item.track, `${path}.track`, (value, at) =>
						oneOf(value, at, TRACKS)
					),
					evidence: oneOf(item.evidence, `${path}.evidence`, EVIDENCE)
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
