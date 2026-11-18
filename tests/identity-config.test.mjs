import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IDENTITY_CONFIG_FORMAT, parseIdentityConfig, buildIdentityConfig,
  applyIdentityConfig, adoptReservedIdentities, sanitizeIdentityGroups,
} from '../assets/identity-config.js';

const known = keys => new Set(keys);

test('export contains identities, order and schedules but no history', () => {
  const config = buildIdentityConfig([
    {displayName:'Alice', emails:['a@x.test','github:alice'], workingDays:[1,2,3,4]},
    {displayName:'Empty', emails:[]},
  ], [], '2026-11-18T00:00:00.000Z');
  assert.deepEqual(config, {format:IDENTITY_CONFIG_FORMAT, version:1, exportedAt:'2026-11-18T00:00:00.000Z',
    groups:[{displayName:'Alice', identities:['a@x.test','github:alice'], workingDays:[1,2,3,4]}]});
  assert.deepEqual(parseIdentityConfig(JSON.parse(JSON.stringify(config))),
    [{displayName:'Alice', emails:['a@x.test','github:alice'], workingDays:[1,2,3,4]}]);
});

test('parse accepts session exports and rejects unrelated or newer files', () => {
  const groups = parseIdentityConfig({version:3, rawLog:'…', mergeGroups:[{displayName:'Bob', emails:['B@X.test ']}]});
  assert.deepEqual(groups, [{displayName:'Bob', emails:['b@x.test']}]);
  assert.throws(() => parseIdentityConfig({hello:'world'}), /does not contain/);
  assert.throws(() => parseIdentityConfig({format:IDENTITY_CONFIG_FORMAT, version:99, groups:[]}), /newer version/);
  assert.throws(() => parseIdentityConfig({format:IDENTITY_CONFIG_FORMAT, version:1, groups:[]}), /any contributor/);
});

test('sanitising claims each key once and skips malformed entries', () => {
  assert.deepEqual(sanitizeIdentityGroups([
    {displayName:'A', identities:['a@x.test', 7, '', 'a@x.test'], workingDays:[9]},
    {displayName:'B', emails:['A@x.test']},
    null, {displayName:'C'},
  ]), [{displayName:'A', emails:['a@x.test']}]);
});

test('apply puts configured contributors first and leaves unmentioned identities in place', () => {
  const current = [
    {displayName:'a', emails:['a@x.test'], workingDays:[1,2,3]},
    {displayName:'a2', emails:['a@home.test']},
    {displayName:'carol', emails:['c@x.test','c@home.test']},
  ];
  const config = [{displayName:'Alice', emails:['a@home.test','a@x.test','a@old.test']}];
  const result = applyIdentityConfig(current, config, known(['a@x.test','a@home.test','c@x.test','c@home.test']));
  assert.deepEqual(result.groups, [
    {displayName:'Alice', emails:['a@home.test','a@x.test']},
    {displayName:'carol', emails:['c@x.test','c@home.test']},
  ]);
  assert.equal(result.matched, 2);
  assert.equal(result.unmatched, 1);
  assert.deepEqual(result.reserve, [{displayName:'Alice', emails:['a@home.test','a@x.test','a@old.test']}]);
});

test('apply keeps the existing schedule when the configuration has none', () => {
  const result = applyIdentityConfig([{displayName:'a', emails:['a@x.test'], workingDays:[2,4]}],
    [{displayName:'Alice', emails:['a@x.test']}], known(['a@x.test']));
  assert.deepEqual(result.groups, [{displayName:'Alice', emails:['a@x.test'], workingDays:[2,4]}]);
});

test('export folds reserved keys back so the mapping round-trips', () => {
  const reserve = [
    {displayName:'Alice', emails:['a@x.test','a@old.test']},
    {displayName:'Dana', emails:['d@x.test'], workingDays:[1]},
  ];
  const config = buildIdentityConfig([{displayName:'Alice', emails:['a@x.test']}], reserve, 'now');
  assert.deepEqual(config.groups, [
    {displayName:'Alice', identities:['a@x.test','a@old.test']},
    {displayName:'Dana', identities:['d@x.test'], workingDays:[1]},
  ]);
});

test('appended keys join their configured contributor; edits since import are not undone', () => {
  const reserve = [
    {displayName:'Alice', emails:['a@x.test','a@new.test']},
    {displayName:'Dana', emails:['d@x.test','d@home.test'], workingDays:[1,2]},
  ];
  // a@x.test was manually moved to "Team" after the import; it must stay there.
  const groups = [
    {displayName:'Team', emails:['a@x.test','t@x.test']},
    {displayName:'Untouched', emails:[]},
    {displayName:'a@new.test', emails:['a@new.test']},
    {displayName:'d@x.test', emails:['d@x.test']},
    {displayName:'d@home.test', emails:['d@home.test']},
  ];
  const all = known(['a@x.test','t@x.test','a@new.test','d@x.test','d@home.test']);
  const result = adoptReservedIdentities(groups, ['a@new.test','d@x.test','d@home.test'], reserve, all);
  assert.deepEqual(result.groups, [
    {displayName:'Team', emails:['a@x.test','t@x.test','a@new.test']},
    {displayName:'Untouched', emails:[]},
    {displayName:'Dana', emails:['d@x.test','d@home.test'], workingDays:[1,2]},
  ]);
  assert.equal(result.adopted, 3);
  assert.deepEqual(result.reserve, []);
});
