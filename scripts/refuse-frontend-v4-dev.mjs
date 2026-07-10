console.error(
	'frontend-v4 development mode is disabled on this production host. ' +
		'Build with build:staging and serve the production-mode staging output instead.'
);

process.exitCode = 1;
