export const canonicalCategoryHasStrictSourceProofSql = `
	candidate."verificationFacts"#>>
		(array[candidate."objectType" || 'Category', 'sourceUrl']) =
		candidate."objectUrl"
`;
