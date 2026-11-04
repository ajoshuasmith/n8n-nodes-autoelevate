import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	autoElevateApiRequest,
	createHmacAuthorization,
	getAutoElevateErrorDetails,
	parseRetryAfterMs,
} from '../dist/nodes/AutoElevate/GenericFunctions.js';

const testNode = {
	name: 'AutoElevate',
	type: '@joshuanode/n8n-nodes-autoelevate.autoElevate',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

test('creates the documented AE-HMAC-SHA256 authorization value', () => {
	const method = 'POST';
	const url = 'https://partner-api.autoelevate.com/api/v1/elevation-requests/123/approve';
	const body = '{"createRule":false}';
	const timestamp = '1716900000000';
	const bodyHash = createHash('sha256').update(body).digest('hex');
	const payload = ['AE-HMAC-SHA256', method, url, bodyHash, timestamp].join('\n');
	const signature = createHmac('sha256', 'test-signing-key').update(payload).digest('hex');

	assert.equal(
		createHmacAuthorization(method, url, body, 'aeh_test', 'test-signing-key', timestamp),
		`AE-HMAC-SHA256 token=aeh_test,bodyHash=${bodyHash},ts=${timestamp},sig=${signature}`,
	);
});

test('uses the documented empty-body hash', () => {
	const authorization = createHmacAuthorization(
		'GET',
		'https://partner-api.autoelevate.com/api/v1/usage',
		'',
		'aeh_test',
		'test-signing-key',
		'1716900000000',
	);
	assert.match(
		authorization,
		/bodyHash=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855/,
	);
});

test('retains the original v1 resource families and approval actions', async () => {
	const source = await readFile(
		new URL('../nodes/AutoElevate/AutoElevate.node.ts', import.meta.url),
		'utf8',
	);
	const paths = [
		'/api/v1/audit-logs',
		'/api/v1/companies',
		'/api/v1/computers',
		'/api/v1/elevated-sessions',
		'/api/v1/elevation-events',
		'/api/v1/elevation-requests',
		'/api/v1/elevation-rules',
		'/api/v1/locations',
		'/api/v1/usage',
	];
	for (const path of paths) assert.ok(source.includes(path), `Missing route family: ${path}`);
	assert.ok(source.includes('${id}/${operation}'), 'Missing approve/deny action route');
});

test('extracts n8n HTTP response status and preserves the AutoElevate response body', () => {
	const responseBody = {
		name: 'ForbiddenError',
		message: 'You are not authorized to perform this action. (67334)',
	};
	assert.deepEqual(
		getAutoElevateErrorDetails({
			response: {
				status: 403,
				data: responseBody,
				headers: { 'retry-after': '60' },
			},
		}),
		{
			statusCode: 403,
			responseBody,
			responseMessage: 'You are not authorized to perform this action. (67334)',
			retryAfter: '60',
		},
	);
});

test('reads headers from an AxiosHeaders-style object that requires a bound `this`', () => {
	// Regression: n8n's httpRequest rejects with a real AxiosError whose `headers` is an
	// AxiosHeaders instance. Its `get` does Object.keys(this) internally, so calling it
	// unbound threw TypeError and crashed the whole error handler on EVERY failure.
	class FakeAxiosHeaders {
		constructor(values) {
			Object.assign(this, values);
		}

		get(name) {
			const key = Object.keys(this).find((k) => k.toLowerCase() === name.toLowerCase());
			return key === undefined ? undefined : this[key];
		}
	}

	const details = getAutoElevateErrorDetails({
		response: {
			status: 429,
			data: { message: 'Too many requests' },
			headers: new FakeAxiosHeaders({ 'Retry-After': '30' }),
		},
	});

	assert.equal(details.statusCode, 429);
	assert.equal(details.retryAfter, '30');
	assert.equal(details.responseMessage, 'Too many requests');
});

test('parses Retry-After seconds and HTTP dates', () => {
	assert.equal(parseRetryAfterMs('2', 0), 2000);
	assert.equal(parseRetryAfterMs('Thu, 01 Jan 1970 00:00:05 GMT', 1000), 4000);
	assert.equal(parseRetryAfterMs(undefined, 0), 1000);
});

test('retries a 429 using Retry-After and then returns the response', async () => {
	let calls = 0;
	const context = {
		getCredentials: async () => ({
			authentication: 'bearer',
			apiToken: 'aeb_test',
			baseUrl: 'https://partner-api.autoelevate.com',
		}),
		getNode: () => testNode,
		helpers: {
			httpRequest: async () => {
				calls += 1;
				if (calls === 1) {
					throw {
						response: {
							status: 429,
							data: { message: 'Slow down' },
							headers: { 'retry-after': '0' },
						},
					};
				}
				return { partnerName: 'Test MSP' };
			},
		},
	};
	const response = await autoElevateApiRequest.call(context, 'GET', '/api/v1/usage');
	assert.equal(calls, 2);
	assert.equal(response.partnerName, 'Test MSP');
});

test('surfaces AutoElevate response messages through NodeApiError', async () => {
	const context = {
		getCredentials: async () => ({
			authentication: 'bearer',
			apiToken: 'aeb_test',
			baseUrl: 'https://partner-api.autoelevate.com',
		}),
		getNode: () => testNode,
		helpers: {
			httpRequest: async () => {
				throw {
					response: {
						status: 403,
						data: {
							name: 'ForbiddenError',
							message: 'You are not authorized to perform this action. (67334)',
						},
					},
				};
			},
		},
	};
	await assert.rejects(
		() => autoElevateApiRequest.call(context, 'GET', '/api/v1/audit-logs'),
		/You are not authorized to perform this action\. \(67334\)/,
	);
});

test('does not retain the disabled cursor expression', async () => {
	const source = await readFile(
		new URL('../nodes/AutoElevate/AutoElevate.node.ts', import.meta.url),
		'utf8',
	);
	assert.equal(source.includes("resource === 'elevation-requests' && false"), false);
});

test('credential does not apply a hard-coded Bearer header', async () => {
	const source = await readFile(
		new URL('../credentials/AutoElevateApi.credentials.ts', import.meta.url),
		'utf8',
	);
	assert.equal(source.includes('authenticate ='), false);
	assert.equal(source.includes('test: ICredentialTestRequest'), false);
});
