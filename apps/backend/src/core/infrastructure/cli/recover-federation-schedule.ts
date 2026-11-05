import { recoverFederationSchedule } from '../../../status/infrastructure/http/federation/SharedFederationScheduleStore.js';

const [confirmation, previous, replacement, ...extra] = process.argv.slice(2);
if (
	confirmation !== '--all-owners-stopped' ||
	!previous ||
	!replacement ||
	extra.length
) {
	console.error(
		'Usage: recover-federation-schedule --all-owners-stopped <old-directory> <new-sibling>'
	);
	process.exitCode = 1;
} else {
	try {
		await recoverFederationSchedule(previous, replacement, true);
		console.info(
			'Federation schedule prepared. Point every API worker to the replacement before restarting.'
		);
	} catch {
		console.error(
			'Federation schedule recovery failed. Keep all owners stopped and inspect the retired directory.'
		);
		process.exitCode = 1;
	}
}
