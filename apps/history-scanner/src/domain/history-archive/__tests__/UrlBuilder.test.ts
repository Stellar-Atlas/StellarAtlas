import { UrlBuilder } from '../UrlBuilder.js';
import { Url } from 'http-helper';
import { createDummyHistoryBaseUrl } from '../__fixtures__/HistoryBaseUrl.js';
import { Category } from '../Category.js';

it('should return ledger url', function () {
	const historyBaseUrl = Url.create('https://history.stellar.org');
	if (historyBaseUrl.isErr()) throw historyBaseUrl.error;

	const url = UrlBuilder.getCategoryUrl(
		historyBaseUrl.value,
		39279103,
		Category.ledger
	);

	expect(url.value).toEqual(
		'https://history.stellar.org/ledger/02/57/59/ledger-025759ff.xdr.gz'
	);
});

it('should construct category urls from normalized root history archive state urls', function () {
	const historyBaseUrl = Url.create(
		'https://history.stellar.org/archive/.well-known/stellar-history.json'
	);
	if (historyBaseUrl.isErr()) throw historyBaseUrl.error;

	const url = UrlBuilder.getCategoryUrl(
		historyBaseUrl.value,
		63,
		Category.history
	);

	expect(url.value).toEqual(
		'https://history.stellar.org/archive/history/00/00/00/history-0000003f.json'
	);
});

it('should generate correct bucket url', function () {
	const url = createDummyHistoryBaseUrl();
	expect(
		UrlBuilder.getBucketUrl(
			url,
			'bd96d76dec3196938aa7acb8116ddb5e442201032ab32dfb5af30fb8563c04d5'
		).value
	).toEqual(
		url.value +
			'/bucket/bd/96/d7/bucket-bd96d76dec3196938aa7acb8116ddb5e442201032ab32dfb5af30fb8563c04d5.xdr.gz'
	);
});

it('should reject archive object urls as base urls', function () {
	const historyBaseUrl = Url.create(
		'https://history.stellar.org/archive/history/00/00/00/history-0000003f.json'
	);
	if (historyBaseUrl.isErr()) throw historyBaseUrl.error;

	expect(() =>
		UrlBuilder.getRootHistoryArchiveStateUrl(historyBaseUrl.value)
	).toThrow('Invalid history archive root URL');
});
