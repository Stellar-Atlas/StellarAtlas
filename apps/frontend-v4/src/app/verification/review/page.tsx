import { PageHeading } from '@components/layout/page-heading';
import { VerificationReview } from '@components/verification/verification-review';

export const metadata = {
	title: 'Identity review · StellarAtlas',
	robots: { index: false, follow: false }
};
export default function VerificationReviewPage(): React.JSX.Element {
	return (
		<main className="shell">
			<PageHeading
				eyebrow="Account identity"
				title="Atlas identity review"
				description="Authorized reviewers only. Applications and supporting evidence are private."
			/>
			<VerificationReview />
		</main>
	);
}
