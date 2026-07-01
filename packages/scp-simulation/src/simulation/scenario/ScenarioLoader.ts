import {
	FederatedVotingContext,
	FederatedVotingContextFactory
} from '../../federated-voting/index.js';
import { Scenario } from './Scenario.js';
import { Simulation } from '../Simulation.js';

export class ScenarioLoader {
	loadScenario(scenario: Scenario): {
		protocolContext: FederatedVotingContext;
		simulation: Simulation;
	} {
		const protocolContext = FederatedVotingContextFactory.create(
			scenario.isOverlayFullyConnected,
			scenario.isOverlayGossipEnabled
		);

		const simulation = new Simulation(
			protocolContext,
			scenario.initialSimulationStep
		);

		return {
			protocolContext,
			simulation
		};
	}
}
