import type {
	Color,
	Group as ThreeGroup,
	InstancedBufferAttribute,
	InstancedMesh,
	Matrix4,
	PlaneGeometry,
	Vector3
} from 'three';
import {
	createWaveShaderMaterial,
	updateWaveShaderTime,
	type WaveShaderMaterial
} from './graph-wave-shader';

export const maxWaveInstances = 1_024;

interface WaveInstanceAttributes {
	duration: InstancedBufferAttribute;
	midpoint: InstancedBufferAttribute;
	source: InstancedBufferAttribute;
	start: InstancedBufferAttribute;
	target: InstancedBufferAttribute;
}

interface WaveInstanceData {
	duration: Float32Array;
	midpoint: Float32Array;
	source: Float32Array;
	start: Float32Array;
	target: Float32Array;
	attributes: WaveInstanceAttributes;
}

export interface WaveMeshPool {
	back: InstancedMesh<PlaneGeometry, WaveShaderMaterial>;
	backData: WaveInstanceData;
	color: Color;
	front: InstancedMesh<PlaneGeometry, WaveShaderMaterial>;
	frontData: WaveInstanceData;
	identity: Matrix4;
}

export interface ActiveWave {
	durationMs: number;
	index: number;
	startedAt: number;
}

export const allocateWaveSlotIndex = (
	activeWaves: Map<number, ActiveWave>,
	startIndex: number,
	now: number
): number | null => {
	for (let offset = 0; offset < maxWaveInstances; offset += 1) {
		const index = (startIndex + offset) % maxWaveInstances;
		const activeWave = activeWaves.get(index);
		if (activeWave === undefined) return index;
		if (now - activeWave.startedAt >= activeWave.durationMs) {
			activeWaves.delete(index);
			return index;
		}
	}
	return null;
};

interface LaunchWaveSlotOptions {
	color: string;
	durationMs: number;
	midpoint: Vector3;
	source: Vector3;
	startedAt: number;
	target: Vector3;
}

const markAttributesUpdated = (data: WaveInstanceData): void => {
	data.attributes.duration.needsUpdate = true;
	data.attributes.midpoint.needsUpdate = true;
	data.attributes.source.needsUpdate = true;
	data.attributes.start.needsUpdate = true;
	data.attributes.target.needsUpdate = true;
};

const setTriplet = (
	target: Float32Array,
	index: number,
	value: Vector3
): void => {
	const offset = index * 3;
	target[offset] = value.x;
	target[offset + 1] = value.y;
	target[offset + 2] = value.z;
};

const setWaveSlotData = (
	data: WaveInstanceData,
	index: number,
	options: LaunchWaveSlotOptions
): void => {
	setTriplet(data.source, index, options.source);
	setTriplet(data.target, index, options.target);
	setTriplet(data.midpoint, index, options.midpoint);
	data.start[index] = options.startedAt / 1_000;
	data.duration[index] = options.durationMs / 1_000;
	markAttributesUpdated(data);
};

const hideWaveSlotData = (data: WaveInstanceData, index: number): void => {
	data.start[index] = -1_000_000;
	data.duration[index] = 0;
	data.attributes.start.needsUpdate = true;
	data.attributes.duration.needsUpdate = true;
};

const createInstanceAttribute = (
	THREE: typeof import('three'),
	array: Float32Array,
	itemSize: number
): InstancedBufferAttribute => {
	const attribute = new THREE.InstancedBufferAttribute(array, itemSize);
	attribute.setUsage(THREE.DynamicDrawUsage);
	return attribute;
};

const createWaveInstanceData = (
	THREE: typeof import('three'),
	geometry: PlaneGeometry
): WaveInstanceData => {
	const data: WaveInstanceData = {
		duration: new Float32Array(maxWaveInstances),
		midpoint: new Float32Array(maxWaveInstances * 3),
		source: new Float32Array(maxWaveInstances * 3),
		start: new Float32Array(maxWaveInstances),
		target: new Float32Array(maxWaveInstances * 3),
		attributes: {} as WaveInstanceAttributes
	};
	data.attributes = {
		duration: createInstanceAttribute(THREE, data.duration, 1),
		midpoint: createInstanceAttribute(THREE, data.midpoint, 3),
		source: createInstanceAttribute(THREE, data.source, 3),
		start: createInstanceAttribute(THREE, data.start, 1),
		target: createInstanceAttribute(THREE, data.target, 3)
	};
	geometry.setAttribute('instanceDuration', data.attributes.duration);
	geometry.setAttribute('instanceMidpoint', data.attributes.midpoint);
	geometry.setAttribute('instanceSource', data.attributes.source);
	geometry.setAttribute('instanceStart', data.attributes.start);
	geometry.setAttribute('instanceTarget', data.attributes.target);
	return data;
};

const hideWaveSlot = (pool: WaveMeshPool, index: number): void => {
	hideWaveSlotData(pool.frontData, index);
	hideWaveSlotData(pool.backData, index);
};

export const setWaveSlotColor = (
	pool: WaveMeshPool,
	index: number,
	color: string
): void => {
	pool.color.set(color);
	pool.front.setColorAt(index, pool.color);
	pool.back.setColorAt(index, pool.color);
	if (pool.front.instanceColor) pool.front.instanceColor.needsUpdate = true;
	if (pool.back.instanceColor) pool.back.instanceColor.needsUpdate = true;
};

export const launchWaveSlot = (
	pool: WaveMeshPool,
	index: number,
	options: LaunchWaveSlotOptions
): void => {
	setWaveSlotData(pool.frontData, index, options);
	setWaveSlotData(pool.backData, index, options);
	setWaveSlotColor(pool, index, options.color);
};

export const createWaveMeshPool = (
	THREE: typeof import('three'),
	packetGroup: ThreeGroup
): WaveMeshPool => {
	const frontGeometry = new THREE.PlaneGeometry(54, 16, 1, 1);
	const backGeometry = new THREE.PlaneGeometry(82, 26, 1, 1);
	const frontData = createWaveInstanceData(THREE, frontGeometry);
	const backData = createWaveInstanceData(THREE, backGeometry);
	const frontMaterial = createWaveShaderMaterial(THREE, 0.9, 2.6);
	const backMaterial = createWaveShaderMaterial(THREE, 0.46, 1.8);
	const front = new THREE.InstancedMesh(
		frontGeometry,
		frontMaterial,
		maxWaveInstances
	);
	const back = new THREE.InstancedMesh(
		backGeometry,
		backMaterial,
		maxWaveInstances
	);
	front.frustumCulled = false;
	back.frustumCulled = false;

	const pool: WaveMeshPool = {
		back,
		backData,
		color: new THREE.Color('#58a6ff'),
		front,
		frontData,
		identity: new THREE.Matrix4()
	};

	for (let index = 0; index < maxWaveInstances; index += 1) {
		front.setMatrixAt(index, pool.identity);
		back.setMatrixAt(index, pool.identity);
		hideWaveSlot(pool, index);
		setWaveSlotColor(pool, index, '#58a6ff');
	}
	front.instanceMatrix.needsUpdate = true;
	back.instanceMatrix.needsUpdate = true;

	packetGroup.add(back);
	packetGroup.add(front);
	return pool;
};

export const disposeWaveMeshPool = (pool: WaveMeshPool): void => {
	pool.front.geometry.dispose();
	pool.front.material.dispose();
	pool.back.geometry.dispose();
	pool.back.material.dispose();
};

export const hideAllWaveSlots = (pool: WaveMeshPool): void => {
	for (let index = 0; index < maxWaveInstances; index += 1) {
		hideWaveSlot(pool, index);
	}
};

export const updateWaveMeshPool = (
	pool: WaveMeshPool,
	activeWaves: Map<number, ActiveWave>,
	now: number
): void => {
	updateWaveShaderTime(pool.front.material, now);
	updateWaveShaderTime(pool.back.material, now);

	for (const [index, wave] of activeWaves) {
		if (now - wave.startedAt < wave.durationMs) continue;
		hideWaveSlot(pool, index);
		activeWaves.delete(index);
	}
};
