import type { ScpStatementReadCursor } from '../../domain/scp/ScpStatementObservationRepository.js';
import { encodeScpEvidenceCursor } from './ScpEvidenceCursor.js';
import type { ScpCompactDeliveryMetadata } from './ScpEvidenceDTO.js';

export interface ScpCompactDeliveryPolicy {
	readonly byteLimit: number;
	readonly eventLimit: number;
}

interface Rendered<T> {
	readonly bytes: number;
	readonly value: T;
}

export function buildBoundedCompactResponse<TStatement, TResponse>(
	statements: readonly TStatement[],
	policy: ScpCompactDeliveryPolicy,
	cursorFor: (statement: TStatement) => ScpStatementReadCursor | null,
	build: (
		selected: readonly TStatement[],
		delivery: ScpCompactDeliveryMetadata
	) => TResponse
): TResponse {
	const candidates = statements.slice(0, policy.eventLimit);
	let low = 0;
	let high = candidates.length;
	let best = render(0);

	while (low <= high) {
		const count = Math.floor((low + high) / 2);
		const candidate = render(count);
		if (candidate.bytes <= policy.byteLimit) {
			best = candidate;
			low = count + 1;
		} else {
			high = count - 1;
		}
	}
	return best.value;

	function render(count: number): Rendered<TResponse> {
		const selected = candidates.slice(0, count);
		const truncated = count < statements.length;
		const cursor = truncated ? selected.at(-1) : undefined;
		const nextCursor =
			cursor === undefined ? null : encodeNullableCursor(cursorFor(cursor));
		let serializedBytes = 0;
		let value = build(selected, delivery());
		for (let attempt = 0; attempt < 4; attempt += 1) {
			const measured = Buffer.byteLength(JSON.stringify(value), 'utf8');
			if (measured === serializedBytes) {
				return { bytes: measured, value };
			}
			serializedBytes = measured;
			value = build(selected, delivery());
		}
		return {
			bytes: Buffer.byteLength(JSON.stringify(value), 'utf8'),
			value
		};

		function delivery(): ScpCompactDeliveryMetadata {
			return {
				byteLimit: policy.byteLimit,
				eventCount: count,
				eventLimit: policy.eventLimit,
				nextCursor,
				serializedBytes,
				truncated
			};
		}
	}
}

function encodeNullableCursor(
	cursor: ScpStatementReadCursor | null
): string | null {
	return cursor === null ? null : encodeScpEvidenceCursor(cursor);
}
