import {
	useEffect,
	type Dispatch,
	type RefObject,
	type SetStateAction
} from 'react';
import type { ForceGraph3DInstance } from '3d-force-graph';
import type { Group as ThreeGroup } from 'three';
import { getNodeLabel } from '../../domain/network';
import type { GraphContextMenuState } from './graph-context-menu';
import {
	getCameraTarget,
	initialCameraPosition,
	initialCameraTarget
} from './graph-camera';
import {
	createGraphNodeObject,
	getGraphLinkColor,
	getGraphLinkWidth
} from './graph-node-object';
import {
	createWaveMeshPool,
	disposeWaveMeshPool,
	type ActiveWave,
	type WaveMeshPool
} from './graph-wave-animation';
import { getGraphLinkKey, type GraphLinkLike } from './graph-link-utils';
import type { GraphVisualState } from './graph-visual-state';
import type { Graph3DLink, Graph3DNode, Graph3DOrganization } from './model-3d';

export interface GraphRenderData {
	links: Graph3DLink[];
	nodes: Graph3DNode[];
}

export type GraphRendererStatus = 'loading' | 'ready' | 'error';

interface UseGraphRendererOptions {
	activeWavesRef: RefObject<Map<number, ActiveWave>>;
	containerRef: RefObject<HTMLDivElement | null>;
	flowLinkColorsRef: RefObject<Map<string, string>>;
	graphDataRef: RefObject<GraphRenderData>;
	graphRef: RefObject<ForceGraph3DInstance | null>;
	nodesByIdRef: RefObject<Map<string, Graph3DNode>>;
	onStatusChange: (status: GraphRendererStatus) => void;
	organizationsRef: RefObject<Graph3DOrganization[]>;
	packetGroupRef: RefObject<ThreeGroup | null>;
	scheduleWaveAnimation: () => void;
	setContextMenu: Dispatch<SetStateAction<GraphContextMenuState | null>>;
	setFocusedOrganization: Dispatch<SetStateAction<Graph3DOrganization | null>>;
	setSelectedNodeId: Dispatch<SetStateAction<string | null>>;
	threeRef: RefObject<typeof import('three') | null>;
	visualStateRef: RefObject<GraphVisualState>;
	waveAnimationFrameRef: RefObject<number | null>;
	wavePoolRef: RefObject<WaveMeshPool | null>;
}

const hasWebGLSupport = (): boolean => {
	const canvas = document.createElement('canvas');
	return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
};

export const useGraphRenderer = ({
	activeWavesRef,
	containerRef,
	flowLinkColorsRef,
	graphDataRef,
	graphRef,
	nodesByIdRef,
	onStatusChange,
	organizationsRef,
	packetGroupRef,
	scheduleWaveAnimation,
	setContextMenu,
	setFocusedOrganization,
	setSelectedNodeId,
	threeRef,
	visualStateRef,
	waveAnimationFrameRef,
	wavePoolRef
}: UseGraphRendererOptions): void => {
	useEffect(() => {
		let active = true;
		let observer: ResizeObserver | null = null;

		async function createGraph(): Promise<void> {
			try {
				onStatusChange('loading');
				if (!containerRef.current) return;
				if (!hasWebGLSupport()) throw new Error('WebGL unavailable');
				const ForceGraph3D = (await import('3d-force-graph')).default;
				const THREE = await import('three');
				if (!active || !containerRef.current) return;

				const graph = new ForceGraph3D(containerRef.current, {
					controlType: 'orbit'
				});
				const keyLight = new THREE.DirectionalLight(0xffffff, 1.85);
				const rimLight = new THREE.DirectionalLight(0x58a6ff, 0.82);
				const packetGroup = new THREE.Group();
				const wavePool = createWaveMeshPool(THREE, packetGroup);
				keyLight.position.set(240, 320, 420);
				rimLight.position.set(-360, -220, 280);
				keyLight.castShadow = true;
				graph.renderer().shadowMap.enabled = true;
				graph.renderer().shadowMap.type = THREE.PCFShadowMap;
				graph.scene().add(packetGroup);
				graphRef.current = graph;
				packetGroupRef.current = packetGroup;
				wavePoolRef.current = wavePool;
				threeRef.current = THREE;
				graph.resumeAnimation();
				scheduleWaveAnimation();
				graph
					.backgroundColor('#07111d')
					.graphData(graphDataRef.current)
					.nodeId('id')
					.nodeLabel((node) => {
						const graphNode = nodesByIdRef.current.get(String(node.id));
						return graphNode
							? `${getNodeLabel(graphNode.node)}<br/>${graphNode.groupName}`
							: '';
					})
					.nodeVal('size')
					.nodeThreeObject((node) => {
						const graphNode = nodesByIdRef.current.get(String(node.id));
						return graphNode
							? createGraphNodeObject(graphNode, visualStateRef.current)
							: new THREE.Group();
					})
					.linkColor(
						(link) =>
							flowLinkColorsRef.current.get(
								getGraphLinkKey(link as GraphLinkLike)
							) ??
							getGraphLinkColor(
								link as GraphLinkLike,
								nodesByIdRef.current,
								visualStateRef.current
							)
					)
					.linkLabel((link) => (link as GraphLinkLike).label ?? '')
					.linkOpacity(0.38)
					.linkWidth((link) =>
						flowLinkColorsRef.current.has(
							getGraphLinkKey(link as GraphLinkLike)
						)
							? 3.7
							: getGraphLinkWidth(
									link as GraphLinkLike,
									nodesByIdRef.current,
									visualStateRef.current
								)
					)
					.linkDirectionalParticles(0)
					.linkDirectionalParticleColor(
						(link) =>
							flowLinkColorsRef.current.get(
								getGraphLinkKey(link as GraphLinkLike)
							) ?? '#58a6ff'
					)
					.linkDirectionalParticleSpeed(0.024)
					.linkDirectionalParticleWidth((link) =>
						flowLinkColorsRef.current.has(
							getGraphLinkKey(link as GraphLinkLike)
						)
							? 3.4
							: 0
					)
					.showNavInfo(false)
					.enableNodeDrag(false)
					.lights([
						new THREE.AmbientLight(0x8ba6c4, 1.35),
						keyLight,
						rimLight,
						new THREE.HemisphereLight(0x7db8ff, 0x07111d, 1.2)
					])
					.onNodeHover((node) => {
						visualStateRef.current = {
							...visualStateRef.current,
							hoveredNodeId: node?.id === undefined ? null : String(node.id)
						};
						graph.refresh();
					})
					.onNodeClick((node) => {
						const graphNode = nodesByIdRef.current.get(String(node.id));
						if (!graphNode) return;
						setSelectedNodeId(graphNode.id);
						setFocusedOrganization(
							organizationsRef.current.find(
								(org) => org.id === graphNode.groupId
							) ?? null
						);
						setContextMenu(null);
						graph.cameraPosition(
							getCameraTarget(graphNode),
							{
								x: graphNode.x ?? 0,
								y: graphNode.y ?? 0,
								z: graphNode.z ?? 0
							},
							850
						);
					})
					.onNodeRightClick((node, event) => {
						event.preventDefault();
						const graphNode = nodesByIdRef.current.get(String(node.id));
						if (!graphNode) return;
						setContextMenu({
							node: graphNode,
							x: event.clientX,
							y: event.clientY
						});
					})
					.onBackgroundClick(() => {
						setSelectedNodeId(null);
						setFocusedOrganization(null);
						setContextMenu(null);
					})
					.onBackgroundRightClick((event) => {
						event.preventDefault();
						setContextMenu({
							node: null,
							x: event.clientX,
							y: event.clientY
						});
					});

				const resize = (): void => {
					const bounds = containerRef.current?.getBoundingClientRect();
					if (!bounds) return;
					graph.width(bounds.width).height(bounds.height);
				};
				resize();
				observer = new ResizeObserver(resize);
				observer.observe(containerRef.current);
				graph.cameraPosition(initialCameraPosition, initialCameraTarget, 900);
				onStatusChange('ready');
			} catch (error) {
				console.error('Graph renderer failed to initialize', error);
				if (active) onStatusChange('error');
			}
		}

		void createGraph();
		return () => {
			active = false;
			observer?.disconnect();
			if (waveAnimationFrameRef.current !== null) {
				window.cancelAnimationFrame(waveAnimationFrameRef.current);
				waveAnimationFrameRef.current = null;
			}
			activeWavesRef.current.clear();
			if (wavePoolRef.current) {
				disposeWaveMeshPool(wavePoolRef.current);
				wavePoolRef.current = null;
			}
			if (packetGroupRef.current) {
				graphRef.current?.scene().remove(packetGroupRef.current);
				packetGroupRef.current = null;
			}
			graphRef.current?._destructor();
			graphRef.current = null;
			threeRef.current = null;
		};
	}, []);
};
