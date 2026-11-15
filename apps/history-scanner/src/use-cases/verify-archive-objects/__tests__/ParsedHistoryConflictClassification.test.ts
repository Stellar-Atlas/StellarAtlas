import { ParsedHistoryRegistrationConflictError } from '../../../infrastructure/services/ParsedHistoryRegistrationConflictError.js';
import { classifyCategoryVerificationFailure } from '../ArchiveObjectCategoryFailureClassifier.js';

it('classifies a parsed-history content conflict as archive evidence', () => {
	const conflict = new ParsedHistoryRegistrationConflictError(
		'Parsed ledger header content conflicts with its stored identity',
		'stored-value-conflict',
		[{ ledgerHeaderHash: 'ledger-header-hash', ledgerSequence: 64 }]
	);

	expect(classifyCategoryVerificationFailure(conflict, 200)).toMatchObject({
		errorMessage: conflict.message + '; cause: code=parsed_history_conflict',
		errorType: 'category_content_invalid',
		failureChannel: 'archive_evidence',
		httpStatus: 200
	});
});

it('keeps an unvalidated conflict code in the scanner issue channel', () => {
	const error = Object.assign(new Error('Unvalidated conflict'), {
		code: 'parsed_history_conflict'
	});
	expect(classifyCategoryVerificationFailure(error, 200)).toMatchObject({
		errorType: 'category_pipeline_failure',
		failureChannel: 'scanner_issue',
		httpStatus: null
	});
});
