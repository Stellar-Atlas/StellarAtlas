import { PageHeading } from '@components/layout/page-heading';
import { VerificationApplication } from '@components/verification/verification-application';

export default function VerificationPage(): React.JSX.Element {
	return (
		<main className="shell">
			<PageHeading
				eyebrow="Account identity"
				title="Atlas verification"
				description="Apply for an account identity reviewed and verified by StellarAtlas."
			/>
			<VerificationApplication />
			<p>
				<a href="/verification/review">Reviewer sign-in</a>
			</p>
		</main>
	);
}
