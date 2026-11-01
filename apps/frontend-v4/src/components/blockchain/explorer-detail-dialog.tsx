'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import styles from './explorer-detail-dialog.module.css';

/** A native modal for record details; opening it never fetches additional data. */
export function ExplorerDetailDialog({
	title, children, onClose
}: {
	readonly title: string;
	readonly children: ReactNode;
	readonly onClose: () => void;
}): React.JSX.Element {
	const titleId = useId();
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const element = dialog.current;
		const previousFocus = document.activeElement;
		element?.showModal();
		return () => {
			element?.close();
			if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
				previousFocus.focus({ preventScroll: true });
		};
	}, []);
	return (
		<dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={onClose} onClose={onClose}>
			<header className={styles.heading}>
				<h3 id={titleId}>{title}</h3>
				<button type="button" autoFocus onClick={onClose}>Close</button>
			</header>
			<div className={styles.content}>{children}</div>
		</dialog>
	);
}
