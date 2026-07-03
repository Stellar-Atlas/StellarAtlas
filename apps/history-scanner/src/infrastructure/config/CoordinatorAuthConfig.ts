export type CoordinatorAuthConfig =
	| {
			readonly type: 'internal';
			readonly username: string;
			readonly password: string;
	  }
	| {
			readonly type: 'community';
			readonly scannerId: string;
			readonly apiKey: string;
	  };

export type CoordinatorAuthMode = CoordinatorAuthConfig['type'];

export function isCoordinatorAuthMode(
	value: string
): value is CoordinatorAuthMode {
	return value === 'internal' || value === 'community';
}
