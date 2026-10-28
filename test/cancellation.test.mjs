import assert from 'node:assert/strict';
import test from 'node:test';
import { autoElevateApiRequest } from '../dist/nodes/AutoElevate/GenericFunctions.js';

const testNode = { name: 'AutoElevate', type: 'autoElevate', typeVersion: 1, position: [0, 0], parameters: {} };

test('cancels an in-flight HTTP request without retrying it', async () => {
	const controller = new AbortController();
	const canceled = new Error('Execution canceled');
	let calls = 0;
	let requestStarted;
	const started = new Promise((resolve) => { requestStarted = resolve; });
	const context = {
		getExecutionCancelSignal: () => controller.signal,
		async getCredentials() {
			return { authentication: 'bearer', apiToken: 'example', baseUrl: 'https://partner-api.autoelevate.com' };
		},
		getNode: () => testNode,
		helpers: { httpRequest: (options) => new Promise((resolve, reject) => {
			calls++;
			options.abortSignal.addEventListener('abort', () => reject(canceled), { once: true });
			requestStarted();
		}) },
	};
	const pending = autoElevateApiRequest.call(context, 'GET', '/api/v1/users');
	await started;
	controller.abort(canceled);
	await assert.rejects(pending, (error) => error === canceled);
	assert.equal(calls, 1);
});

test('cancellation interrupts Retry-After without issuing another request', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const controller = new AbortController();
	const canceled = new Error('Execution canceled during rate-limit backoff');
	let calls = 0;
	const context = {
		getExecutionCancelSignal: () => controller.signal,
		async getCredentials() {
			return { authentication: 'bearer', apiToken: 'example', baseUrl: 'https://partner-api.autoelevate.com' };
		},
		getNode: () => testNode,
		helpers: { httpRequest: async () => {
			calls++;
			throw { response: { status: 429, headers: { 'retry-after': '60' }, data: {} } };
		} },
	};
	const pending = autoElevateApiRequest.call(context, 'GET', '/api/v1/users');
	await new Promise(setImmediate);
	controller.abort(canceled);
	await assert.rejects(pending, (error) => error === canceled);
	t.mock.timers.tick(60_000);
	assert.equal(calls, 1);
});

test('cancellation stops waiting when an older n8n helper ignores abortSignal', async () => {
	const controller = new AbortController();
	const canceled = new Error('Execution canceled');
	let finishRequest;
	let requestStarted;
	const started = new Promise((resolve) => { requestStarted = resolve; });
	const context = {
		getExecutionCancelSignal: () => controller.signal,
		async getCredentials() {
			return { authentication: 'bearer', apiToken: 'example', baseUrl: 'https://partner-api.autoelevate.com' };
		},
		getNode: () => testNode,
		helpers: { httpRequest: () => new Promise((resolve) => {
			finishRequest = resolve;
			requestStarted();
		}) },
	};
	const pending = autoElevateApiRequest.call(context, 'GET', '/api/v1/users');
	await started;
	controller.abort(canceled);
	await assert.rejects(pending, (error) => error === canceled);
	finishRequest({ items: [] });
});

