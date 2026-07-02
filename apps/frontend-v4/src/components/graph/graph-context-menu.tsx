'use client';

import Link from 'next/link';
import type { Graph3DNode } from './model-3d';

export interface GraphContextMenuState {
	node: Graph3DNode | null;
	x: number;
	y: number;
}

interface GraphContextMenuProps {
	menu: GraphContextMenuState | null;
	onClose: () => void;
	onCopyPublicKey: (node: Graph3DNode) => void;
	onFocusOrganization: (node: Graph3DNode) => void;
	onResetCamera: () => void;
	onToggleConnectable: () => void;
	showAllConnectable: boolean;
}

export function GraphContextMenu({
	menu,
	onClose,
	onCopyPublicKey,
	onFocusOrganization,
	onResetCamera,
	onToggleConnectable,
	showAllConnectable
}: GraphContextMenuProps): React.JSX.Element | null {
	if (!menu) return null;

	const menuNode = menu.node;
	const style = {
		insetBlockStart: menu.y,
		insetInlineStart: menu.x
	};

	return (
		<div
			className="graph-context-menu"
			onContextMenu={(event) => event.preventDefault()}
			role="menu"
			style={style}
		>
			{menuNode ? (
				<>
					<strong>{menuNode.groupName}</strong>
					<Link
						href={`/nodes/${encodeURIComponent(menuNode.id)}`}
						onClick={onClose}
						role="menuitem"
					>
						Open node details
					</Link>
					<button
						onClick={() => {
							onFocusOrganization(menuNode);
							onClose();
						}}
						role="menuitem"
						type="button"
					>
						Focus organization
					</button>
					<button
						onClick={() => {
							onCopyPublicKey(menuNode);
							onClose();
						}}
						role="menuitem"
						type="button"
					>
						Copy public key
					</button>
				</>
			) : (
				<>
					<strong>Graph</strong>
					<button onClick={onResetCamera} role="menuitem" type="button">
						Reset camera
					</button>
					<button onClick={onToggleConnectable} role="menuitem" type="button">
						{showAllConnectable ? 'Validator topology' : 'All connectable nodes'}
					</button>
					<Link href="/docs" onClick={onClose} role="menuitem">
						Open API reference
					</Link>
				</>
			)}
		</div>
	);
}
