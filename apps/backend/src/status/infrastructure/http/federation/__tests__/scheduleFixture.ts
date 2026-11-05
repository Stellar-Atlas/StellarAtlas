// Windows rejects fsync on directory handles. File sync and locking still run.
export const fixtureDirectorySync =
	process.platform === 'win32' ? async () => {} : undefined;
