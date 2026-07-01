import { Timer } from '../utilities/timer.js';

export class ConsensusTimer {
	constructor(
		private timer: Timer,
		private consensusTimeoutMS: number
	) {}

	start(callback: () => void) {
		this.timer.start(this.consensusTimeoutMS, callback);
	}

	stop() {
		this.timer.stopTimer();
	}
}
