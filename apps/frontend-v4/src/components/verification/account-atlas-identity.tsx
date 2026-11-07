'use client';
import { useEffect, useState } from 'react';
import { isClassicAccount } from '../../domain/classic-account';
import {
	readAtlasIdentity,
	requestVerification,
	type AtlasIdentity,
	type VerificationNetwork
} from '../../api/atlas-verification';
import { LocalDateTime } from '../local-date-time';

type IdentityState =
	| { readonly status: 'loading' | 'unavailable' }
	| { readonly status: 'loaded'; readonly identity: AtlasIdentity | null };
/** Mounted only on a single focused account, never on result rows. */
export function AccountAtlasIdentity({
	address,
	network
}: {
	readonly address: string;
	readonly network: VerificationNetwork;
}): React.JSX.Element | null {
	if (!isClassicAccount(address)) return null;
	return (
		<IdentityLookup
			key={network + '/' + address}
			address={address}
			network={network}
		/>
	);
}
export function IdentityLookup({
	address,
	network
}: {
	readonly address: string;
	readonly network: VerificationNetwork;
}): React.JSX.Element {
	const [state, setState] = useState<IdentityState>({ status: 'loading' });
	useEffect(() => {
		const controller = new AbortController();
		queueMicrotask(() => {
			if (controller.signal.aborted) return;
			void requestVerification('/' + network + '/' + address, controller.signal)
				.then((body) => {
					const identity = readAtlasIdentity(body, network, address);
					if (!controller.signal.aborted)
						setState({ status: 'loaded', identity });
				})
				.catch(() => {
					if (!controller.signal.aborted) setState({ status: 'unavailable' });
				});
		});
		return () => controller.abort();
	}, [address, network]);
	return <AtlasIdentityView state={state} />;
}
export function AtlasIdentityView({
	state
}: {
	readonly state: IdentityState;
}): React.JSX.Element {
	const identity = state.status === 'loaded' ? state.identity : null;
	return (
		<section
			className="explorer-result-stack"
			aria-label="Atlas account identity"
		>
			<h2>Atlas identity</h2>
			{identity ? (
				<>
					<p>
						<strong>Verified by Atlas</strong> · <bdi>{identity.name}</bdi>
					</p>
					<dl className="explorer-result-grid">
						<div>
							<dt>Website</dt>
							<dd>
								<a
									href={identity.website}
									target="_blank"
									rel="noopener noreferrer"
								>
									{identity.website}
								</a>
							</dd>
						</div>
						<div>
							<dt>Reviewed</dt>
							<dd>
								<LocalDateTime dateTime={identity.verifiedAt} />
							</dd>
						</div>
					</dl>
					<p>Identity review, not an endorsement.</p>
				</>
			) : (
				<p role="status">
					{state.status === 'loading'
						? 'Checking Atlas identity…'
						: state.status === 'unavailable'
							? 'Atlas identity lookup unavailable.'
							: 'No approved Atlas identity.'}
				</p>
			)}
			<a href="/verification">About Atlas verification</a>
		</section>
	);
}
