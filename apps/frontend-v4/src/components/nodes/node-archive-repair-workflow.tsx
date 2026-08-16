'use client';

import { useState } from 'react';
import type { PublicHistoryArchiveRepairPlan } from '@api/archive-repair-types';
import { formatInteger } from '@format/formatters';

type RepairAction = PublicHistoryArchiveRepairPlan['actions'][number];

const downloadCommand =
	'curl --fail-with-body --user "$STELLARATLAS_OPERATOR_USER:$STELLARATLAS_OPERATOR_PASSWORD" --output "$STAGE_PATH" "$STELLARATLAS_BASE_URL$REPLACEMENT_DOWNLOAD_PATH"';
const secureStageCommand =
	'umask 077; export STAGE_PATH="$(mktemp --tmpdir="$(dirname -- "$TARGET_PATH")" .stellaratlas-repair.XXXXXXXX)" || { echo "STOP: secure same-directory stage creation failed" >&2; exit 1; }; test -f "$STAGE_PATH" && test ! -L "$STAGE_PATH" || { echo "STOP: stage is not a regular no-follow file" >&2; exit 1; }';
const verifyCommand =
	'node scripts/verify-history-archive-repair-artifact.mjs --file "$STAGE_PATH" --digest "$EXPECTED_CONTENT_SHA256" --representation "$CONTENT_REPRESENTATION"';
const verifyWithLengthCommand = `${verifyCommand} --byte-length "$EXPECTED_TRANSPORT_BYTE_LENGTH"`;
const missingTargetPreconditionCommand =
	'if [ -L "$TARGET_PATH" ] || [ -e "$TARGET_PATH" ]; then echo "STOP: missing target appeared" >&2; exit 1; fi';
const corruptTargetPreconditionCommand =
	'if [ -L "$TARGET_PATH" ] || [ ! -f "$TARGET_PATH" ]; then echo "STOP: expected regular target is absent or a symlink" >&2; exit 1; fi; if [ -L "$BACKUP_PATH" ] || [ -e "$BACKUP_PATH" ]; then echo "STOP: choose a fresh BACKUP_PATH" >&2; exit 1; fi; TARGET_IDENTITY="$(stat -c %d:%i:%s:%Y:%f:%u:%g -- "$TARGET_PATH")"; ln -T -- "$TARGET_PATH" "$BACKUP_PATH" || { echo "STOP: no-clobber backup failed" >&2; exit 1; }; test "$(stat -c %d:%i:%s:%Y:%f:%u:%g -- "$TARGET_PATH")" = "$TARGET_IDENTITY" || { echo "STOP: target changed while backing up" >&2; exit 1; }; export TARGET_STAT="$(stat -c %d:%i:%s:%Y:%Z:%f:%u:%g -- "$TARGET_PATH")"';
const missingMetadataCommand =
	'test "$ARCHIVE_DEFAULT_METADATA_APPLIED" = yes || { echo "STOP: apply and review backend owner, mode, ACL, and content headers on STAGE_PATH" >&2; exit 1; }';
const corruptMetadataCommand =
	'cp --attributes-only --preserve=all -- "$TARGET_PATH" "$STAGE_PATH" || { echo "STOP: metadata copy failed" >&2; exit 1; }';
const missingAtomicInstallCommand =
	'if [ -L "$TARGET_PATH" ] || [ -e "$TARGET_PATH" ]; then echo "STOP: target appeared after precheck" >&2; exit 1; fi; ln -T -- "$STAGE_PATH" "$TARGET_PATH" || { echo "STOP: atomic no-clobber install failed" >&2; exit 1; }; rm -- "$STAGE_PATH" || { echo "TARGET INSTALLED: stage cleanup failed; do not repeat promotion" >&2; exit 1; }';
const corruptAtomicInstallCommand =
	'if [ -L "$TARGET_PATH" ] || [ ! -f "$TARGET_PATH" ]; then echo "STOP: target vanished or changed type" >&2; exit 1; fi; test "$(stat -c %d:%i:%s:%Y:%Z:%f:%u:%g -- "$TARGET_PATH")" = "$TARGET_STAT" || { echo "STOP: target changed after backup" >&2; exit 1; }; test "$(stat -c %d -- "$STAGE_PATH")" = "$(stat -c %d -- "$TARGET_PATH")" || { echo "STOP: stage and target are on different filesystems" >&2; exit 1; }; mv -T -- "$STAGE_PATH" "$TARGET_PATH" || { echo "STOP: same-filesystem rename failed" >&2; exit 1; }';
const recheckCommand =
	'jq -n --arg observed "$MINIMUM_EVIDENCE_UPDATED_AT" \'{minimumEvidenceUpdatedAt:$observed}\' | curl --fail-with-body --user "$STELLARATLAS_OPERATOR_USER:$STELLARATLAS_OPERATOR_PASSWORD" --request POST --header "Content-Type: application/json" --data-binary @- "$STELLARATLAS_BASE_URL$RECHECK_ENDPOINT"';
const archivistRepairCommand =
	'stellar-archivist repair "$KNOWN_FULL_SOURCE_ROOT_URL" "$TARGET_ARCHIVE_ROOT_URL"';
const archivistScanCommand =
	'stellar-archivist scan "$TARGET_ARCHIVE_ROOT_URL"';

export function ProofBoundRepairWorkflow({
	action
}: {
	readonly action: RepairAction;
}): React.JSX.Element | null {
	const manifest = action.repairManifest;
	if (manifest?.status !== 'ready' || manifest.replacement === null)
		return null;
	const relativePath = getValidatedArchiveRelativePath(
		manifest.target.archiveUrl,
		manifest.target.objectUrl
	);
	const artifact = manifest.replacement.artifact;
	const proof = manifest.replacement.source.proof;
	const missingTarget = manifest.evidence.failureClass === 'not-found';

	return (
		<section aria-label="Proof-bound operator workflow">
			<p>
				This workflow never changes the archive automatically. Supply and review
				each local variable yourself; the commands contain quoted variable
				tokens and do not interpolate archive data into executable shell.
			</p>
			<p role="alert">
				Quiesce Stellar Core and every publisher or writer for the target
				archive before the precondition step, and keep them stopped through
				promotion. Run the precondition, metadata, and promotion commands in one
				shell so the exported <code>TARGET_STAT</code> guard remains bound to
				this action.
			</p>
			<dl>
				<OperatorValue
					label="Validated archive-relative path"
					value={relativePath}
				/>
				<OperatorValue
					label="Replacement download path"
					value={artifact.downloadUrl}
				/>
				<OperatorValue
					label="Expected logical SHA-256"
					value={artifact.contentHash.digest}
				/>
				<OperatorValue
					label="Digest representation"
					value={artifact.contentHash.representation}
				/>
				<OperatorValue
					label="Expected transport bytes"
					value={
						artifact.byteLength === null
							? null
							: formatInteger(artifact.byteLength)
					}
				/>
				<OperatorValue
					label="Strict source proof"
					value={`proof ${proof.proofId} v${proof.proofVersion} at ${proof.evaluatedAt}`}
				/>
			</dl>
			{relativePath === null ? (
				<p role="alert">
					The object URL did not produce a traversal-safe path below the archive
					root. Stop and map the target path through the archive backend; do not
					guess from the URL.
				</p>
			) : null}
			<ol>
				<li>
					{missingTarget
						? 'Fail closed unless the target is still absent.'
						: 'Require a regular unchanged target, create a fresh no-clobber hard-link backup, then record the post-backup stat tuple. A missing target, symlink, changed identity, or existing backup stops the workflow.'}
					<CopyableCommand
						command={
							missingTarget
								? missingTargetPreconditionCommand
								: corruptTargetPreconditionCommand
						}
					/>
				</li>
				<li>
					Securely create a random, mode-0600 stage in the reviewed target
					directory, then download through the operator-authenticated
					proof-bound endpoint. Do not provide a pre-existing stage path.
					<CopyableCommand command={secureStageCommand} />
					<CopyableCommand command={downloadCommand} />
				</li>
				<li>
					Verify the logical representation and transport length with the
					shipped read-only verifier. It hashes gunzipped bytes for XDR and
					recursively key-sorted JSON for canonical JSON; it preserves the
					original archive file bytes.
					<CopyableCommand
						command={
							artifact.byteLength === null
								? verifyCommand
								: verifyWithLengthCommand
						}
					/>
				</li>
				<li>
					Apply archive-backend owner, mode, ACL, and content headers to the
					staged file before promotion. For a missing target, use reviewed
					archive defaults; there is no existing metadata to copy.
					<CopyableCommand
						command={
							missingTarget ? missingMetadataCommand : corruptMetadataCommand
						}
					/>
				</li>
				<li>
					Promote only while writers remain quiesced. Missing targets use an
					atomic no-clobber hard link; corrupt targets recheck the recorded stat
					tuple immediately before a same-filesystem rename. Any mismatch stops.
					<CopyableCommand
						command={
							missingTarget
								? missingAtomicInstallCommand
								: corruptAtomicInstallCommand
						}
					/>
				</li>
			</ol>
			<GuardedRecheck action={action} />
		</section>
	);
}

function OperatorValue({
	label,
	value
}: {
	readonly label: string;
	readonly value: string | null;
}): React.JSX.Element {
	return (
		<>
			<dt>{label}</dt>
			<dd>
				{value === null ? (
					<span className="muted-inline">not safely derivable</span>
				) : (
					<>
						<code>{value}</code> <CopyButton value={value} />
					</>
				)}
			</dd>
		</>
	);
}

function CopyableCommand({ command }: { readonly command: string }) {
	return (
		<div>
			<pre>
				<code>{command}</code>
			</pre>
			<CopyButton label="Copy command" value={command} />
		</div>
	);
}

function CopyButton({
	label = 'Copy value',
	value
}: {
	readonly label?: string;
	readonly value: string;
}): React.JSX.Element {
	const [copied, setCopied] = useState(false);
	return (
		<button
			onClick={() => {
				void navigator.clipboard.writeText(value).then(() => setCopied(true));
			}}
			type="button"
		>
			{copied ? 'Copied' : label}
		</button>
	);
}

function GuardedRecheck({ action }: { readonly action: RepairAction }) {
	const [confirmed, setConfirmed] = useState(false);
	const manifest = action.repairManifest;
	if (manifest?.replacement === null || manifest === null) return null;
	const proof = manifest.replacement.source.proof;
	return (
		<section aria-label="Guarded repair recheck">
			<h4>Guarded recheck</h4>
			<OperatorValue
				label="Recheck endpoint"
				value={manifest.recheck.endpoint}
			/>
			<OperatorValue
				label="Minimum evidence timestamp"
				value={manifest.recheck.minimumEvidenceUpdatedAt}
			/>
			<label>
				<input
					checked={confirmed}
					onChange={(event) => setConfirmed(event.currentTarget.checked)}
					type="checkbox"
				/>{' '}
				I confirmed the installed file matches proof {proof.proofId} v
				{proof.proofVersion}, the logical digest above, and this manifest&apos;s
				evidence timestamp. I will regenerate the plan if any value changed.
			</label>
			<pre>
				<code>{recheckCommand}</code>
			</pre>
			<button
				disabled={!confirmed}
				onClick={() => void navigator.clipboard.writeText(recheckCommand)}
				type="button"
			>
				Copy guarded recheck command
			</button>
		</section>
	);
}

export function ArchivistWholeArchiveOption(): React.JSX.Element {
	return (
		<details>
			<summary>Optional broader whole-archive remediation</summary>
			<p>
				This is separate from the proof-bound file action and may change more
				archive objects. Stop or quiesce Stellar Core and every archive
				publisher first. Supply a known-full source archive ROOT URL and a
				writable target archive ROOT URL (for example, <code>file://</code> or{' '}
				<code>s3://</code>) explicitly; the repair manifest is not an Archivist
				input.
			</p>
			<CopyableCommand command={archivistRepairCommand} />
			<CopyableCommand command={archivistScanCommand} />
		</details>
	);
}

export function getValidatedArchiveRelativePath(
	archiveUrl: string,
	objectUrl: string
): string | null {
	try {
		const archive = new URL(archiveUrl);
		const object = new URL(objectUrl);
		if (!['http:', 'https:'].includes(archive.protocol)) return null;
		if (archive.origin !== object.origin) return null;
		const root = archive.pathname.replace(/\/+$/, '');
		if (!object.pathname.startsWith(`${root}/`)) return null;
		const relative = object.pathname.slice(root.length + 1);
		if (relative.length === 0 || relative.length > 2048) return null;
		const decoded = decodeURIComponent(relative);
		if (
			relative.includes('%') ||
			decoded.includes('\\') ||
			Array.from(decoded).some((character) => {
				const code = character.codePointAt(0) ?? 0;
				return code < 32 || code === 127;
			})
		) {
			return null;
		}
		const segments = decoded.split('/');
		if (
			segments.some(
				(segment) => segment === '' || segment === '.' || segment === '..'
			)
		) {
			return null;
		}
		return relative;
	} catch {
		return null;
	}
}
