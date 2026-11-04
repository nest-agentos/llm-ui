import type { JsonValue } from './contracts';
import type { FlowField, FlowInspectorContext, MountedFlowInspector } from './flow-contracts';
import { element, errorText } from './dom';
import { renderParameterFields, readParameterFields, type FormParameter, type ParameterFormOptions } from './parameter-form';

export function mountFlowInspector(container: HTMLElement, context: FlowInspectorContext,
    t: (key: string) => string, options: Omit<ParameterFormOptions, 'mode' | 'values'> = {}): MountedFlowInspector {
    return new FlowInspector(container, context, t, options);
}
class FlowInspector implements MountedFlowInspector {
    private readonly form = element('form', 'llm-flow__form');
    private readonly name = element('input');
    private readonly feedback = element('p', 'llm-flow__error');
    private readonly parameterRoot = element('div', 'llm-flow__parameters');
    private readonly fields: readonly FlowField[];
    private readonly parameters: FormParameter[];
    private readonly parameterOptions: ParameterFormOptions;
    private closed = false;
    private working = false;
    constructor(container: HTMLElement, private readonly context: FlowInspectorContext, private readonly t: (key: string) => string,
        options: Omit<ParameterFormOptions, 'mode' | 'values'>) {
        this.form.noValidate = true;
        this.name.value = context.node.name;
        const label = element('label', undefined, t('name')); label.append(this.name); this.form.append(label);
        this.fields = context.snapshot.nodeTypes.find(type => type.id === context.node.type)?.fields ?? [];
        this.parameters = this.fields.map(parameterSchema);
        this.parameterOptions = { optionLabel: (value, parameter) => choiceLabel(this.fields, value, parameter),
            ...options, values: context.node.config, mode: 'run' };
        this.parameterRoot.innerHTML = renderParameterFields(this.parameters, this.parameterOptions);
        this.form.append(this.parameterRoot);
        const save = element('button', undefined, t('apply')); save.type = 'submit';
        this.form.append(save, this.feedback); container.append(this.form); this.setWorking(false);
        this.form.addEventListener('submit', event => { event.preventDefault(); void this.submit(); });
    }
    private setWorking(value: boolean): void {
        this.working = value;
        this.form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,select,textarea,button')
            .forEach(control => { control.disabled = value || !this.context.canEdit; });
    }
    private async submit(): Promise<void> {
        if (this.closed || this.working || !this.context.canEdit) return;
        this.setWorking(true);
        try {
            const values = readParameterFields(this.parameterRoot, this.parameters, this.parameterOptions);
            const changes = this.fields.map(field => [field.id, Object.hasOwn(values, field.id) ? values[field.id] : field.kind === 'json' ? null : '']);
            const config = { ...this.context.node.config, ...Object.fromEntries(changes) };
            await this.context.commit({ name: this.name.value, config });
            if (!this.closed) this.feedback.textContent = this.t('accepted');
        } catch (error) { if (!this.closed) this.feedback.textContent = errorText(error); }
        finally { if (!this.closed) this.setWorking(false); }
    }
    destroy(): void { this.closed = true; this.form.remove(); }
}
function parameterSchema(field: FlowField): FormParameter {
    return { name: field.id, label: field.label, type: field.kind === 'text' || field.kind === 'choice' ? 'string' : field.kind,
        required: field.required || field.kind === 'number' || field.kind === 'json',
        ...(field.kind === 'json' ? { default: null } : {}),
        ...(field.kind === 'text' ? { widget: 'text' } : {}),
        ...(field.kind === 'choice' ? { widget: 'select', options: field.choices.map(choice => choice.id) } : {}),
    };
}
function choiceLabel(fields: readonly FlowField[], value: JsonValue, parameter: FormParameter): string {
    const field = fields.find(item => item.id === parameter.name);
    return field?.kind === 'choice' ? field.choices.find(choice => choice.id === value)?.label ?? String(value) : String(value);
}
