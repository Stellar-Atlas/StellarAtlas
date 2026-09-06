import { observeSwaggerFrame } from '../swagger-reference-frame';

describe('Swagger single-page scrolling', () => {
	it('resizes on expanded and collapsed content and disconnects on cleanup', () => {
		let height = 1800;
		const root = { style: { overflowY: '' } };
		const body = {
			getBoundingClientRect: () => ({ height }),
			get scrollHeight() {
				return height;
			}
		};
		const frame = {
			contentDocument: { body, documentElement: root },
			style: { height: '' }
		};
		let resized = (): void => {};
		const disconnect = jest.fn();
		const original = globalThis.ResizeObserver;
		globalThis.ResizeObserver = class {
			constructor(callback: ResizeObserverCallback) {
				resized = () => callback([], this);
			}
			observe = jest.fn();
			unobserve = jest.fn();
			disconnect = disconnect;
		};
		try {
			const cleanup = observeSwaggerFrame(
				frame as unknown as HTMLIFrameElement
			);
			expect(frame.style.height).toBe('1800px');
			expect(root.style.overflowY).toBe('hidden');
			height = 700;
			resized();
			expect(frame.style.height).toBe('700px');
			cleanup();
			expect(disconnect).toHaveBeenCalledTimes(1);
			expect(root.style.overflowY).toBe('');
		} finally {
			globalThis.ResizeObserver = original;
		}
	});
});
