export const scanErrorTypes = ['TYPE_VERIFICATION', 'TYPE_CONNECTION'] as const;

export type ScanErrorTypeDTO = (typeof scanErrorTypes)[number];

export interface ScanErrorDTO {
	type: ScanErrorTypeDTO;
	url: string;
	message: string;
}

export function isScanErrorTypeDTO(value: unknown): value is ScanErrorTypeDTO {
	return scanErrorTypes.includes(value as ScanErrorTypeDTO);
}
