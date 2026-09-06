import { swaggerDocsOptions } from '../SwaggerDocsOptions.js';

it('enables built-in tag filtering and keeps schema models available but collapsed initially', () => {
	expect(swaggerDocsOptions.swaggerOptions).toMatchObject({
		filter: true,
		deepLinking: true,
		defaultModelsExpandDepth: 0,
		defaultModelExpandDepth: 1,
		docExpansion: 'none'
	});
});
