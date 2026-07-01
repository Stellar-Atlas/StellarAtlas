'use client';

import { useMemo, useState } from 'react';
import type { GraphModel } from './model';

interface ViewState {
	x: number;
	y: number;
	scale: number;
	isPanning: boolean;
	startX: number;
	startY: number;
}

interface NetworkGraphCanvasProps {
	model: GraphModel;
}

const clamp = (value: number, min: number, max: number): number =>
	Math.min(Math.max(value, min), max);

export function NetworkGraphCanvas({
	model
}: NetworkGraphCanvasProps): React.JSX.Element {
	const [view, setView] = useState<ViewState>({
		x: 0,
		y: 0,
		scale: 1,
		isPanning: false,
		startX: 0,
		startY: 0
	});
	const nodesById = useMemo(
		() => new Map(model.nodes.map((node) => [node.id, node])),
		[model.nodes]
	);

	const zoom = (delta: number): void => {
		setView((current) => ({
			...current,
			scale: clamp(current.scale + delta, 0.55, 2.4)
		}));
	};

	return (
		<article className="graph-panel">
			<div className="graph-toolbar">
				<div>
					<h2>Trust graph</h2>
					<span>{model.nodes.length} nodes, {model.edges.length} edges</span>
				</div>
				<div className="segmented">
					<button onClick={() => zoom(0.18)} type="button">+</button>
					<button onClick={() => zoom(-0.18)} type="button">-</button>
					<button
						onClick={() =>
							setView({
								x: 0,
								y: 0,
								scale: 1,
								isPanning: false,
								startX: 0,
								startY: 0
							})
						}
						type="button"
					>
						Reset
					</button>
				</div>
			</div>
			<svg
				aria-label="Network trust graph"
				className="graph"
				onPointerDown={(event) => {
					event.currentTarget.setPointerCapture(event.pointerId);
					setView((current) => ({
						...current,
						isPanning: true,
						startX: event.clientX - current.x,
						startY: event.clientY - current.y
					}));
				}}
				onPointerMove={(event) => {
					if (!view.isPanning) return;
					setView((current) => ({
						...current,
						x: event.clientX - current.startX,
						y: event.clientY - current.startY
					}));
				}}
				onPointerUp={() =>
					setView((current) => ({ ...current, isPanning: false }))
				}
				onWheel={(event) => {
					event.preventDefault();
					zoom(event.deltaY > 0 ? -0.08 : 0.08);
				}}
				role="img"
				viewBox={`0 0 ${model.width} ${model.height}`}
			>
				<g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
					{model.edges.map((edge) => {
						const source = nodesById.get(edge.source);
						const target = nodesById.get(edge.target);
						if (!source || !target) return null;

						return (
							<line
								key={edge.id}
								stroke={edge.color}
								strokeOpacity={edge.opacity}
								strokeWidth="1"
								x1={source.x}
								x2={target.x}
								y1={source.y}
								y2={target.y}
							/>
						);
					})}
					{model.nodes.map((node) => (
						<a href={node.href} key={node.id}>
							<circle
								cx={node.x}
								cy={node.y}
								fill={node.color}
								r={node.radius}
								stroke="#ffffff"
								strokeWidth="2"
							/>
							<text
								fill={node.kind === 'offline' ? '#b84f55' : '#344457'}
								fontSize={node.kind === 'validator' ? 10 : 8}
								fontWeight={node.kind === 'validator' ? 700 : 600}
								textAnchor="middle"
								x={node.x}
								y={node.y + node.radius + 10}
							>
								{node.label}
							</text>
							<title>{`${node.label} - ${node.detail}`}</title>
						</a>
					))}
				</g>
			</svg>
		</article>
	);
}
