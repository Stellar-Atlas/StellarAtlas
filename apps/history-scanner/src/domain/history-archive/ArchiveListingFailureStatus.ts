/** An object failure permits a capability probe, never proves a missing range. */
export function isArchiveListingFailureStatus(
	status: number | null | undefined
): status is 403 | 404 | 410 {
	return status === 403 || status === 404 || status === 410;
}
