import {escapeHTML} from './html';
import {renderParameterFields, readParameterFields, type FormParameter, type JsonValue, type ParameterFormOptions} from './form-fields';

export interface JsonSchema {
    type?: string; format?: string; title?: string; description?: string; enum?: JsonValue[];
    required?: string[]; properties?: Record<string, JsonSchema>; items?: JsonSchema;
    minimum?: number; maximum?: number; unsetLabel?: string; advancedProperties?: string[];
}
export interface SchemaLayout {sections: readonly {title?: string; fields: readonly string[]}[]}
export interface SchemaFormOptions {
    layout?: SchemaLayout;
    /** Expression syntax and acceptance are host policy, not JSON Schema behavior. */
    acceptValue?(value: JsonValue): boolean;
    labels?: Partial<{inherit: string; optional: string; advanced: string; configured: string; on: string; off: string}>;
}
interface Field {path: string[]; parameter: FormParameter; options: ParameterFormOptions}
const record = (value: unknown): value is Record<string, JsonValue> => !!value && typeof value === 'object' && !Array.isArray(value);
const schemaValue = (value: JsonValue): JsonSchema => record(value) ? value as JsonSchema : {};
const same = (a: JsonValue, b: JsonValue) => JSON.stringify(a) === JSON.stringify(b);

/** Recursive schema layout delegates every leaf control and parse to the shared field engine. */
export class SchemaForm {
    private readonly fields: Field[] = [];
    constructor(private readonly root: HTMLElement, private schema: JsonValue, private value: JsonValue, private readonly options: SchemaFormOptions = {}) {}
    render(): void {this.fields.length = 0; this.root.innerHTML = this.renderRoot(schemaValue(this.schema));}
    update(schema: JsonValue, value: JsonValue): void {this.schema = schema; this.value = value; this.render();}
    read(): {value?: JsonValue; errors: string[]} {
        const errors: string[] = []; let value = structuredClone(this.value);
        for (const [index, spec] of this.fields.entries()) {
            const control = this.root.querySelector<HTMLElement>(`[data-schema-field="${index}"]`);
            if (!control) {errors.push('Schema field is unavailable'); continue;}
            try {
                const values = readParameterFields(control.parentElement!, [spec.parameter], spec.options);
                value = updatePath(value, spec.path, values[spec.parameter.name], Object.hasOwn(values, spec.parameter.name));
            } catch (error) {errors.push(error instanceof Error ? error.message : 'Invalid field value');}
        }
        value = pruneInherited(schemaValue(this.schema), value);
        errors.push(...validateSchema(schemaValue(this.schema), value, '$', this.options));
        if (errors.length) return {errors}; this.value = value; return {value, errors};
    }
    private renderRoot(schema: JsonSchema): string {
        if (schema.type !== 'object' || !this.options.layout) return this.renderSchema(schema, this.value, [], true);
        const value = record(this.value) ? this.value : {}, configured = new Set(this.options.layout.sections.flatMap(section => [...section.fields]));
        const sections = this.options.layout.sections.map(section => {
            const body = section.fields.map(key => this.renderProperty(schema, value, key, [])).join('');
            return section.title ? `<fieldset><legend>${escapeHTML(section.title)}</legend>${body}</fieldset>` : body;
        });
        sections.push(Object.keys(schema.properties ?? {}).filter(key => !configured.has(key)).map(key => this.renderProperty(schema, value, key, [])).join(''));
        return sections.join('');
    }
    private renderSchema(schema: JsonSchema, value: JsonValue, path: string[], root = false, optional = false, present = true): string {
        if (schema.type === 'object' && root) return this.renderProperties(schema, value, path);
        if (schema.type === 'object' && schema.properties) {
            const expanded = present && record(value) && Object.keys(value).length > 0;
            return `<details class="dag-schema-object" ${expanded ? 'open' : ''}><summary>${escapeHTML(schema.title ?? path.at(-1) ?? '$')}</summary>${schema.description ? `<small>${escapeHTML(schema.description)}</small>` : ''}${this.renderProperties(schema, present ? value : {}, path)}</details>`;
        }
        return this.renderLeaf(schema, value, path, optional, present);
    }
    private renderProperties(schema: JsonSchema, value: JsonValue, path: string[]): string {
        const values = record(value) ? value : {}, advanced = new Set(schema.advancedProperties ?? []);
        const basic = Object.keys(schema.properties ?? {}).filter(key => !advanced.has(key)).map(key => this.renderProperty(schema, values, key, path)).join('');
        const extra = [...advanced].filter(key => !!schema.properties?.[key]).map(key => this.renderProperty(schema, values, key, path)).join('');
        if (!extra) return basic;
        const label = this.options.labels?.advanced ?? 'Advanced', configured = this.options.labels?.configured ?? 'configured';
        return `${basic}<details class="dag-schema-advanced"><summary>${escapeHTML(label)}${[...advanced].some(key => key in values) ? ' · ' + escapeHTML(configured) : ''}</summary>${extra}</details>`;
    }
    private renderProperty(schema: JsonSchema, value: Record<string, JsonValue>, key: string, path: string[]): string {
        const child = schema.properties?.[key]; if (!child) return '';
        const required = schema.required?.includes(key) ?? false;
        return this.renderSchema({...child, title: child.title ?? key}, value[key] ?? defaultValue(child), [...path, key], false, !required, Object.hasOwn(value, key));
    }
    private renderLeaf(schema: JsonSchema, value: JsonValue, path: string[], optional: boolean, present: boolean): string {
        const name = '$' + (path.length ? '.' + path.join('.') : ''), expression = this.options.acceptValue?.(value);
        const parameter: FormParameter = {name, label: schema.title ?? path.at(-1) ?? '$', description: schema.description,
            type: schema.type === 'number' || schema.type === 'integer' ? 'number' : schema.type === 'boolean' ? 'boolean' : ['array', 'object'].includes(schema.type ?? '') || !schema.type ? 'json' : 'string',
            required: !optional, integer: schema.type === 'integer', minimum: schema.minimum, maximum: schema.maximum,
            widget: schema.type === 'array' && schema.items?.enum ? 'multi-select' : schema.format === 'multiline' ? 'textarea' : 'text', options: schema.enum ?? (schema.type === 'array' ? schema.items?.enum : undefined)};
        const options: ParameterFormOptions = {mode: optional ? 'defaults' : 'run', values: present || !optional ? {[name]: value} : {},
            classes: {field: 'dag-schema-field'}, labels: {inherit: schema.unsetLabel ?? this.options.labels?.inherit ?? '(inherit)',
                ...(this.options.labels?.on !== undefined ? {on: this.options.labels.on} : {}), ...(this.options.labels?.off !== undefined ? {off: this.options.labels.off} : {})},
            acceptValue: candidate => !!this.options.acceptValue?.(candidate),
            parseField: (_parameter, _index, field, parse) => this.options.acceptValue?.(field.value) ? field.value : parse()};
        if (expression) options.renderField = (_parameter, index) => `<label class="dag-schema-field"><span>${escapeHTML(parameter.label ?? name)}</span><input data-parameter="${index}" type="text" value="${escapeHTML(String(value))}"></label>`;
        const index = this.fields.push({path, parameter, options}) - 1;
        return renderParameterFields([parameter], options).replace('data-parameter="0"', `data-parameter="0" data-schema-field="${index}" data-schema-path="${escapeHTML(name)}"`)
            .replace('type="number"', 'type="text" inputmode="decimal"');
    }
}
export function validateSchema(schema: JsonSchema, value: JsonValue, path = '$', options: Pick<SchemaFormOptions, 'acceptValue'> = {}): string[] {
    if (options.acceptValue?.(value)) return [];
    const errors: string[] = [];
    if (schema.type && !matchesType(schema.type, value)) errors.push(`${path} must be ${schema.type}`);
    if (schema.enum && !schema.enum.some(item => same(item, value))) errors.push(`${path} is not an allowed value`);
    if (schema.type === 'object' && record(value)) {
        for (const name of schema.required ?? []) if (!Object.hasOwn(value, name) || value[name] === '') errors.push(`${path}.${name} is required`);
        for (const [name, child] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, name)) errors.push(...validateSchema(child, value[name], `${path}.${name}`, options));
    }
    if (schema.type === 'array' && Array.isArray(value) && schema.items) value.forEach((item, index) => errors.push(...validateSchema(schema.items!, item, `${path}[${index}]`, options)));
    return errors;
}
function matchesType(type: string, value: JsonValue): boolean {
    if (type === 'object') return record(value);
    if (type === 'array') return Array.isArray(value);
    if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    return !['string', 'boolean'].includes(type) || typeof value === type;
}
function defaultValue(schema: JsonSchema): JsonValue {return schema.type === 'object' ? {} : schema.type === 'array' ? [] : schema.type === 'boolean' ? false : ['number', 'integer'].includes(schema.type ?? '') ? 0 : '';}
function updatePath(value: JsonValue, path: string[], next: JsonValue | undefined, present: boolean): JsonValue {
    if (path.some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('Unsafe schema configuration path');
    if (!path.length) return present ? next! : value;
    const result = record(value) ? value : {}; let current = result;
    for (const key of path.slice(0, -1)) {if (!record(current[key])) current[key] = {}; current = current[key] as Record<string, JsonValue>;}
    if (present) current[path.at(-1)!] = next!; else delete current[path.at(-1)!];
    return result;
}
function pruneInherited(schema: JsonSchema, value: JsonValue): JsonValue {
    if (!record(value) || !schema.properties) return value;
    for (const [key, child] of Object.entries(schema.properties)) {
        if (!Object.hasOwn(value, key)) continue; value[key] = pruneInherited(child, value[key]);
        if (!schema.required?.includes(key) && child.properties && record(value[key]) && !Object.keys(value[key]).length) delete value[key];
    }
    return value;
}
