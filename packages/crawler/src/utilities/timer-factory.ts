import { Timer } from './timer.js';

export class TimerFactory {
	createTimer() {
		return new Timer();
	}
}
