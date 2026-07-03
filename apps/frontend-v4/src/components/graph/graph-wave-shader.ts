import type { ShaderMaterial } from 'three';

export type WaveShaderMaterial = ShaderMaterial & {
	uniforms: {
		uBandCount: { value: number };
		uOpacity: { value: number };
		uPulse: { value: number };
		uTime: { value: number };
	};
};

const vertexShader = `
	attribute vec3 instanceColor;
	varying vec3 vInstanceColor;
	varying vec2 vWaveUv;

	void main() {
		vInstanceColor = instanceColor;
		vWaveUv = uv;
		vec4 modelPosition = instanceMatrix * vec4(position, 1.0);
		vec4 worldPosition = modelMatrix * modelPosition;
		gl_Position = projectionMatrix * viewMatrix * worldPosition;
	}
`;

const fragmentShader = `
	precision highp float;

	uniform float uBandCount;
	uniform float uOpacity;
	uniform float uPulse;
	uniform float uTime;
	varying vec3 vInstanceColor;
	varying vec2 vWaveUv;

	float waveBand(float offset, float width) {
		float phase = fract(vWaveUv.x * uBandCount - uTime * 1.15 + offset);
		return smoothstep(width, 0.0, abs(phase - 0.5));
	}

	void main() {
		float verticalFade = smoothstep(0.0, 0.42, vWaveUv.y) *
			smoothstep(1.0, 0.58, vWaveUv.y);
		float head = waveBand(0.0, 0.18);
		float echo = waveBand(0.42, 0.26) * 0.42;
		float signal = max(head, echo);
		float pulse = 0.78 + sin((vWaveUv.x + uTime) * 6.28318) * 0.22;
		float alpha = signal * verticalFade * uOpacity * mix(1.0, pulse, uPulse);

		if (alpha < 0.015) discard;
		gl_FragColor = vec4(vInstanceColor, alpha);
	}
`;

export const createWaveShaderMaterial = (
	THREE: typeof import('three'),
	opacity: number,
	bandCount: number
): WaveShaderMaterial =>
	new THREE.ShaderMaterial({
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		fragmentShader,
		transparent: true,
		uniforms: {
			uBandCount: { value: bandCount },
			uOpacity: { value: opacity },
			uPulse: { value: 1 },
			uTime: { value: 0 }
		},
		vertexColors: true,
		vertexShader
	}) as WaveShaderMaterial;

export const updateWaveShaderTime = (
	material: WaveShaderMaterial,
	now: number
): void => {
	material.uniforms.uTime.value = now / 1000;
};
