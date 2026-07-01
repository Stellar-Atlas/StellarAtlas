import {
	ConsoleInterfacer,
	ConsoleAdjacencyMatrixVisualization
} from './console-interface/index.js';
import { ScenarioLoader } from './simulation/index.js';

new ConsoleInterfacer(
	new ConsoleAdjacencyMatrixVisualization(),
	new ScenarioLoader()
);
