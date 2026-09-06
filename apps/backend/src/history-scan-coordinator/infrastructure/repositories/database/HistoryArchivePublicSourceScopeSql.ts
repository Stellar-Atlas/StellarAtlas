/**
 * Legacy identities that changed path case are retained for forensic reads,
 * not counted again as current public sources. URL paths remain case-sensitive.
 */
export const historyArchivePublicSourcePredicateSql =
	'"archiveUrlIdentity" = regexp_replace("archiveUrl", \'/+$\', \'\')';
