import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AutoElevate } from '../dist/nodes/AutoElevate/AutoElevate.node.js';

const node = new AutoElevate();
const id = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const locator = { mode: 'id', value: id };
const spec = JSON.parse(
	await readFile(new URL('./fixtures/openapi-2026-10-27.json', import.meta.url)),
);
const testNode = {
	name: 'AutoElevate',
	type: 'autoElevate',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

function harness(
	parameters,
	responder,
	count = 1,
	continueOnFail = false,
	authentication = 'bearer',
) {
	const calls = [];
	const context = {
		getInputData: () => Array.from({ length: count }, () => ({ json: {} })),
		getNodeParameter: (key, index, fallback) =>
			Object.hasOwn(parameters, key) ? parameters[key] : fallback,
		getNode: () => testNode,
		continueOnFail: () => continueOnFail,
		async getCredentials() {
			return {
				authentication,
				apiToken: 'example',
				hmacToken: 'example',
				hmacKey: 'signing-key',
				baseUrl: 'https://partner-api.autoelevate.com',
			};
		},
		helpers: {
			httpRequest: async (options) => {
				calls.push(options);
				return responder
					? responder(options, calls.length)
					: {
							id,
							items: [{ id }],
							totalCount: 1,
							deliveryLogs: [{ id }],
							pending: true,
						};
			},
		},
	};
	return { calls, context, run: () => node.execute.call(context) };
}

test('cancellation stops later input items even with Continue On Fail enabled', async () => {
	const controller = new AbortController();
	const canceled = new Error('Execution canceled');
	const h = harness({ resource: 'user', operation: 'getMany', limit: 1 }, () => {
		controller.abort(canceled);
		return { items: [{ id }], totalCount: 1 };
	}, 3, true);
	h.context.getExecutionCancelSignal = () => controller.signal;
	await assert.rejects(h.run(), (error) => error === canceled);
	assert.equal(h.calls.length, 1);
});

// Each case exercises the public n8n node, including its dispatcher and transport.
const cases = [
	['auditLog', 'getMany', 'GET', '/api/v1/audit-logs'],
	['company', 'getMany', 'GET', '/api/v1/companies'],
	['company', 'get', 'GET', `/api/v1/companies/${id}`],
	['computer', 'getMany', 'GET', '/api/v1/computers'],
	['computer', 'get', 'GET', `/api/v1/computers/${id}`],
	['computer', 'delete', 'DELETE', `/api/v1/computers/${id}`],
	[
		'computer',
		'setTechnicianMode',
		'POST',
		`/api/v1/computers/${id}/technician-mode`,
		{ enabled: false },
	],
	[
		'computer',
		'setElevationMode',
		'POST',
		`/api/v1/computers/${id}/elevation-mode`,
		{ mode: 'inherit' },
	],
	['elevatedSession', 'getMany', 'GET', '/api/v1/elevated-sessions'],
	['elevatedSession', 'get', 'GET', `/api/v1/elevated-sessions/${id}`],
	['elevationEvent', 'getMany', 'GET', '/api/v1/elevation-events'],
	['elevationEvent', 'get', 'GET', `/api/v1/elevation-events/${id}`],
	['elevationRequest', 'getMany', 'GET', '/api/v1/elevation-requests'],
	['elevationRequest', 'get', 'GET', `/api/v1/elevation-requests/${id}`],
	[
		'elevationRequest',
		'approve',
		'POST',
		`/api/v1/elevation-requests/${id}/approve`,
		{ createRule: false },
	],
	[
		'elevationRequest',
		'deny',
		'POST',
		`/api/v1/elevation-requests/${id}/deny`,
		{ createRule: false, denialReason: 'Untrusted publisher' },
	],
	['elevationRule', 'getMany', 'GET', '/api/v1/elevation-rules'],
	['elevationRule', 'get', 'GET', `/api/v1/elevation-rules/${id}`],
	['elevationRule', 'update', 'PATCH', `/api/v1/elevation-rules/${id}`, { approved: false }],
	['elevationRule', 'delete', 'DELETE', `/api/v1/elevation-rules/${id}`],
	['location', 'getMany', 'GET', '/api/v1/locations'],
	['location', 'get', 'GET', `/api/v1/locations/${id}`],
	['role', 'getMany', 'GET', '/api/v1/roles'],
	['role', 'get', 'GET', `/api/v1/roles/${id}`],
	['usage', 'get', 'GET', '/api/v1/usage'],
	['user', 'getMany', 'GET', '/api/v1/users'],
	[
		'user',
		'create',
		'POST',
		'/api/v1/users',
		{
			firstName: 'Dana',
			email: 'dana@example.com',
			roleId: id,
			companyAccess: { type: 'none' },
		},
	],
	['user', 'get', 'GET', `/api/v1/users/${id}`],
	['user', 'update', 'PATCH', `/api/v1/users/${id}`, { lastName: '' }],
	['user', 'delete', 'DELETE', `/api/v1/users/${id}`],
	['webhook', 'getMany', 'GET', '/api/v1/webhooks'],
	[
		'webhook',
		'create',
		'POST',
		'/api/v1/webhooks',
		{
			name: 'Approvals',
			url: 'https://example.com/events',
			eventSubscriptions: ['request.created'],
		},
	],
	['webhook', 'get', 'GET', `/api/v1/webhooks/${id}`],
	['webhook', 'update', 'PATCH', `/api/v1/webhooks/${id}`, { enabled: false }],
	['webhook', 'delete', 'DELETE', `/api/v1/webhooks/${id}`],
	['webhook', 'getDeliveryLogs', 'GET', `/api/v1/webhooks/${id}/delivery-logs`],
	['webhook', 'test', 'POST', `/api/v1/webhooks/${id}/test`],
];

const contractRoutes = new Set();
for (const [resource, operation, method, path, body] of cases) {
	const template = path.replaceAll(id, '{id}');
	contractRoutes.add(`${method.toLowerCase()} ${template}`);
	test(`${resource}.${operation} uses the documented method, path and body`, async () => {
		const h = harness({
			resource,
			operation,
			companyId: locator,
			computerId: locator,
			locationId: locator,
			roleId: locator,
			userId: locator,
			webhookId: locator,
			elevationRuleId: locator,
			elevationEventId: locator,
			elevatedSessionId: locator,
			elevationRequestId: locator,
			confirmDeletion: true,
			returnAll: false,
			limit: 50,
			createRule: false,
			enabled: false,
			mode: 'inherit',
			denialReason: 'Untrusted publisher',
			firstName: 'Dana',
			email: 'dana@example.com',
			name: 'Approvals',
			url: 'https://example.com/events',
			eventSubscriptions: ['request.created'],
			updateFields:
				resource === 'elevationRule'
					? { approved: false }
					: resource === 'user'
						? { lastName: '' }
						: { enabled: false },
		});
		const [output] = await h.run();
		assert.equal(h.calls.length, 1);
		const call = h.calls[0];
		assert.equal(call.method, method);
		assert.equal(new URL(call.url).pathname, path);
		assert.deepEqual(call.body === undefined ? undefined : JSON.parse(call.body), body);
		assert.equal(call.headers['X-Acknowledgment'], 'i-understand-this-is-beta-and-may-change');
		assert.equal(call.headers.Authorization, 'Bearer example');
		assert.equal(output.length, 1);
		assert.deepEqual(output[0].pairedItem, { item: 0 });
		const endpoint = spec.paths[template][method.toLowerCase()];
		const allowedQuery = endpoint.parameters.filter((p) => p.in === 'query').map((p) => p.name);
		for (const key of new URL(call.url).searchParams.keys())
			assert.ok(allowedQuery.includes(key), `Undocumented query ${key}`);
		const operationField = node.description.properties.find(
			(p) => p.name === 'operation' && p.displayOptions?.show?.resource?.includes(resource),
		);
		assert.ok(
			operationField.options.some((option) => option.value === operation),
			'Operation must be visible in the editor',
		);
		if (endpoint.requestBody) {
			const ref = endpoint.requestBody.content['application/json'].schema.$ref.split('/').pop();
			const schema = spec.components.schemas[ref];
			for (const key of schema.required ?? [])
				assert.ok(Object.hasOwn(body, key), `Missing required ${key}`);
			if (schema.additionalProperties === false)
				for (const key of Object.keys(body))
					assert.ok(Object.hasOwn(schema.properties, key), `Undocumented body ${key}`);
		}
	});
}

test('execution cases cover every method and path in the frozen public specification', () => {
	const expected = Object.entries(spec.paths).flatMap(([path, operations]) =>
		Object.keys(operations)
			.filter((method) => ['get', 'post', 'patch', 'delete'].includes(method))
			.map((method) => `${method} ${path}`),
	);
	assert.deepEqual([...contractRoutes].sort(), expected.sort());
});

test('rule updates preserve false, clear nullable fields and parse opaque criteria', async () => {
	const h = harness({
		resource: 'elevationRule',
		operation: 'update',
		elevationRuleId: locator,
		updateFields: {
			approved: false,
			shouldIgnore: false,
			notes: '',
			friendlyName: '',
			identificationCriteria: '{"publisher":"Example"}',
		},
	});
	await h.run();
	assert.deepEqual(JSON.parse(h.calls[0].body), {
		approved: false,
		shouldIgnore: false,
		notes: null,
		friendlyName: null,
		identificationCriteria: { publisher: 'Example' },
	});
});

for (const type of ['all', 'none', 'some', 'most'])
	test(`company access replaces the complete ${type} shape`, async () => {
		const h = harness({
			resource: 'user',
			operation: 'update',
			userId: locator,
			companyAccessType: type,
			companies: { company: [{ companyId: locator }, { companyId: locator }] },
			updateFields: { technicianModeTicketingEnabled: false, roleId: locator },
		});
		await h.run();
		assert.deepEqual(JSON.parse(h.calls[0].body), {
			technicianModeTicketingEnabled: false,
			roleId: id,
			companyAccess: {
				type,
				...(['some', 'most'].includes(type) ? { companyIds: [id] } : {}),
			},
		});
	});

test('webhook scope can be explicitly cleared without altering omitted settings', async () => {
	const h = harness({
		resource: 'webhook',
		operation: 'update',
		webhookId: locator,
		updateFields: { companyId: { mode: 'id', value: '' }, enabled: false },
	});
	await h.run();
	assert.deepEqual(JSON.parse(h.calls[0].body), {
		companyId: null,
		enabled: false,
	});
});

test('silent user creation preserves explicit invitation and ticketing flags', async () => {
	const h = harness({
		resource: 'user',
		operation: 'create',
		firstName: 'Dana',
		email: 'dana@example.com',
		roleId: locator,
		additionalFields: {
			sendInvitationEmail: false,
			technicianModeTicketingEnabled: false,
		},
	});
	await h.run();
	assert.equal(JSON.parse(h.calls[0].body).sendInvitationEmail, false);
});

for (const [resource, extra, message] of [
	['computer', { operation: 'delete', computerId: locator }, /Confirm Deletion/],
	['user', { operation: 'delete', userId: locator }, /Confirm Deletion/],
	['webhook', { operation: 'delete', webhookId: locator }, /Confirm Deletion/],
	['elevationRule', { operation: 'delete', elevationRuleId: locator }, /Confirm Deletion/],
	[
		'user',
		{ operation: 'update', userId: locator, companyAccessType: 'some' },
		/at least one company/,
	],
	[
		'elevationRule',
		{
			operation: 'update',
			elevationRuleId: locator,
			updateFields: { approved: false, companyId: id },
		},
		/Unsupported field/,
	],
	[
		'elevationRule',
		{
			operation: 'update',
			elevationRuleId: locator,
			updateFields: { identificationCriteria: '[]' },
		},
		/JSON object/,
	],
	[
		'elevationRule',
		{
			operation: 'update',
			elevationRuleId: locator,
			updateFields: { identificationCriteria: 'null' },
		},
		/JSON object/,
	],
	[
		'elevationRule',
		{
			operation: 'update',
			elevationRuleId: locator,
			updateFields: { identificationCriteria: '{' },
		},
		/valid JSON/,
	],
	['user', { operation: 'update', userId: locator }, /at least one field/],
	[
		'webhook',
		{
			operation: 'create',
			url: 'http://example.com',
			eventSubscriptions: ['request.created'],
		},
		/HTTPS/,
	],
	[
		'webhook',
		{ operation: 'create', url: 'https://example.com', eventSubscriptions: [] },
		/at least one webhook event/,
	],
	[
		'webhook',
		{
			operation: 'create',
			eventSubscriptions: ['user.created'],
			additionalFields: { companyId: locator },
		},
		/all companies/,
	],
	['user', { operation: 'get', userId: '../usage' }, /UUID/],
	['user', { operation: 'unknown' }, /Unsupported operation/],
])
	test(`rejects ${resource} ${JSON.stringify(extra)} before HTTP`, async () => {
		const h = harness({ resource, ...extra });
		await assert.rejects(h.run, message);
		assert.equal(h.calls.length, 0);
	});

for (const resource of ['user', 'webhook'])
	test(`${resource} list paginates and honors the limit`, async () => {
		const h = harness({ resource, operation: 'getMany', limit: 201 }, (options) => {
			const url = new URL(options.url);
			const take = Number(url.searchParams.get('take'));
			return {
				items: Array.from({ length: take }, () => ({ id })),
				totalCount: 300,
			};
		});
		const [output] = await h.run();
		assert.equal(output.length, 201);
		assert.equal(h.calls.length, 2);
		assert.equal(new URL(h.calls[1].url).searchParams.get('skip'), '200');
		assert.equal(new URL(h.calls[1].url).searchParams.get('take'), '1');
	});

test('computer actions return the queued state without claiming activation', async () => {
	const h = harness(
		{
			resource: 'computer',
			operation: 'setElevationMode',
			computerId: locator,
			mode: 'live',
		},
		() => ({ id, pending: true, elevationMode: 'audit' }),
	);
	const [output] = await h.run();
	assert.deepEqual(output[0].json, {
		id,
		pending: true,
		elevationMode: 'audit',
	});
});

test('new operations preserve item pairing and continue-on-fail for each input', async () => {
	const h = harness(
		{ resource: 'user', operation: 'get', userId: locator },
		(_, call) => {
			if (call === 1) throw { response: { status: 403, data: { message: 'Missing scope' } } };
			return { id };
		},
		2,
		true,
	);
	const [output] = await h.run();
	assert.match(output[0].json.error, /Missing scope/);
	assert.deepEqual(
		output.map((item) => item.pairedItem),
		[{ item: 0 }, { item: 1 }],
	);
	assert.equal(output[1].json.id, id);
});

test('HMAC signs the exact PATCH bytes again after a 429', async () => {
	const h = harness(
		{
			resource: 'elevationRule',
			operation: 'update',
			elevationRuleId: locator,
			updateFields: { approved: false, notes: 'café' },
		},
		(_, call) => {
			if (call === 1)
				throw {
					response: { status: 429, headers: { 'retry-after': '0' }, data: {} },
				};
			return { id };
		},
		1,
		false,
		'hmac',
	);
	await h.run();
	assert.equal(h.calls.length, 2);
	for (const call of h.calls) {
		const hash = createHash('sha256').update(call.body).digest('hex');
		const ts = call.headers.Authorization.match(/ts=(\d+)/)[1];
		const sig = createHmac('sha256', 'signing-key')
			.update(['AE-HMAC-SHA256', 'PATCH', call.url, hash, ts].join('\n'))
			.digest('hex');
		assert.equal(
			call.headers.Authorization,
			`AE-HMAC-SHA256 token=example,bodyHash=${hash},ts=${ts},sig=${sig}`,
		);
	}
});

for (const [method, resource] of [
	['searchUsers', 'users'],
	['searchRoles', 'roles'],
	['searchWebhooks', 'webhooks'],
	['searchElevationRules', 'elevation-rules'],
	['searchElevationEvents', 'elevation-events'],
])
	test(`${method} searches the correct API resource`, async () => {
		const h = harness({}, () => ({
			items: [{ id, name: 'Example', firstName: 'Dana', email: 'dana@example.com' }],
			totalCount: 1,
		}));
		const result = await node.methods.listSearch[method].call(h.context, 'example');
		assert.equal(result.results[0].value, id);
		assert.equal(new URL(h.calls[0].url).pathname, `/api/v1/${resource}`);
		if (resource === 'roles') assert.equal(new URL(h.calls[0].url).search, '');
	});

test('webhook event and mode selectors match the frozen API enums', () => {
	const fields = node.description.properties;
	const webhookFields = fields.filter((field) =>
		field.displayOptions?.show?.resource?.includes('webhook'),
	);
	const createEvents = webhookFields.find((field) => field.name === 'eventSubscriptions');
	assert.deepEqual(
		createEvents.options.map((option) => option.value).sort(),
		[...spec.components.schemas.WebhookEventType.enum].sort(),
	);
	const mode = fields.find((field) => field.name === 'mode');
	assert.deepEqual(
		mode.options.map((option) => option.value).sort(),
		[...spec.components.schemas.SettableElevationMode.enum].sort(),
	);
});

test('opaque criteria require an explicit object instead of defaulting to an empty match', async () => {
	const update = node.description.properties.find(
		(field) =>
			field.name === 'updateFields' && field.displayOptions.show.resource.includes('elevationRule'),
	);
	const criteria = update.options.find((field) => field.name === 'identificationCriteria');
	const h = harness({
		resource: 'elevationRule',
		operation: 'update',
		elevationRuleId: locator,
		updateFields: { identificationCriteria: criteria.default },
	});
	await assert.rejects(h.run, /valid JSON/);
	assert.equal(h.calls.length, 0);
});

test('UUID locators and execution accept newer UUID versions declared by the API format', async () => {
	const value = '019a2e40-1234-7890-abcd-ef1234567890';
	const userId = node.description.properties.find((field) => field.name === 'userId');
	const pattern = userId.modes.find((mode) => mode.name === 'id').validation[0].properties.regex;
	assert.match(value, new RegExp(pattern));
	const h = harness({ resource: 'user', operation: 'get', userId: { mode: 'id', value } });
	await h.run();
	assert.equal(new URL(h.calls[0].url).pathname, `/api/v1/users/${value}`);
});
