import type {
	Color,
	Group as ThreeGroup,
	InstancedMesh,
	Object3D,
	PlaneGeometry,
	Vector3
} from 'three';
import { maxAnimatedStatementsPerLedger } from './scp-flow-paths';
import {
	createWaveShaderMaterial,
	updateWaveShaderTime,
	type WaveShaderMaterial
} from './graph-wave-shader';

export const maxWaveInstances = maxAnimatedStatementsPerLedger;

export interface WaveMeshPool {
	back: InstancedMesh<PlaneGeometry, WaveShaderMaterial>;
	color: Color;
	dummy: Object3D;
	forwardAxis: Vector3;
	front: InstancedMesh<PlaneGeometry, WaveShaderMaterial>;
	tangent: Vector3;
}

export interface ActiveWave {
	durationMs: number;
	index: number;
	midpoint: Vector3;
	source: Vector3;
	startedAt: number;
	target: Vector3;
}

const hideWaveSlot = (pool: WaveMeshPool, index: number): void => {
	pool.dummy.position.set(0, 0, 0);
	pool.dummy.quaternion.identity();
	pool.dummy.scale.setScalar(0);
	pool.dummy.updateMatrix();
	pool.front.setMatrixAt(index, pool.dummy.matrix);
	pool.back.setMatrixAt(index, pool.dummy.matrix);
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

export const createWaveMeshPool = (
	THREE: typeof import('three'),
	packetGroup: ThreeGroup
): WaveMeshPool => {
	const frontGeometry = new THREE.PlaneGeometry(54, 16, 1, 1);
	const backGeometry = new THREE.PlaneGeometry(82, 26, 1, 1);
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
	front.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	back.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	front.frustumCulled = false;
	back.frustumCulled = false;

	const pool: WaveMeshPool = {
		back,
		color: new THREE.Color('#58a6ff'),
		dummy: new THREE.Object3D(),
		forwardAxis: new THREE.Vector3(1, 0, 0),
		front,
		tangent: new THREE.Vector3(1, 0, 0)
	};

	for (let index = 0; index < maxWaveInstances; index += 1) {
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
	pool.front.instanceMatrix.needsUpdate = true;
	pool.back.instanceMatrix.needsUpdate = true;
};

export const updateWaveMeshPool = (
	pool: WaveMeshPool,
	activeWaves: Map<number, ActiveWave>,
	now: number
): void => {
	updateWaveShaderTime(pool.front.material, now);
	updateWaveShaderTime(pool.back.material, now);

	for (const [index, wave] of activeWaves) {
		const linearProgress = Math.min(
			1,
			(now - wave.startedAt) / wave.durationMs
		);
		if (linearProgress >= 1) {
			hideWaveSlot(pool, index);
			activeWaves.delete(index);
			continue;
		}

		const progress = 1 - Math.pow(1 - linearProgress, 3);
		const inverse = 1 - progress;
		const x =
			inverse * inverse * wave.source.x +
			2 * inverse * progress * wave.midpoint.x +
			progress * progress * wave.target.x;
		const y =
			inverse * inverse * wave.source.y +
			2 * inverse * progress * wave.midpoint.y +
			progress * progress * wave.target.y;
		const z =
			inverse * inverse * wave.source.z +
			2 * inverse * progress * wave.midpoint.z +
			progress * progress * wave.target.z;
		const fade =
			linearProgress > 0.78 ? Math.max(0, (1 - linearProgress) / 0.22) : 1;
		const pulseScale = (0.75 + Math.sin(progress * Math.PI) * 0.68) * fade;

		pool.tangent
			.set(
				2 * inverse * (wave.midpoint.x - wave.source.x) +
					2 * progress * (wave.target.x - wave.midpoint.x),
				2 * inverse * (wave.midpoint.y - wave.source.y) +
					2 * progress * (wave.target.y - wave.midpoint.y),
				2 * inverse * (wave.midpoint.z - wave.source.z) +
					2 * progress * (wave.target.z - wave.midpoint.z)
			)
			.normalize();
		pool.dummy.position.set(x, y, z);
		pool.dummy.quaternion.setFromUnitVectors(pool.forwardAxis, pool.tangent);
		pool.dummy.scale.setScalar(pulseScale);
		pool.dummy.updateMatrix();
		pool.front.setMatrixAt(index, pool.dummy.matrix);
		pool.dummy.scale.setScalar(pulseScale * 1.62);
		pool.dummy.updateMatrix();
		pool.back.setMatrixAt(index, pool.dummy.matrix);
	}

	pool.front.instanceMatrix.needsUpdate = true;
	pool.back.instanceMatrix.needsUpdate = true;
};
