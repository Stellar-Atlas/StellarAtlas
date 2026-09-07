import {
	historyArchiveContentFailurePattern,
	historyArchiveTransportFailurePattern,
	historyArchiveInterruptedMessagePattern
} from 'shared';

/** Alias is source-owned SQL, never user input. Same rule as the shared public classifier. */
export function historyArchiveInconclusiveTransportFailureSql(
	alias: string
): string {
	if (!/^[a-z_][a-z0-9_]*$/i.test(alias))
		throw new Error('Invalid failure SQL alias');
	const type = `upper(replace(coalesce(${alias}."errorType", ''), '-', '_'))`;
	return `(not coalesce(${alias}."httpStatus" between 300 and 599, false)
		and not (${type} ~ '${historyArchiveContentFailurePattern}')
		and (${type} ~ '${historyArchiveTransportFailurePattern}'
			or upper(coalesce(${alias}."errorMessage", '')) ~ '${historyArchiveInterruptedMessagePattern}'))`;
}
