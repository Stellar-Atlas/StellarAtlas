type CheckpointAlias = 'candidate' | 'checkpoint';

export function canonicalCheckpointHasStrictContentDigestSql(
	alias: CheckpointAlias
): string {
	return `${alias}."verificationFacts"->'content'->>'algorithm' = 'sha256'
		and ${alias}."verificationFacts"->'content'->>'representation' =
			'canonical-json'
		and lower(${alias}."verificationFacts"->'content'->>'digest') ~
			'^[0-9a-f]{64}$'`;
}

export function canonicalCheckpointHasStrictEvidenceSql(
	alias: CheckpointAlias
): string {
	return `(${canonicalCheckpointHasStrictContentDigestSql(alias)})
		and ${alias}."verificationFacts"#>>
			'{checkpointHistoryArchiveState,stellarHistoryUrl}' =
			${alias}."objectUrl"
		and ${alias}."verificationFacts"#>>
			'{checkpointHistoryArchiveStateFact,stellarHistoryUrl}' =
			${alias}."objectUrl"
		and ${alias}."verificationFacts"#>>
			'{checkpointHistoryArchiveStateFact,checkpointLedger}' =
			${alias}."checkpointLedger"::text`;
}
