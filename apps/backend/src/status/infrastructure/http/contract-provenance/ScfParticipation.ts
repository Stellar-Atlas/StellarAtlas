import data from '../../../../../seeds/scf.json' with { type: 'json' };
import { record } from './ContractBuildAttestation.js';

export interface ScfProject {
	readonly slug: string;
	readonly name: string;
	readonly rounds: readonly string[];
}

interface Index {
	readonly repositories: ReadonlyMap<string, readonly ScfProject[]>;
	readonly owners: ReadonlyMap<string, readonly ScfProject[]>;
}

function text(value: unknown, path: string): string {
	if (typeof value === 'string' && value.length > 0) return value;
	throw new Error(`scf.json: ${path} must be a non-empty string`);
}

function rounds(value: unknown, path: string): string[] {
	if (!Array.isArray(value) || value.length === 0)
		throw new Error(`scf.json: ${path} must be a non-empty list`);
	return value.map((round, position) => text(round, `${path}[${position}]`));
}

function links(
	value: unknown,
	field: string,
	known: ReadonlyMap<string, ScfProject>
): ReadonlyMap<string, readonly ScfProject[]> {
	const index = new Map<string, readonly ScfProject[]>();
	for (const [key, slugs] of Object.entries(record(value))) {
		if (key !== key.toLowerCase() || !Array.isArray(slugs) || !slugs.length)
			throw new Error(
				`scf.json: ${field}.${key} must be lowercase with a list`
			);
		index.set(
			key,
			slugs.map((slug) => {
				const project = known.get(text(slug, `${field}.${key}`));
				if (!project)
					throw new Error(`scf.json: ${field}.${key} names unknown project`);
				return project;
			})
		);
	}
	return index;
}

export function readScf(raw: unknown): Index {
	const source = record(raw);
	const known = new Map<string, ScfProject>();
	for (const [slug, entry] of Object.entries(record(source.projects))) {
		const project = record(entry);
		known.set(slug, {
			slug,
			name: text(project.name, `projects.${slug}.name`),
			rounds: rounds(project.rounds, `projects.${slug}.rounds`)
		});
	}

	return {
		repositories: links(source.repositories, 'repositories', known),
		owners: links(source.owners, 'owners', known)
	};
}

const scf = readScf(data);

export function scfProjectsOf(
	repository: string | null
): readonly ScfProject[] {
	if (!repository) return [];
	const key = repository.toLowerCase();

	return (
		scf.repositories.get(key) ?? scf.owners.get(key.split('/')[0] ?? '') ?? []
	);
}
