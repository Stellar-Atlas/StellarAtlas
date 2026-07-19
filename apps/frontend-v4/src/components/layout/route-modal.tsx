'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
	getScopeContextDataAttributes,
	ScopeContext,
	type ScopeContextProps
} from './scope-context';

interface RouteModalProps {
	readonly children: React.ReactNode;
	readonly closeHref: string;
	readonly eyebrow: string;
	readonly scopeContext?: ScopeContextProps;
	readonly title: string;
}

interface BackgroundState {
	readonly ariaHidden: string | null;
	readonly element: HTMLElement;
	readonly inert: boolean;
}

const focusableSelector = [
	'a[href]:not([tabindex="-1"])',
	'button:not([disabled]):not([tabindex="-1"])',
	'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
	'select:not([disabled]):not([tabindex="-1"])',
	'summary:not([tabindex="-1"])',
	'textarea:not([disabled]):not([tabindex="-1"])',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

export function RouteModal({
	children,
	closeHref,
	eyebrow,
	scopeContext,
	title
}: RouteModalProps): React.JSX.Element {
	const router = useRouter();
	const layerRef = useRef<HTMLDivElement>(null);
	const dialogRef = useRef<HTMLElement>(null);
	const closeRef = useRef<HTMLAnchorElement>(null);
	const titleId = `route-dialog-${useStableId(title)}`;

	useEffect(() => {
		const layer = layerRef.current;
		const dialog = dialogRef.current;
		if (layer === null || dialog === null) return;
		const opener = document.activeElement;
		const openerHref =
			opener instanceof HTMLAnchorElement
				? opener.getAttribute('href')
				: closeHref;
		(closeRef.current ?? dialog).focus();
		const background = makeBackgroundInert(layer);
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		const closeRoute = (): void => {
			router.replace(closeHref, { scroll: false });
		};

		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				event.preventDefault();
				closeRoute();
				return;
			}
			if (event.key !== 'Tab') return;
			trapFocus(event, dialog);
		};
		document.addEventListener('keydown', onKeyDown, true);

		return () => {
			document.removeEventListener('keydown', onKeyDown, true);
			document.body.style.overflow = previousOverflow;
			restoreBackground(background);
			requestAnimationFrame(() => restoreFocus(opener, openerHref));
		};
	}, [closeHref, router]);

	return (
		<div className="route-modal-layer" ref={layerRef}>
			<Link
				aria-hidden="true"
				className="route-modal-backdrop"
				href={closeHref}
				replace
				scroll={false}
				tabIndex={-1}
			/>
			<section
				aria-labelledby={titleId}
				aria-modal="true"
				className="route-modal"
				{...(scopeContext ? getScopeContextDataAttributes(scopeContext) : {})}
				ref={dialogRef}
				role="dialog"
				tabIndex={-1}
			>
				<div className="route-modal-header">
					<div>
						<p className="eyebrow">{eyebrow}</p>
						<h2 id={titleId}>{title}</h2>
						{scopeContext ? <ScopeContext {...scopeContext} /> : null}
					</div>
					<Link
						aria-label="Close details"
						className="close-route-modal"
						href={closeHref}
						replace
						ref={closeRef}
						scroll={false}
						title="Close"
					>
						<span aria-hidden="true">&times;</span>
					</Link>
				</div>
				{children}
			</section>
		</div>
	);
}

function useStableId(value: string): string {
	const id = useRef<string>(
		value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'details'
	);
	return id.current;
}

function makeBackgroundInert(layer: HTMLElement): readonly BackgroundState[] {
	const states: BackgroundState[] = [];
	let current: HTMLElement = layer;
	while (current.parentElement !== null) {
		const parent = current.parentElement;
		for (const sibling of parent.children) {
			if (sibling === current || !(sibling instanceof HTMLElement)) continue;
			states.push({
				ariaHidden: sibling.getAttribute('aria-hidden'),
				element: sibling,
				inert: sibling.inert
			});
			sibling.inert = true;
			sibling.setAttribute('aria-hidden', 'true');
		}
		if (parent === document.body) break;
		current = parent;
	}
	return states;
}

function restoreBackground(states: readonly BackgroundState[]): void {
	for (const state of states) {
		state.element.inert = state.inert;
		if (state.ariaHidden === null) state.element.removeAttribute('aria-hidden');
		else state.element.setAttribute('aria-hidden', state.ariaHidden);
	}
}

function trapFocus(event: KeyboardEvent, dialog: HTMLElement): void {
	const focusable = [
		...dialog.querySelectorAll<HTMLElement>(focusableSelector)
	].filter((element) => element.getClientRects().length > 0);
	if (focusable.length === 0) {
		event.preventDefault();
		dialog.focus();
		return;
	}
	const first = focusable[0];
	const last = focusable.at(-1);
	if (first === undefined || last === undefined) return;
	const active = document.activeElement;
	if (event.shiftKey && (active === first || !dialog.contains(active))) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
		event.preventDefault();
		first.focus();
	}
}

function restoreFocus(opener: Element | null, openerHref: string | null): void {
	if (document.querySelector('[role="dialog"][aria-modal="true"]') !== null) {
		return;
	}
	if (opener instanceof HTMLElement && opener.isConnected) {
		opener.focus();
		return;
	}
	if (openerHref === null) return;
	const replacement = [
		...document.querySelectorAll<HTMLAnchorElement>('a[href]')
	].find((link) => link.getAttribute('href') === openerHref);
	replacement?.focus();
}
