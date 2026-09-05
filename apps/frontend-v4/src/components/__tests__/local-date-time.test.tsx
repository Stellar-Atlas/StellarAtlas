/// <reference types="jest" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
	LocalDateTime,
	formatLocalDateTime,
	useLocalDateTimeFormatter
} from '../local-date-time';

const timestamp = '2026-09-05T19:13:00.000Z';

describe('local date time', () => {
	afterEach(() => jest.restoreAllMocks());

	it('renders a labeled UTC fallback without browser-dependent formatting', () => {
		const formatter = jest.spyOn(Intl, 'DateTimeFormat');
		const markup = renderToStaticMarkup(
			createElement(LocalDateTime, { dateTime: timestamp })
		);

		expect(markup).toBe(
			`<time dateTime="${timestamp}" title="${timestamp}">2026-09-05 19:13 UTC</time>`
		);
		expect(formatter).not.toHaveBeenCalled();
	});

	it('normalizes offset timestamps while preserving the exact instant', () => {
		const markup = renderToStaticMarkup(
			createElement(LocalDateTime, {
				dateTime: '2026-09-05T15:13:00-04:00'
			})
		);

		expect(markup).toContain(`dateTime="${timestamp}"`);
		expect(markup).toContain('2026-09-05 19:13 UTC');
	});

	it('uses the browser locale and timezone without overriding either', () => {
		const formatter = jest.spyOn(Intl, 'DateTimeFormat');
		const date = new Date(timestamp);
		const actual = formatLocalDateTime(date);
		const options: Intl.DateTimeFormatOptions = {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			timeZoneName: 'short'
		};

		expect(formatter).toHaveBeenCalledWith(undefined, options);
		expect(options).not.toHaveProperty('timeZone');
		expect(actual).toBe(
			new Intl.DateTimeFormat(undefined, options).format(date)
		);
	});

	it('updates the displayed instant when a new snapshot arrives', () => {
		const markup = renderToStaticMarkup(
			createElement(LocalDateTime, { dateTime: '2026-09-06T00:01:00Z' })
		);

		expect(markup).toContain('2026-09-06 00:01 UTC');
		expect(markup).not.toContain('19:13');
	});

	it('shows unavailable for invalid timestamps without crashing the page', () => {
		expect(
			renderToStaticMarkup(
				createElement(LocalDateTime, { dateTime: 'not-a-timestamp' })
			)
		).toBe('<span>Time unavailable</span>');
	});
});

function TimestampProbe(): React.JSX.Element {
	const format = useLocalDateTimeFormatter();
	return createElement(
		'span',
		null,
		format(timestamp),
		' / ',
		format('invalid')
	);
}

describe('local date time string formatter', () => {
	it('keeps server-rendered status text labeled and hydration-stable', () => {
		const markup = renderToStaticMarkup(createElement(TimestampProbe));
		expect(markup).toBe('<span>2026-09-05 19:13 UTC / Time unavailable</span>');
	});
});
