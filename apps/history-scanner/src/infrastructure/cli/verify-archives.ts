import {
	isMainModule,
	parseVerifyArchivesCliOptions,
	runVerifyArchives
} from './verify-archives-runner.js';

if (isMainModule(import.meta.url)) {
	void runVerifyArchives(parseVerifyArchivesCliOptions(process.argv.slice(2)));
}
