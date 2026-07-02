import { Url } from 'http-helper';
import { Scan } from '@history-scan-coordinator/domain/scan/Scan.js';
import { ScanError, ScanErrorType } from '@history-scan-coordinator/domain/scan/ScanError.js';
import { mapScanToHistoryArchiveScan } from '../mapScanToHistoryArchiveScan.js';

describe('mapScanToHistoryArchiveScan', () => {
	it('returns all stored scan errors', () => {
		const baseUrl = Url.create('https://history.example.com');
		if (baseUrl.isErr()) throw baseUrl.error;

		const verificationError = new ScanError(
			ScanErrorType.TYPE_VERIFICATION,
			'https://history.example.com/bucket.xdr.gz',
			'Wrong bucket hash'
		);
		const connectionError = new ScanError(
			ScanErrorType.TYPE_CONNECTION,
			'https://history.example.com/history.json',
			'Request timed out'
		);
		const scan = new Scan(
			new Date('2026-07-01T00:00:00.000Z'),
			new Date('2026-07-01T00:00:00.000Z'),
			new Date('2026-07-01T00:05:00.000Z'),
			baseUrl.value,
			100,
			200,
			150,
			null,
			8,
			false,
			verificationError,
			[verificationError, connectionError]
		);

		const dto = mapScanToHistoryArchiveScan(scan);

		expect(dto.hasError).toBe(true);
		expect(dto.errorUrl).toBe(verificationError.url);
		expect(dto.errorMessage).toBe(verificationError.message);
		expect(dto.errors).toEqual([
			{
				message: verificationError.message,
				type: 'TYPE_VERIFICATION',
				url: verificationError.url
			},
			{
				message: connectionError.message,
				type: 'TYPE_CONNECTION',
				url: connectionError.url
			}
		]);
	});

	it('keeps worker issues out of the legacy archive error fields', () => {
		const baseUrl = Url.create('https://history.example.com');
		if (baseUrl.isErr()) throw baseUrl.error;

		const connectionError = new ScanError(
			ScanErrorType.TYPE_CONNECTION,
			'https://history.example.com/.well-known/stellar-history.json',
			'Could not fetch latest ledger'
		);
		const scan = new Scan(
			new Date('2026-07-01T00:00:00.000Z'),
			new Date('2026-07-01T00:00:00.000Z'),
			new Date('2026-07-01T00:01:00.000Z'),
			baseUrl.value,
			0,
			null,
			0,
			null,
			0,
			false,
			connectionError,
			[connectionError]
		);

		const dto = mapScanToHistoryArchiveScan(scan);

		expect(dto.hasError).toBe(false);
		expect(dto.errorUrl).toBeNull();
		expect(dto.errorMessage).toBeNull();
		expect(dto.errors).toEqual([
			{
				message: connectionError.message,
				type: 'TYPE_CONNECTION',
				url: connectionError.url
			}
		]);
	});
});
