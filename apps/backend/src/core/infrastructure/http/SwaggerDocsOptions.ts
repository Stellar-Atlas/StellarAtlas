const swaggerCss = [
	'html, body, #swagger-ui { background: #101417 !important; color: #e8f0ef !important }',
	'.swagger-ui .topbar { display: none }',
	'.swagger-ui, .swagger-ui .wrapper { color: #e8f0ef }',
	'.swagger-ui .info .title, .swagger-ui .opblock-tag, .swagger-ui .scheme-container, .swagger-ui table thead tr td, .swagger-ui table thead tr th { color: #e8f0ef }',
	'.swagger-ui .info p, .swagger-ui .info li, .swagger-ui .info a, .swagger-ui .parameter__name, .swagger-ui .parameter__type, .swagger-ui .parameter__deprecated, .swagger-ui .parameter__extension, .swagger-ui .parameter__in, .swagger-ui .response-col_status, .swagger-ui .response-col_description, .swagger-ui .tab li, .swagger-ui label { color: #c3d0ce }',
	'.swagger-ui .scheme-container, .swagger-ui .opblock, .swagger-ui .opblock-body, .swagger-ui section.models, .swagger-ui .model-box, .swagger-ui .model-container, .swagger-ui .responses-wrapper, .swagger-ui .parameters-container, .swagger-ui .execute-wrapper { background: #182023 !important; border-color: #2b373b !important }',
	'.swagger-ui .opblock .opblock-summary, .swagger-ui section.models h4, .swagger-ui .responses-inner h4, .swagger-ui .responses-inner h5, .swagger-ui .opblock-title_normal, .swagger-ui .opblock-section-header h4 { color: #e8f0ef }',
	'.swagger-ui .opblock .opblock-summary-path, .swagger-ui .opblock .opblock-summary-description, .swagger-ui .opblock-summary-operation-id, .swagger-ui .opblock-summary-path__deprecated { color: #d9e7e4 }',
	'.swagger-ui .opblock-section-header { background: #11181b !important; box-shadow: none; border-color: #2b373b }',
	'.swagger-ui input, .swagger-ui textarea, .swagger-ui select { background: #0f1517 !important; color: #e8f0ef !important; border-color: #334247 !important }',
	'.swagger-ui .btn, .swagger-ui select { border-color: #79c7c0 !important; color: #d7fffb !important }',
	'.swagger-ui .model, .swagger-ui .model-title, .swagger-ui .prop-name, .swagger-ui .prop-type, .swagger-ui .prop-format, .swagger-ui .renderedMarkdown p, .swagger-ui .markdown p, .swagger-ui .json-schema-2020-12__title, .swagger-ui .json-schema-2020-12-json-viewer__name, .swagger-ui .json-schema-2020-12-json-viewer__value { color: #c3d0ce !important }',
	'.swagger-ui .highlight-code, .swagger-ui pre, .swagger-ui code { background: #0f1517 !important; color: #e8f0ef !important }'
].join('\n');

export const swaggerDocsOptions = {
	customCss: swaggerCss,
	customSiteTitle: 'StellarAtlas API docs',
	explorer: true
};
