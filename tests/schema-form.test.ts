import {afterEach, expect, it} from 'vitest';
import {SchemaForm, validateSchema} from '../src/parameter-form';
afterEach(() => document.body.replaceChildren());
it('uses the same field reader for nested optional values and explicit empty arrays', () => {
    const root = document.createElement('div'); document.body.append(root);
    const schema = {type: 'object', properties: {settings: {type: 'object', properties: {enabled: {type: 'boolean'}}}, allowed: {type: 'array', items: {type: 'string', enum: ['read', 'write']}}}};
    const form = new SchemaForm(root, schema, {settings: {}, allowed: []}); form.render();
    expect(form.read()).toEqual({value: {allowed: []}, errors: []});
    const select = root.querySelector<HTMLSelectElement>('[data-schema-path="$.settings.enabled"]')!; select.value = 'true';
    expect(form.read()).toEqual({value: {settings: {enabled: true}, allowed: []}, errors: []});
});
it('accepts expressions only when the host supplies a policy', () => {
    expect(validateSchema({type: 'number'}, '${value}')).toEqual(['$ must be number']);
    expect(validateSchema({type: 'number'}, '${value}', '$', {acceptValue: value => value === '${value}'})).toEqual([]);
});
