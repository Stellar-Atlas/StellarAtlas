import { HttpQueue } from 'http-helper';

export const TYPES = {
	CheckPointFrequency: Symbol('CheckPointFrequency'),
	HistoryArchiveContentReuseEnabled: Symbol(
		'HistoryArchiveContentReuseEnabled'
	),
	ScanScheduler: Symbol('ScanScheduler'),
	ScanCoordinatorService: Symbol('ScanCoordinatorService'),
	HistoryArchiveObjectJobSource: Symbol('HistoryArchiveObjectJobSource'),
	HistoryArchiveWorkerStatusReporter: Symbol(
		'HistoryArchiveWorkerStatusReporter'
	),
	JobMonitor: Symbol('JobMonitor'),
	ExceptionLogger: Symbol('ExceptionLogger'),
	HttpQueue: Symbol('HttpQueue'),
	HttpService: Symbol('HttpService'),
	ScanWorkerCount: Symbol('ScanWorkerCount'),
	HasherWorkerCount: Symbol('HasherWorkerCount')
};
