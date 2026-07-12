export function historyArchiveObjectDependencySatisfiedSql(
	alias: string
): string {
	return `${alias}."dependencyReady" = true`;
}
