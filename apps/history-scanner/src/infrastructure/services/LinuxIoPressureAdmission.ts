import { readFile } from 'node:fs/promises';
import type { Logger } from 'logger';

export interface HistoryArchiveIoPressureAdmissionConfig {
	readonly enabled: boolean;
	readonly fullAvg10Maximum: number;
	readonly healthySamplesRequired?: number;
	readonly md0InflightMaximum?: number | null;
	readonly retryIntervalMs: number;
	readonly someAvg10Maximum: number;
}

export interface HistoryArchiveClaimAdmission {
	waitUntilAdmitted(signal: AbortSignal): Promise<void>;
}

export interface LinuxIoPressureSample {
	readonly fullAvg10: number;
	readonly someAvg10: number;
}

export interface LinuxIoPressureSampler {
	sample(): Promise<LinuxIoPressureSample>;
}

export interface LinuxBlockDeviceInflightSample {
	readonly readRequests: number;
	readonly totalRequests: number;
	readonly writeRequests: number;
}

export interface LinuxBlockDeviceInflightSampler {
	sample(): Promise<LinuxBlockDeviceInflightSample>;
}

export type AdmissionSleep = (
	delayMs: number,
	signal: AbortSignal
) => Promise<void>;

function parseAvg10(line: string, kind: 'full' | 'some'): number {
	const fields = line.trim().split(/\s+/);
	if (fields[0] !== kind)
		throw new Error(`Missing Linux I/O pressure ${kind} line`);
	const avg10Fields = fields.filter((field) => field.startsWith('avg10='));
	if (avg10Fields.length !== 1)
		throw new Error(`Missing Linux I/O pressure ${kind} avg10`);

	const encodedValue = avg10Fields[0]!.slice('avg10='.length);
	if (!/^\d+(?:\.\d+)?$/.test(encodedValue)) {
		throw new Error(`Invalid Linux I/O pressure ${kind} avg10`);
	}
	const value = Number(encodedValue);
	if (!Number.isFinite(value) || value < 0 || value > 100) {
		throw new Error(`Invalid Linux I/O pressure ${kind} avg10`);
	}
	return value;
}

export function parseLinuxIoPressure(contents: string): LinuxIoPressureSample {
	const lines = contents
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const someLines = lines.filter((line) => line.startsWith('some '));
	const fullLines = lines.filter((line) => line.startsWith('full '));
	if (someLines.length !== 1 || fullLines.length !== 1) {
		throw new Error('Invalid Linux I/O pressure document');
	}

	return {
		fullAvg10: parseAvg10(fullLines[0]!, 'full'),
		someAvg10: parseAvg10(someLines[0]!, 'some')
	};
}

export class ProcLinuxIoPressureSampler implements LinuxIoPressureSampler {
	constructor(private readonly path = '/proc/pressure/io') {}

	async sample(): Promise<LinuxIoPressureSample> {
		return parseLinuxIoPressure(await readFile(this.path, 'utf8'));
	}
}

function parseNonNegativeInteger(value: string, field: string): number {
	if (!/^\d+$/.test(value)) {
		throw new Error(`Invalid Linux block-device ${field} in-flight count`);
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new Error(`Invalid Linux block-device ${field} in-flight count`);
	}
	return parsed;
}

export function parseLinuxBlockDeviceInflight(
	contents: string
): LinuxBlockDeviceInflightSample {
	const fields = contents.trim().split(/\s+/);
	if (fields.length !== 2 || fields.some((field) => field.length === 0)) {
		throw new Error('Invalid Linux block-device in-flight document');
	}

	const readRequests = parseNonNegativeInteger(fields[0]!, 'read');
	const writeRequests = parseNonNegativeInteger(fields[1]!, 'write');
	const totalRequests = readRequests + writeRequests;
	if (!Number.isSafeInteger(totalRequests)) {
		throw new Error('Invalid Linux block-device total in-flight count');
	}

	return { readRequests, totalRequests, writeRequests };
}

export class SysfsLinuxBlockDeviceInflightSampler implements LinuxBlockDeviceInflightSampler {
	constructor(private readonly path = '/sys/block/md0/inflight') {}

	async sample(): Promise<LinuxBlockDeviceInflightSample> {
		return parseLinuxBlockDeviceInflight(await readFile(this.path, 'utf8'));
	}
}

export async function abortableAdmissionSleep(
	delayMs: number,
	signal: AbortSignal
): Promise<void> {
	if (signal.aborted) return;
	await new Promise<void>((resolve) => {
		const timer = setTimeout(finish, delayMs);
		function finish(): void {
			clearTimeout(timer);
			signal.removeEventListener('abort', finish);
			resolve();
		}
		signal.addEventListener('abort', finish, { once: true });
		if (signal.aborted) finish();
	});
}

function mapErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class LinuxIoPressureAdmission implements HistoryArchiveClaimAdmission {
	private activeAdmission: Promise<void> | null = null;
	private paused = false;

	constructor(
		private readonly config: HistoryArchiveIoPressureAdmissionConfig,
		private readonly logger: Logger,
		private readonly sampler: LinuxIoPressureSampler = new ProcLinuxIoPressureSampler(),
		private readonly sleep: AdmissionSleep = abortableAdmissionSleep,
		private readonly inflightSampler: LinuxBlockDeviceInflightSampler = new SysfsLinuxBlockDeviceInflightSampler()
	) {}

	async waitUntilAdmitted(signal: AbortSignal): Promise<void> {
		if (!this.config.enabled || signal.aborted) return;
		const activeAdmission = this.activeAdmission;
		if (activeAdmission !== null) {
			await activeAdmission;
			return;
		}

		const admission = this.waitForAcceptablePressure(signal);
		this.activeAdmission = admission;
		try {
			await admission;
		} finally {
			if (this.activeAdmission === admission) this.activeAdmission = null;
		}
	}

	private async waitForAcceptablePressure(signal: AbortSignal): Promise<void> {
		let consecutiveHealthySamples = 0;
		while (!signal.aborted) {
			try {
				const sample = await this.sampleAdmissionInputs();
				if (!this.exceedsMaximum(sample)) {
					if (!this.paused) return;
					consecutiveHealthySamples++;
					if (consecutiveHealthySamples >= this.healthySamplesRequired) {
						this.paused = false;
						this.logResumed(sample, consecutiveHealthySamples);
						return;
					}
				} else {
					consecutiveHealthySamples = 0;
					if (!this.paused) this.logPressureDelay(sample);
					this.paused = true;
				}
			} catch (error) {
				consecutiveHealthySamples = 0;
				if (!this.paused) this.logUnavailableDelay(error);
				this.paused = true;
			}
			await this.sleep(this.config.retryIntervalMs, signal);
		}
	}

	private get healthySamplesRequired(): number {
		return this.config.healthySamplesRequired ?? 1;
	}

	private get md0InflightMaximum(): number | null {
		return this.config.md0InflightMaximum ?? null;
	}

	private async sampleAdmissionInputs(): Promise<AdmissionInputSample> {
		const md0InflightMaximum = this.md0InflightMaximum;
		if (md0InflightMaximum === null) {
			return {
				ioPressure: await this.sampler.sample(),
				md0Inflight: null
			};
		}

		const [ioPressure, md0Inflight] = await Promise.all([
			this.sampler.sample(),
			this.inflightSampler.sample()
		]);
		return { ioPressure, md0Inflight };
	}

	private exceedsMaximum(sample: AdmissionInputSample): boolean {
		const md0InflightMaximum = this.md0InflightMaximum;
		return (
			sample.ioPressure.fullAvg10 > this.config.fullAvg10Maximum ||
			sample.ioPressure.someAvg10 > this.config.someAvg10Maximum ||
			(md0InflightMaximum !== null &&
				sample.md0Inflight !== null &&
				sample.md0Inflight.totalRequests > md0InflightMaximum)
		);
	}

	private logPressureDelay(sample: AdmissionInputSample): void {
		this.logger.warn('Pausing new history archive claims for I/O pressure', {
			fullAvg10: sample.ioPressure.fullAvg10,
			fullAvg10Maximum: this.config.fullAvg10Maximum,
			healthySamplesRequired: this.healthySamplesRequired,
			...(sample.md0Inflight === null
				? {}
				: {
						md0InflightMaximum: this.md0InflightMaximum,
						md0ReadInflight: sample.md0Inflight.readRequests,
						md0TotalInflight: sample.md0Inflight.totalRequests,
						md0WriteInflight: sample.md0Inflight.writeRequests
					}),
			retryIntervalMs: this.config.retryIntervalMs,
			someAvg10: sample.ioPressure.someAvg10,
			someAvg10Maximum: this.config.someAvg10Maximum
		});
	}

	private logUnavailableDelay(error: unknown): void {
		this.logger.warn(
			'Pausing new history archive claims because I/O admission inputs are unavailable',
			{
				errorMessage: mapErrorMessage(error),
				healthySamplesRequired: this.healthySamplesRequired,
				md0InflightMaximum: this.md0InflightMaximum,
				retryIntervalMs: this.config.retryIntervalMs
			}
		);
	}

	private logResumed(
		sample: AdmissionInputSample,
		consecutiveHealthySamples: number
	): void {
		this.logger.info('Resuming history archive claims after I/O pressure', {
			consecutiveHealthySamples,
			fullAvg10: sample.ioPressure.fullAvg10,
			...(sample.md0Inflight === null
				? {}
				: {
						md0ReadInflight: sample.md0Inflight.readRequests,
						md0TotalInflight: sample.md0Inflight.totalRequests,
						md0WriteInflight: sample.md0Inflight.writeRequests
					}),
			someAvg10: sample.ioPressure.someAvg10
		});
	}
}

interface AdmissionInputSample {
	readonly ioPressure: LinuxIoPressureSample;
	readonly md0Inflight: LinuxBlockDeviceInflightSample | null;
}
