import { Url } from 'http-helper';
import { CheckPoint } from '../check-point/CheckPointGenerator.js';
import { Category } from './Category.js';
import {
	appendHistoryArchiveRootPath,
	normalizeHistoryArchiveRootUrl
} from 'shared';

export class UrlBuilder {
	static getBucketUrl(baseUrl: Url, hash: string) {
		const prefix = UrlBuilder.getHexPrefix(hash);
		const urlOrError = Url.create(
			UrlBuilder.appendPath(baseUrl, `bucket${prefix}/bucket-${hash}.xdr.gz`)
		);
		if (urlOrError.isErr()) throw urlOrError.error;

		return urlOrError.value;
	}

	static getRootHistoryArchiveStateUrl(historyBaseUrl: Url) {
		const urlResult = Url.create(
			UrlBuilder.appendPath(historyBaseUrl, '.well-known/stellar-history.json')
		);
		if (urlResult.isErr()) throw urlResult.error;

		return urlResult.value;
	}

	static getCategoryUrl(
		historyBaseUrl: Url,
		checkPoint: CheckPoint,
		category: Category
	): Url {
		const paddedHex = UrlBuilder.getPaddedHex(checkPoint);
		const pathPrefix = UrlBuilder.getHexPrefix(paddedHex);
		const hex = UrlBuilder.getPaddedHex(checkPoint);
		const extension = UrlBuilder.getExtension(category);
		const urlResult = Url.create(
			UrlBuilder.appendPath(
				historyBaseUrl,
				`${category}${pathPrefix}/${category}-${hex}${extension}`
			)
		);
		if (urlResult.isErr()) throw urlResult.error;

		return urlResult.value;
	}

	static getHistoryArchiveStateUrl(historyBaseUrl: Url) {
		return UrlBuilder.getRootHistoryArchiveStateUrl(historyBaseUrl);
	}

	private static getBaseUrlValue(historyBaseUrl: Url): string {
		const normalizedUrl = normalizeHistoryArchiveRootUrl(historyBaseUrl.value);
		if (normalizedUrl === null) {
			throw new Error('Invalid history archive root URL');
		}

		return normalizedUrl;
	}

	private static appendPath(historyBaseUrl: Url, path: string): string {
		const value = appendHistoryArchiveRootPath(
			UrlBuilder.getBaseUrlValue(historyBaseUrl),
			path
		);
		if (value === null) throw new Error('Invalid history archive object URL');
		return value;
	}

	private static getHexPrefix(paddedHex: string): string {
		return `/${paddedHex.substr(0, 2)}/${paddedHex.substr(
			2,
			2
		)}/${paddedHex.substr(4, 2)}`;
	}

	private static getPaddedHex(ledger: number): string {
		return ledger.toString(16).padStart(8, '0');
	}

	private static getExtension(category: Category) {
		if (['results', 'transactions', 'ledger', 'scp'].includes(category))
			return '.xdr.gz';

		return '.json';
	}
}
