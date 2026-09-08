import { jest } from '@jest/globals';
import { observeDocsHeaderOffset } from '../docs-header-offset';

describe('docs sticky header offset', () => {
	const originalObserver = globalThis.ResizeObserver;
	afterEach(() => {
		globalThis.ResizeObserver = originalObserver;
	});
	function fixture() {
		let height = 69;
		const setProperty = jest.fn();
		const removeProperty = jest.fn();
		const container = {
			style: { setProperty, removeProperty }
		} as unknown as HTMLElement;
		const header = { getBoundingClientRect: () => ({ height }) } as HTMLElement;
		return {
			container,
			header,
			setProperty,
			removeProperty,
			resize: (value: number) => {
				height = value;
			}
		};
	}
	it('measures the site header and tracks expansion without repeated no-op writes', () => {
		const { container, header, setProperty, removeProperty, resize } =
			fixture();
		let notify = (): void => {};
		const observe = jest.fn();
		const disconnect = jest.fn();
		globalThis.ResizeObserver = class {
			constructor(callback: ResizeObserverCallback) {
				notify = () => callback([], this);
			}
			observe = observe;
			disconnect = disconnect;
			unobserve = (): void => {};
		};
		const dispose = observeDocsHeaderOffset(container, header);
		expect(observe).toHaveBeenCalledWith(header);
		expect(setProperty).toHaveBeenLastCalledWith('--fd-banner-height', '69px');
		notify();
		expect(setProperty).toHaveBeenCalledTimes(1);
		resize(237.5);
		notify();
		expect(setProperty).toHaveBeenLastCalledWith(
			'--fd-banner-height',
			'237.5px'
		);
		dispose();
		expect(disconnect).toHaveBeenCalledTimes(1);
		expect(removeProperty).toHaveBeenCalledWith('--fd-banner-height');
		notify();
		expect(setProperty).toHaveBeenCalledTimes(2);
	});
	it('keeps the CSS fallback for unavailable measurements', () => {
		globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver;
		const { container, header, setProperty, resize } = fixture();
		resize(0);
		observeDocsHeaderOffset(container, header)();
		expect(setProperty).not.toHaveBeenCalled();
	});
	it('still measures once when ResizeObserver is unavailable', () => {
		globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver;
		const { container, header, setProperty } = fixture();
		observeDocsHeaderOffset(container, header)();
		expect(setProperty).toHaveBeenCalledWith('--fd-banner-height', '69px');
	});
});
