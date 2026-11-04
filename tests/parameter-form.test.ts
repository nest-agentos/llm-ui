import { expect, it, vi } from 'vitest';
import { renderParameterFields, readParameterFields, type FormParameter, type ParameterFormOptions } from '../src/parameter-form';

function form(parameters: FormParameter[], options: ParameterFormOptions = {}) {
    const root = document.createElement('form');
    root.innerHTML = renderParameterFields(parameters, options);
    const field = (index: number) => root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-parameter="${index}"]`)!;
    return { root, field, read: () => readParameterFields(root, parameters, options) };
}

it('distinguishes inherited defaults from explicit false, zero and enum values', () => {
    const parameters: FormParameter[] = [
        { name: 'enabled', type: 'boolean', required: true, default: true },
        { name: 'count', type: 'number', required: true, default: 5 },
        { name: 'choice', type: 'json', options: [false, 0, { preset: 'a' }] },
    ];
    const f = form(parameters, { mode: 'defaults', values: { enabled: false, count: 0, choice: { preset: 'a' } } });
    expect(f.read()).toEqual({ enabled: false, count: 0, choice: { preset: 'a' } });
    expect(f.root.querySelectorAll('[required]')).toHaveLength(0);
    f.field(0).value = ''; f.field(1).value = ''; f.field(2).value = '';
    expect(f.read()).toEqual({});
});

it('uses declared defaults and validates required values only when running', () => {
    const parameters: FormParameter[] = [
        { name: 'prompt', label: 'Prompt', type: 'string', required: true, default: 'Read this' },
        { name: 'enabled', type: 'boolean', default: false },
    ];
    const run = form(parameters);
    expect(run.read()).toEqual({ prompt: 'Read this', enabled: false });
    run.field(0).value = '  '; expect(run.read).toThrow('Prompt');
    const defaults = form(parameters, { mode: 'defaults' });
    expect(defaults.field(0).value).toBe(''); expect(defaults.read()).toEqual({});
});

it('validates numeric bounds, integer constraints and JSON with host-supplied error messages', () => {
    const parameters: FormParameter[] = [
        { name: 'count', type: 'number', integer: true, minimum: 0, maximum: 10 },
        { name: 'data', type: 'json' },
    ];
    const f = form(parameters, { mode: 'defaults', error: (kind, parameter) => `${parameter.name}:${kind}` });
    f.field(0).value = '1.5'; expect(f.read).toThrow('count:range');
    f.field(0).value = '-1'; expect(f.read).toThrow('count:range');
    f.field(0).value = '11'; expect(f.read).toThrow('count:range');
    f.field(0).value = '0'; f.field(1).value = '{'; expect(f.read).toThrow('data:json');
    f.field(1).value = '{"nested":[false,0,null]}';
    expect(f.read()).toEqual({ count: 0, data: { nested: [false, 0, null] } });
});

it('keeps an unavailable selected option and escapes labels, descriptions and option values', () => {
    const injected = '<img src=x onerror=alert(1)>';
    const parameters: FormParameter[] = [{ name: injected, label: injected, description: injected, type: 'string', options: ['current'] }];
    const f = form(parameters, { mode: 'defaults', values: { [injected]: 'previous' }, optionLabel: value => `${injected}:${value}` });
    expect(f.root.querySelector('img')).toBeNull();
    expect(f.read()).toEqual({ [injected]: 'previous' });
    expect(f.field(0).textContent).toContain(`${injected}:previous`);
});

it('lets hosts replace special controls and parse them without losing common validation', () => {
    const parseField = vi.fn((_parameter, _index, field, defaultParse) => field.dataset.custom === 'null' ? null : defaultParse());
    const parameters: FormParameter[] = [{ name: 'assets', type: 'json' }, { name: 'name', type: 'string' }];
    const f = form(parameters, { mode: 'defaults',
        renderField: (parameter, index, defaultRender) => parameter.name === 'assets'
            ? `<input data-parameter="${index}" data-custom="null" value="custom">` : defaultRender(), parseField });
    f.field(1).value = 'ordinary';
    expect(f.read()).toEqual({ assets: null, name: 'ordinary' });
    expect(parseField).toHaveBeenCalledTimes(2);
});

it('preserves identifier keys without changing the result prototype', () => {
    const f = form([{ name: '__proto__', type: 'string' }], { mode: 'defaults' });
    f.field(0).value = 'value';
    const values = f.read();
    expect(Object.hasOwn(values, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
});

it('namespaces embedded field names while returning the original schema keys', () => {
    const f = form([{ name: 'systemPrompt', type: 'string' }], { mode: 'defaults', namePrefix: 'flow:' });
    expect(f.field(0).name).toBe('flow:systemPrompt'); f.field(0).value = 'value';
    expect(f.read()).toEqual({ systemPrompt: 'value' });
});
