#!/usr/bin/env python3
"""Build the pinned Stellar RPC correction in a new Linux workspace."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workspace', type=Path, help='New directory for source and output')
    args = parser.parse_args()
    package = Path(__file__).resolve().parent
    inputs = json.loads((package / 'build-inputs.json').read_text())
    patch = package / inputs['patch']['path']
    if hashlib.sha256(patch.read_bytes()).hexdigest() != inputs['patch']['sha256']:
        raise SystemExit('Patch digest does not match build inputs')
    go = shutil.which('go')
    cargo = shutil.which('cargo')
    rustc = shutil.which('rustc')
    if not all((go, cargo, rustc)):
        raise SystemExit('Go, Cargo, and rustc must be available on PATH')
    for tool, expected in ((go, inputs['tools']['go']), (cargo, inputs['tools']['cargo']), (rustc, inputs['tools']['rustc'])):
        actual = subprocess.check_output([tool, 'version' if tool == go else '--version'], text=True).strip()
        if actual != expected:
            raise SystemExit(f'Expected {expected}; found {actual}')
    args.workspace.mkdir(parents=True, exist_ok=False)
    work = args.workspace.resolve()
    source = work / 'source'
    source.mkdir()

    def run(command, cwd=source, env=None):
        subprocess.run(command, cwd=cwd, env=env, check=True)

    run(['git', 'init', '--quiet'])
    run(['git', '-c', 'gc.auto=0', 'fetch', '--depth=1', inputs['upstream']['repository'], inputs['upstream']['commit']])
    run(['git', 'checkout', '--detach', '--quiet', 'FETCH_HEAD'])
    run(['git', 'apply', '--index', str(patch)])
    tree = subprocess.check_output(['git', 'write-tree'], cwd=source, text=True).strip()
    if tree != inputs['correctedSource']['tree']:
        raise SystemExit('Patched source tree does not match the reviewed source')
    for name, digest in inputs['locks'].items():
        if hashlib.sha256((source / name).read_bytes()).hexdigest() != digest:
            raise SystemExit(f'Unexpected dependency lock: {name}')
    env = os.environ.copy()
    env.update(GOTOOLCHAIN='local', GOENV='off', GOWORK='off', GOTELEMETRY='off', GOOS='linux', GOARCH='amd64', GOAMD64='v1', CGO_ENABLED='1', GOFLAGS='-mod=readonly', RUSTFLAGS='-Dwarnings -Dclippy::all -Dclippy::pedantic', RUSTC=rustc)
    env['CARGO_TARGET_DIR'] = str(source / 'target')
    env.setdefault('CARGO_BUILD_JOBS', '4')
    env.setdefault('GOMAXPROCS', '4')
    # Resolve only the recorded lock before using Cargo's frozen build mode.
    run([cargo, 'fetch', '--locked', '--target', inputs['target']], env=env)
    for library in ('preflight', 'xdr2json'):
        run([cargo, 'build', '--frozen', '--target', inputs['target'], '--profile', inputs['profile']], cwd=source / 'cmd/stellar-rpc/lib' / library, env=env)
    values = inputs['versionFields']
    prefix = 'github.com/stellar/stellar-rpc/cmd/stellar-rpc/internal/config.'
    flags = ' '.join('-X ' + prefix + key + '=' + value for key, value in values.items())
    binary = work / 'stellar-rpc'
    run([go, 'build', '-buildvcs=false', '-trimpath', '-ldflags', flags, '-o', str(binary), './cmd/stellar-rpc'], env=env)
    for name, digest in inputs['locks'].items():
        if hashlib.sha256((source / name).read_bytes()).hexdigest() != digest:
            raise SystemExit(f'Dependency lock changed during build: {name}')
    record = dict(source=inputs['correctedSource']['commit'], tree=tree, sha256=hashlib.sha256(binary.read_bytes()).hexdigest(), bytes=binary.stat().st_size, versionFields=values)
    (work / 'build-result.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    main()
