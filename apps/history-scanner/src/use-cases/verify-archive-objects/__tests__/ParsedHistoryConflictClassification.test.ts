import { ParsedHistoryRegistrationConflictError } from '../../../infrastructure/services/ParsedHistoryRegistrationConflictError.js';
import { classifyCategoryVerificationFailure } from '../ArchiveObjectCategoryVerifier.js';

it('classifies a parsed-history content conflict as archive evidence', () => {
	const conflict = new ParsedHistoryRegistrationConflictError(
		'Parsed ledger header content conflicts with its stored identity',
		'stored-value-conflict',
		[{ ledgerHeaderHash: 'ledger-header-hash', ledgerSequence: 64 }]
	);

	expect(classifyCategoryVerificationFailure(conflict, 200)).toMatchObject({
		errorMessage: conflict.message,
		errorType: 'category_content_invalid',
		failureChannel: 'archive_evidence',
		httpStatus: 200
	});
});
