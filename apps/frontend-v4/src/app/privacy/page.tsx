import type { Metadata } from 'next';
import { AtlasAnalyticsPreference } from '../../components/atlas-analytics';
import { PageHeading } from '../../components/layout/page-heading';

export const metadata: Metadata = { title: 'Privacy · StellarAtlas' };

export default function PrivacyPage(): React.JSX.Element {
	return (
		<main className="shell">
			<PageHeading title="Privacy" eyebrow="StellarAtlas"
				description="How we measure use of the site and API." />
			<section aria-labelledby="analytics-heading">
				<h2 id="analytics-heading">Usage analytics</h2>
				<p>We use cookieless analytics to measure site visits and use of Explorer features.
					Analytics uses your browser details and network address to count visits without
					storing your raw IP address. It receives general page labels and eligible referral domains,
					not wallet addresses, transaction hashes, searches or full referral URLs.</p>
				<p>You can turn analytics off for this browser. We also respect Global Privacy Control.
					The setting is saved in this browser only.</p>
				<AtlasAnalyticsPreference />
				<p>We count API requests and errors separately, without identifying callers.</p>
			</section>
		</main>
	);
}
