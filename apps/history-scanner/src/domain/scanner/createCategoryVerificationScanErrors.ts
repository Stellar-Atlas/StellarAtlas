import type { Url } from 'http-helper';
import type { CheckPointGenerator } from '../check-point/CheckPointGenerator.js';
import { UrlBuilder } from '../history-archive/UrlBuilder.js';
import { ScanError, ScanErrorType } from '../scan/ScanError.js';
import type { VerificationError } from './CategoryVerificationService.js';

export function createCategoryVerificationScanErrors(
	baseUrl: Url,
	checkPointGenerator: CheckPointGenerator,
	verificationErrors: readonly VerificationError[]
): ScanError[] {
	return verificationErrors.map(
		(error) =>
			new ScanError(
				ScanErrorType.TYPE_VERIFICATION,
				UrlBuilder.getCategoryUrl(
					baseUrl,
					checkPointGenerator.getClosestHigherCheckPoint(error.ledger),
					error.category
				).value,
				error.message
			)
	);
}
