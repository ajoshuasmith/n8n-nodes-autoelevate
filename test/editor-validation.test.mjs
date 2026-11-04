import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { AutoElevate } from '../dist/nodes/AutoElevate/AutoElevate.node.js';

const require = createRequire(import.meta.url);
const { NodeHelpers } = require('n8n-workflow');
const description = new AutoElevate().description;
const id = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

function issues(parameters) {
	const node = {
		name: 'Probe', type: description.name, typeVersion: 1,
		position: [0, 0], parameters,
		credentials: { autoElevateApi: { id: 'example', name: 'Example' } },
	};
	node.parameters = NodeHelpers.getNodeParameters(
		description.properties, parameters, true, false, node, description,
	);
	return NodeHelpers.getNodeParametersIssues(description.properties, node, description);
}

for (const resource of ['auditLog', 'company', 'computer', 'elevatedSession', 'elevationEvent', 'elevationRequest', 'elevationRule', 'location', 'role', 'user', 'webhook']) {
	test(`n8n accepts ${resource} reads without an unrelated role`, () => {
		assert.equal(issues({ resource, operation: 'getMany', returnAll: false, limit: 1 }), null);
	});
}

test('n8n accepts a user update that leaves the role unchanged', () => {
	assert.equal(issues({ resource: 'user', operation: 'update', userId: { mode: 'id', value: id }, updateFields: { lastName: 'Example' } }), null);
});

test('creating a user still requires its top-level role selector', () => {
	assert.ok(issues({ resource: 'user', operation: 'create', firstName: 'Example', email: 'example@example.com' })?.parameters?.roleId);
});
