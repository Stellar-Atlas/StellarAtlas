// Shared with the cluster supervisor; leave half the grace for NAK/drain/teardown.
export const archiveObjectShutdownTimeoutMs = 30_000;
export const archiveObjectTerminalDrainTimeoutMs =
	archiveObjectShutdownTimeoutMs / 2;
