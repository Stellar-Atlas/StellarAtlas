import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { DataSource } from 'typeorm';
import { Container } from 'inversify';
import { mock } from 'jest-mock-extended';
import { ArchiveEvidenceCursorCodec } from '../../../use-cases/get-known-archive-evidence/ArchiveEvidenceCursorCodec.js';
import { load } from '../container.js';
import { TYPES } from '../di-types.js';

describe('archive evidence cursor startup configuration', () => {
	const originalKeys = process.env.ARCHIVE_EVIDENCE_CURSOR_KEYS;

	afterEach(() => {
		if (originalKeys === undefined) {
			delete process.env.ARCHIVE_EVIDENCE_CURSOR_KEYS;
		} else {
			process.env.ARCHIVE_EVIDENCE_CURSOR_KEYS = originalKeys;
		}
	});

	it('blocks production DI startup when cursor keys are absent', () => {
		delete process.env.ARCHIVE_EVIDENCE_CURSOR_KEYS;

		expect(() => load(createContainer(), productionConfig())).toThrow(
			'ARCHIVE_EVIDENCE_CURSOR_KEYS is required in production'
		);
	});

	it('blocks production DI startup when a cursor key is malformed', () => {
		process.env.ARCHIVE_EVIDENCE_CURSOR_KEYS = 'active:placeholder';

		expect(() => load(createContainer(), productionConfig())).toThrow(
			'cursor secret must be base64url and 32 bytes'
		);
	});

	it('binds the codec when the production key ring is valid', () => {
		process.env.ARCHIVE_EVIDENCE_CURSOR_KEYS = `active:${Buffer.alloc(32, 7).toString('base64url')}`;
		const container = createContainer();

		expect(() => load(container, productionConfig())).not.toThrow();
		expect(container.get(TYPES.ArchiveEvidenceCursorCodec)).toBeInstanceOf(
			ArchiveEvidenceCursorCodec
		);
	});
});

function createContainer(): Container {
	const container = new Container();
	container.bind(DataSource).toConstantValue(mock<DataSource>());
	return container;
}

function productionConfig(): ConfigMock {
	const config = new ConfigMock();
	config.nodeEnv = 'production';
	return config;
}
