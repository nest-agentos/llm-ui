import {escapeHTML as escape} from './html';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** A host-owned parameter schema; independent of any execution engine. */
export interface FormParameter {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'json';
    widget?: string;
    label?: string;
    description?: string;
    required?: boolean;
    nonBlank?: boolean;
    default?: JsonValue;
    options?: readonly JsonValue[];
    minimum?: number;
    maximum?: number;
    integer?: boolean;
}

export type ParameterField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
export type ParameterFormError = 'required' | 'number' | 'json' | 'range' | 'type';

export interface ParameterFormOptions {
    mode?: 'defaults' | 'run';
    /** Namespace native form names when embedding multiple parameter groups. */
    namePrefix?: string;
    values?: Readonly<Record<string, unknown>>;
    labels?: Partial<{
        inherit: string;
        on: string;
        off: string;
        required: string;
        unavailableOption: string;
        defaultValue(value: string): string;
    }>;
    classes?: Partial<Record<'field' | 'label' | 'help' | 'input' | 'select' | 'textarea' | 'wide', string>>;
    error?(kind: ParameterFormError, parameter: FormParameter): string;
    optionLabel?(value: JsonValue, parameter: FormParameter): string;
    /** Custom controls must keep a data-parameter="index" input, select or textarea. */
    renderField?(parameter: FormParameter, index: number, defaultRender: () => string): string;
    parseField?(parameter: FormParameter, index: number, field: ParameterField, defaultParse: () => JsonValue): JsonValue;
    /** A host may accept deferred expressions; authoritative execution validation remains external. */
    acceptValue?(value: JsonValue, parameter: FormParameter): boolean;
}


const display = (value: JsonValue) => typeof value === 'string' ? value : JSON.stringify(value);
const labels = (options: ParameterFormOptions) => ({ inherit: 'Use default', on: 'On', off: 'Off', required: '*', unavailableOption: 'Unavailable', ...options.labels });
const className = (options: ParameterFormOptions, name: keyof NonNullable<ParameterFormOptions['classes']>) => escape(options.classes?.[name] ?? `llm-parameter-field${name === 'field' ? '' : `__${name}`}`);

export function renderParameterFields(parameters: readonly FormParameter[], options: ParameterFormOptions = {}): string {
    return parameters.map((parameter, index) => {
        const render = () => renderField(parameter, index, options);
        return options.renderField?.(parameter, index, render) ?? render();
    }).join('');
}

function renderField(parameter: FormParameter, index: number, options: ParameterFormOptions): string {
    const value = options.values && Object.hasOwn(options.values, parameter.name) ? options.values[parameter.name]
        : options.mode === 'defaults' ? undefined : parameter.default;
    const title = escape(parameter.label?.trim() || parameter.name);
    const required = parameter.required ? ` ${escape(labels(options).required)}` : '';
    const wide = textareaField(parameter, options) ? ` ${className(options, 'wide')}` : '';
    const description = parameter.description ? `<small class="${className(options, 'help')}">${escape(parameter.description)}</small>` : '';
    const hint = defaultHint(parameter, options);
    return `<label class="${className(options, 'field')}${wide}"><span class="${className(options, 'label')}">${title}${required}</span>
        ${renderControl(parameter, index, value, options)}${description}${hint}</label>`;
}

function defaultHint(parameter: FormParameter, options: ParameterFormOptions): string {
    if (options.mode !== 'defaults' || parameter.default === undefined || !options.labels?.defaultValue) return '';
    const value = display(parameter.default), preview = value.length > 120 ? `${value.slice(0, 120)}…` : value;
    return `<small class="${className(options, 'help')}">${escape(options.labels.defaultValue(preview))}</small>`;
}

function renderControl(parameter: FormParameter, index: number, value: unknown, options: ParameterFormOptions): string {
    const attributes = `data-parameter="${index}" name="${escape((options.namePrefix ?? '') + parameter.name)}"`;
    if (parameter.widget === 'multi-select') {
        const selected = new Set(Array.isArray(value) ? value.map(item => JSON.stringify(item)) : []);
        return `<select ${attributes} data-parameter-multi multiple size="${Math.min(8, Math.max(3, parameter.options?.length ?? 0))}">${(parameter.options ?? []).map(item => {
            const encoded = JSON.stringify(item);
            return `<option value="${escape(encoded)}" ${selected.has(encoded) ? 'selected' : ''}>${escape(options.optionLabel?.(item, parameter) ?? display(item))}</option>`;
        }).join('')}</select>`;
    }
    if (parameter.options?.length || parameter.widget === 'select') return selectControl(parameter, attributes, value, options);
    if (parameter.type === 'boolean') return booleanControl(attributes, value, options);
    const text = value === undefined ? '' : parameter.type === 'json' ? JSON.stringify(value, null, 2) : String(value);
    const placeholder = options.mode === 'defaults' ? `placeholder="${escape(labels(options).inherit)}"` : '';
    if (textareaField(parameter, options)) return `<textarea class="${className(options, 'textarea')}" ${attributes} ${placeholder} rows="${parameter.type === 'json' ? 4 : 3}">${escape(text)}</textarea>`;
    const constraints = parameter.type === 'number' ? numberAttributes(parameter) : '';
    return `<input class="${className(options, 'input')}" type="${parameter.type === 'number' ? 'number' : 'text'}" ${attributes} ${constraints} ${placeholder} value="${escape(text)}">`;
}

function textareaField(parameter: FormParameter, options: ParameterFormOptions): boolean {
    return parameter.type === 'json' || parameter.widget === 'textarea'
        || (options.mode !== 'defaults' && parameter.type === 'string' && parameter.widget !== 'text' && parameter.widget !== 'select' && !parameter.options?.length);
}

function numberAttributes(parameter: FormParameter): string {
    return `step="${parameter.integer ? '1' : 'any'}" ${parameter.minimum !== undefined ? `min="${parameter.minimum}"` : ''} ${parameter.maximum !== undefined ? `max="${parameter.maximum}"` : ''}`;
}

function booleanControl(attributes: string, value: unknown, options: ParameterFormOptions): string {
    if (options.mode !== 'defaults') return `<input class="${className(options, 'input')}" type="checkbox" ${attributes} ${value === true ? 'checked' : ''}>`;
    const text = labels(options);
    return `<select class="${className(options, 'select')}" ${attributes}><option value="">${escape(text.inherit)}</option>
        <option value="true" ${value === true ? 'selected' : ''}>${escape(text.on)}</option>
        <option value="false" ${value === false ? 'selected' : ''}>${escape(text.off)}</option></select>`;
}

function selectControl(parameter: FormParameter, attributes: string, value: unknown, options: ParameterFormOptions): string {
    const selected = JSON.stringify(value), choices = [...parameter.options ?? []];
    const missing = value !== undefined && !choices.some(choice => JSON.stringify(choice) === selected);
    if (missing) choices.unshift(value as JsonValue);
    const text = labels(options);
    return `<select class="${className(options, 'select')}" ${attributes} data-parameter-enum>
        <option value="">${options.mode === 'defaults' ? escape(text.inherit) : ''}</option>${choices.map((choice, index) => {
            const name = options.optionLabel?.(choice, parameter) ?? display(choice);
            return `<option value="${escape(JSON.stringify(choice))}" ${JSON.stringify(choice) === selected ? 'selected' : ''}>${escape(name)}${missing && index === 0 ? ` · ${escape(text.unavailableOption)}` : ''}</option>`;
        }).join('')}</select>`;
}

export function readParameterFields(
    root: HTMLElement,
    parameters: readonly FormParameter[],
    options: ParameterFormOptions = {},
): Record<string, JsonValue> {
    const values: Array<[string, JsonValue]> = [];
    parameters.forEach((parameter, index) => {
        const field = root.querySelector<ParameterField>(`[data-parameter="${index}"]`);
        if (!field) throw failure('type', parameter, options);
        if (field instanceof HTMLInputElement && field.validity.badInput) throw failure('number', parameter, options);
        const checkbox = field instanceof HTMLInputElement && field.type === 'checkbox';
        if (!checkbox && !field.hasAttribute('data-parameter-multi') && !field.value.trim()) {
            if (options.mode !== 'defaults' && parameter.required) throw failure('required', parameter, options);
            return;
        }
        const parse = () => parseValue(field, parameter, options);
        const value = options.parseField ? options.parseField(parameter, index, field, parse) : parse();
        validateValue(value, parameter, options);
        values.push([parameter.name, value]);
    });
    return Object.fromEntries(values);
}

function parseValue(field: ParameterField, parameter: FormParameter, options: ParameterFormOptions): JsonValue {
    if (field instanceof HTMLSelectElement && field.hasAttribute('data-parameter-multi')) return [...field.selectedOptions].map(option => JSON.parse(option.value) as JsonValue);
    if (field.hasAttribute('data-parameter-enum') || parameter.type === 'json') {
        try { return JSON.parse(field.value) as JsonValue; }
        catch { throw failure('json', parameter, options); }
    }
    if (field instanceof HTMLInputElement && field.type === 'checkbox') return field.checked;
    if (parameter.type === 'boolean') return field.value === 'true';
    if (parameter.type === 'number') return Number(field.value);
    return field.value;
}

function validateValue(value: JsonValue, parameter: FormParameter, options: ParameterFormOptions): void {
    if (options.acceptValue?.(value, parameter)) return;
    if (parameter.type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw failure('number', parameter, options);
        if ((parameter.integer && !Number.isInteger(value)) || (parameter.minimum !== undefined && value < parameter.minimum)
            || (parameter.maximum !== undefined && value > parameter.maximum)) throw failure('range', parameter, options);
    }
    if ((parameter.type === 'string' && typeof value !== 'string') || (parameter.type === 'boolean' && typeof value !== 'boolean')) throw failure('type', parameter, options);
    if (parameter.nonBlank && typeof value === 'string' && !value.trim()) throw failure('required', parameter, options);
}

function failure(kind: ParameterFormError, parameter: FormParameter, options: ParameterFormOptions): Error {
    const name = parameter.label?.trim() || parameter.name;
    const messages = { required: `A value is required for ${name}`, number: `Enter a finite number for ${name}`,
        json: `Enter valid JSON for ${name}`, range: `The number is outside the allowed range for ${name}`, type: `The value has an invalid type for ${name}` };
    return new Error(options.error?.(kind, parameter) ?? messages[kind]);
}
