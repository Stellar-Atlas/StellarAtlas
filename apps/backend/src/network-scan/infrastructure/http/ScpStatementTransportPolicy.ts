export const scpStatementTransportCeilingBytes = 262_144;
export const scpStatementDeltaByteLimit =
	scpStatementTransportCeilingBytes - 4_096;

export function isWithinScpStatementTransportCeiling(payload: string): boolean {
	return (
		Buffer.byteLength(payload, 'utf8') <= scpStatementTransportCeilingBytes
	);
}
