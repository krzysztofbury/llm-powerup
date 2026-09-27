'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pluginRoot = path.join(__dirname, '..');
const integrationRoot = path.join(pluginRoot, '..');

test('the 15-key profile references installed actions and has the current layout', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'manifest.json')));
  const profile = JSON.parse(fs.readFileSync(path.join(integrationRoot, 'profiles/Agents/Home.json')));
  const actionIds = new Set(manifest.Actions.map((action) => action.UUID));

  assert.equal(profile.keys.length, 15);
  assert.equal(profile.keys[0].action.uuid, 'com.amansprojects.starterpack.switchprofile');
  assert.equal(profile.keys[0].settings.device, 'sd-DEVICE_ID');
  assert.equal(profile.keys[0].settings.profile, 'Default');
  assert.deepEqual(profile.keys.slice(1, 5).map((key) => key.action.uuid), [
    'dev.krzysztof.agents.pulse',
    'dev.krzysztof.agents.quota',
    'dev.krzysztof.agents.activity',
    'dev.krzysztof.agents.activity',
  ]);
  assert.deepEqual(profile.keys.slice(3, 5).map((key) => key.settings.hours), [24, 168]);
  for (const [position, key] of profile.keys.entries()) {
    assert.equal(key.context, `Keypad.${position}.0`);
    if (position >= 5) {
      assert.equal(key.action.uuid, 'dev.krzysztof.agents.session');
      assert.equal(key.settings.slot, position - 5);
    }
    if (key.action.plugin === 'dev.krzysztof.agents.sdPlugin') {
      assert.ok(actionIds.has(key.action.uuid), `manifest is missing ${key.action.uuid}`);
      assert.ok(fs.existsSync(path.join(integrationRoot, key.action.icon.replace(/^plugins\//, ''))), `missing icon ${key.action.icon}`);
    }
  }
});
