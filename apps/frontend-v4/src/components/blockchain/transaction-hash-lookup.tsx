'use client';

import { useState } from 'react';
import {
	lookupTransactionByHash,
	type TransactionLookupResult
} from '../../app/actions/network-data';
import { normalizeTransactionHash } from '../../domain/transaction-hash';

const initialResult: TransactionLookupResult = {
	message: null,
	status: 'invalid',
	transaction: null
};

export function TransactionHashLookup(): React.JSX.Element {
	const [hash, setHash] = useState('');
	const [result, setResult] = useState<TransactionLookupResult>(initialResult);
	const [loading, setLoading] = useState(false);
	const normalizedHash = normalizeTransactionHash(hash);

	const submitLookup = (event: React.FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		setLoading(true);
		void lookupTransactionByHash(hash)
			.then(setResult)
			.finally(() => setLoading(false));
	};

	return (
		<section className="transaction-lookup panel">
			<div className="panel-heading">
				<div>
					<strong>Transaction Lookup</strong>
					<span>Temporary external lookup source</span>
				</div>
			</div>
			<form className="transaction-lookup-form" onSubmit={submitLookup}>
				<input
					aria-label="Transaction hash"
					onChange={(event) => setHash(event.currentTarget.value)}
					placeholder="Transaction hash"
					value={hash}
				/>
				<button disabled={loading || !normalizedHash} type="submit">
					{loading ? 'Looking up' : 'Lookup'}
				</button>
			</form>
			<TransactionLookupResultView result={result} />
		</section>
	);
}

function TransactionLookupResultView({
	result
}: {
	readonly result: TransactionLookupResult;
}): React.JSX.Element | null {
	if (!result.transaction && !result.message) return null;
	if (!result.transaction) {
		return (
			<div className={`transaction-lookup-state ${result.status}`}>
				{result.message}
			</div>
		);
	}

	const { transaction } = result;
	return (
		<div className="transaction-result">
			<div>
				<strong>{transaction.hash}</strong>
				<span>{transaction.source}</span>
			</div>
			<dl>
				<div>
					<dt>Ledger</dt>
					<dd>{transaction.ledger}</dd>
				</div>
				<div>
					<dt>Created</dt>
					<dd>{new Date(transaction.createdAt).toLocaleString()}</dd>
				</div>
				<div>
					<dt>Source account</dt>
					<dd>{transaction.sourceAccount}</dd>
				</div>
				<div>
					<dt>Operations</dt>
					<dd>{transaction.operationCount}</dd>
				</div>
				<div>
					<dt>Fee</dt>
					<dd>{transaction.feeCharged}</dd>
				</div>
				<div>
					<dt>Status</dt>
					<dd>{transaction.successful ? 'Successful' : 'Failed'}</dd>
				</div>
			</dl>
		</div>
	);
}
