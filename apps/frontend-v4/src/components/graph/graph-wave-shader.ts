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
	attribute vec3 instanceMidpoint;
	attribute vec3 instanceSource;
	attribute vec3 instanceTarget;
	attribute float instanceDuration;
	attribute float instanceStart;
	uniform float uTime;
	varying vec3 vInstanceColor;
	varying float vProgress;
	varying vec2 vWaveUv;

	void main() {
		vInstanceColor = instanceColor;
		vWaveUv = uv;
		bool isWaveActive = instanceDuration > 0.0001;
		float linearProgress = isWaveActive
			? clamp((uTime - instanceStart) / instanceDuration, 0.0, 1.0)
			: 1.0;
		vProgress = linearProgress;

		float progress = 1.0 - pow(1.0 - linearProgress, 3.0);
		float inverse = 1.0 - progress;
		vec3 curvePosition =
			inverse * inverse * instanceSource +
			2.0 * inverse * progress * instanceMidpoint +
			progress * progress * instanceTarget;
		vec3 tangent =
			2.0 * inverse * (instanceMidpoint - instanceSource) +
			2.0 * progress * (instanceTarget - instanceMidpoint);
		if (length(tangent) < 0.0001) tangent = vec3(1.0, 0.0, 0.0);
		tangent = normalize(tangent);

		vec3 worldUp = abs(tangent.y) > 0.94
			? vec3(0.0, 0.0, 1.0)
			: vec3(0.0, 1.0, 0.0);
		vec3 side = normalize(cross(worldUp, tangent));
		vec3 up = normalize(cross(tangent, side));
		float fade = linearProgress > 0.78
			? max(0.0, (1.0 - linearProgress) / 0.22)
			: 1.0;
		float pulseScale = (0.75 + sin(progress * 3.14159265) * 0.68) * fade;
		vec3 localOffset = (tangent * position.x + up * position.y) * pulseScale;
		vec4 worldPosition = modelMatrix * vec4(curvePosition + localOffset, 1.0);
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
	varying float vProgress;
	varying vec2 vWaveUv;

	float waveBand(float offset, float width) {
		float phase = fract(vWaveUv.x * uBandCount - uTime * 1.15 + offset);
		return smoothstep(width, 0.0, abs(phase - 0.5));
	}

	void main() {
		if (vProgress >= 1.0) discard;
		float verticalFade = smoothstep(0.0, 0.42, vWaveUv.y) *
			smoothstep(1.0, 0.58, vWaveUv.y);
		float lifecycleFade =
			smoothstep(0.0, 0.08, vProgress) *
			(1.0 - smoothstep(0.78, 1.0, vProgress));
		float head = waveBand(0.0, 0.18);
		float echo = waveBand(0.42, 0.26) * 0.42;
		float signal = max(head, echo);
		float pulse = 0.78 + sin((vWaveUv.x + uTime) * 6.28318) * 0.22;
		float alpha =
			signal *
			verticalFade *
			lifecycleFade *
			uOpacity *
			mix(1.0, pulse, uPulse);

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
