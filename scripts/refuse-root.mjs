const command = process.argv.slice(2).join(' ') || 'command';

if (typeof process.getuid === 'function' && process.getuid() === 0) {
	console.error(
		`Refusing to run ${command} as root. Use the observe user so build artifacts stay writable.`
	);
	process.exit(1);
}
