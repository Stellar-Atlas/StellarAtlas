export function CheckpointProofGuide(): React.JSX.Element {
	return (
		<div className="archive-proof-guide">
			<div>
				<strong>Required files present</strong>
				<span>
					The scanner has all archive files needed for that source and
					checkpoint.
				</span>
			</div>
			<div>
				<strong>Hash agreement proven</strong>
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
				<strong>Cannot evaluate yet</strong>
				<span>
					The proof row exists, but the scanner does not yet have enough
					structured evidence to decide pass or fail.
				</span>
			</div>
		</div>
	);
}
