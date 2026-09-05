import type { PublicKnownArchiveRemoteFailure } from '@api/archive-evidence-types';
import {
	formatObjectError,
	formatObjectStatus
} from './known-archive-evidence-table-parts';

export function RetainedRemoteFinding({
	failure
}: {
	readonly failure: PublicKnownArchiveRemoteFailure;
}): React.JSX.Element {
	const finding = failure.retainedFinding;
	if (finding === undefined) return <>{formatObjectError(failure.object)}</>;
	const sourceError = {
		...failure.object,
		error: {
			type: finding.errorType ?? 'archive_verification_failed',
			message: finding.errorMessage ?? 'No remote error message was captured',
			httpStatus: finding.httpStatus
		}
	};
	return (
		<>
			<strong>{formatObjectError(sourceError)}</strong>
			<small>
				Source finding remains unresolved until this source verifies
				successfully.
			</small>
			<small>
				Current check: {formatObjectStatus(failure.object)}
				{failure.object.error === null
					? ''
					: ' — ' + formatObjectError(failure.object)}
			</small>
		</>
	);
}
