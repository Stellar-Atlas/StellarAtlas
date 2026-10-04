import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
export const requiredStellarProtocolVersion = 29;

export function requiredProtocolVersion(args) {
	const index = args.indexOf('--protocol');
	if (index < 0) return requiredStellarProtocolVersion;
	const value = index < 0 ? undefined : args[index + 1];
	if (!value || !/^[1-9]\d*$/.test(value)) {
		throw new Error('The --protocol value must be a positive integer');
	}
	return Number(value);
}

export function assertStellarRuntimeVersions(versions, protocol) {
	const core = /stellar-core (\d+)\./.exec(versions.core)?.[1];
	const capability = /ledger protocol version:\s*(\d+)/.exec(
		versions.core
	)?.[1];
	const horizon = /^(\d+)\./.exec(versions.horizon.trim())?.[1];
	const rpc = /stellar-rpc (\d+)\./.exec(versions.rpc)?.[1];
	if (
		![core, capability, horizon, rpc].every(
			(value) => Number(value) === protocol
		)
	) {
		throw new Error(
			`Stellar runtime mismatch: requested protocol ${protocol}; Core ${core ?? 'unknown'} ` +
				`(capability ${capability ?? 'unknown'}), Horizon ${horizon ?? 'unknown'}, RPC ${rpc ?? 'unknown'}`
		);
	}
	return {
		protocol,
		core: Number(core),
		horizon: Number(horizon),
		rpc: Number(rpc)
	};
}

export async function verifyStellarRuntimeVersions(dataRoot, protocol) {
	const env = {
		...process.env,
		LD_LIBRARY_PATH:
			process.env.LD_LIBRARY_PATH ??
			join(dataRoot, 'stellar-core/runtime/usr/lib/x86_64-linux-gnu')
	};
	const [core, horizon, rpc] = await Promise.all(
		[
			'stellar-core/bin/stellar-core',
			'horizon/bin/horizon',
			'stellar-rpc/bin/stellar-rpc'
		].map(
			async (binary) =>
				(
					await execute(join(dataRoot, binary), ['version'], {
						env,
						timeout: 15_000,
						maxBuffer: 128 * 1024
					})
				).stdout
		)
	);
	return assertStellarRuntimeVersions({ core, horizon, rpc }, protocol);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	const args = process.argv.slice(2);
	const index = args.indexOf('--data-root');
	if (index < 0 || !args[index + 1])
		throw new Error('Pass --data-root for the deployed runtime');
	console.log(
		JSON.stringify(
			await verifyStellarRuntimeVersions(
				args[index + 1],
				requiredProtocolVersion(args)
			)
		)
	);
}
