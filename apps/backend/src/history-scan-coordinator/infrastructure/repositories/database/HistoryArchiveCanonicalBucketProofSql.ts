export const canonicalBucketHasStrictSourceProofSql = `
	candidate."verificationFacts"#>>'{bucketObject,matched}' = 'true'
	and lower(candidate."verificationFacts"#>>
		'{bucketObject,expectedBucketHash}') = target."bucketHash"
	and candidate."verificationFacts"#>>'{bucketObject,sourceUrl}' =
		candidate."objectUrl"
`;
