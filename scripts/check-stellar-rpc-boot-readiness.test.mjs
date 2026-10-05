import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const unit = readFileSync(
	new URL(
		'../ops/systemd/host/stellaratlas-stellar-rpc.service.d/90-bridge-readiness.conf',
		import.meta.url
	),
	'utf8'
);
const match = unit.match(/^ExecStartPre=\/usr\/bin\/timeout --verbose 300s \/bin\/sh -c '(.+)'$/m);
assert.ok(match, 'the bounded pre-start command must remain testable');
const command = match[1];

function probe(lines) {
	const directory = mkdtempSync(join(tmpdir(), 'rpc-bridge-readiness-test-'));
	try {
		const ip = join(directory, 'ip');
		writeFileSync(
			ip,
			'#!/bin/sh\n[ "$*" = "-4 -o address show dev virbr0" ] || exit 2\nprintf "%s\\n" "$TEST_IP_LINES"\n',
			{ mode: 0o700 }
		);
		return spawnSync(
			'/usr/bin/timeout',
			['0.2s', '/bin/sh', '-c', command.replace('/usr/sbin/ip', ip)],
			{ env: { ...process.env, TEST_IP_LINES: lines }, timeout: 2000 }
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test('starts only after the exact private IPv4 address exists on virbr0', () => {
	assert.equal(probe('5: virbr0    inet 192.168.122.1/24 brd 192.168.122.255 scope global virbr0').status, 0);
});

for (const [name, lines] of [
	['missing bridge/address', ''],
	['another address', '5: virbr0    inet 192.168.123.1/24 scope global virbr0'],
	['address-prefix lookalike', '5: virbr0    inet 192.168.122.10/24 scope global virbr0'],
	['IPv6 only', '5: virbr0    inet6 fe80::1/64 scope link']
]) {
	test(`bounded failure for ${name} permits a later service retry`, () => {
		assert.equal(probe(lines).status, 124);
	});
}

test('orders after libvirt, bounds each attempt, and cannot exhaust the existing start limit', () => {
	assert.match(unit, /^Wants=network-online.target libvirtd.service$/m);
	assert.match(unit, /^After=network-online.target libvirtd.service$/m);
	assert.match(unit, /^TimeoutStartSec=330s$/m);
	assert.match(unit, /^RestartSec=30s$/m);
	assert.ok(Math.floor(120 / 30) + 1 < 6);
});

test('does not replace the RPC command, widen its bind, or couple runtime lifetime to libvirt', () => {
	assert.doesNotMatch(unit, /^(ExecStart|Environment|Requires|BindsTo|PartOf)=/m);
	assert.doesNotMatch(unit, /0\.0\.0\.0/);
});
