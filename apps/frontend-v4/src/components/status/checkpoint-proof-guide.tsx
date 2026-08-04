export function CheckpointProofGuide(): React.JSX.Element {
	return (
		<div className="archive-proof-guide">
			<div>
				<strong>File set complete</strong>
				<span>
					The scanner has all archive files needed for that source and
					checkpoint.
				</span>
			</div>
			<div>
				<strong>Proof passed</strong>
				<span>
					Those files have been checked against each other and their hashes
					match.
				</span>
			</div>
			<div>
				<strong>Waiting for files</strong>
				<span>
					The checkpoint is known, but one or more required files still need to
					be downloaded or verified.
				</span>
			</div>
			<div>
				<strong>Needs current proof</strong>
				<span>
					The checkpoint has not completed the current hash and continuity rules.
					It may have incomplete facts or only an older proof attestation.
				</span>
			</div>
		</div>
	);
}
