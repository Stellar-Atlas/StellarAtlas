import {
	historyArchiveContentFailurePattern,
	historyArchiveTransportFailurePattern,
	historyArchiveInterruptedMessagePattern,
	historyArchiveGenericFailureTypePattern,
	historyArchiveBlankFailureMessagePattern
} from 'shared';

/** Alias is source-owned SQL, never user input. Same rule as the shared public classifier. */
export function historyArchiveInconclusiveTransportFailureSql(
	alias: string
): string {
	if (!/^[a-z_][a-z0-9_]*$/i.test(alias))
		throw new Error('Invalid failure SQL alias');
	const type = `upper(replace(coalesce(${alias}."errorType", ''), '-', '_'))`;
	const message = `upper(coalesce(${alias}."errorMessage", ''))`;
	return `(not coalesce(${alias}."httpStatus" between 300 and 599, false)
		and not (${type} ~ '${historyArchiveContentFailurePattern}')
		and (${type} ~ '${historyArchiveTransportFailurePattern}'
			or ${message} ~ '${historyArchiveInterruptedMessagePattern}'
			or (${type} ~ '${historyArchiveGenericFailureTypePattern}'
				and ${message} ~ '${historyArchiveBlankFailureMessagePattern}')))`;
}
