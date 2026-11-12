import type {Translation} from './contracts';
import type { InputField, InteractionResponse, InteractionView } from './contracts';
import { button, element, errorText } from './dom';
import type { Translate } from './i18n';
import {translator} from './i18n';
import {interactionField, type InteractionFieldDraft} from './interaction-fields';

export interface InteractionEditorDraft {fields: Record<string, InteractionFieldDraft>; note?: string}
export interface InteractionCardOptions {
    locale?: string; translate?: Translation;
    draft?: InteractionEditorDraft;
    onDraftChange?(draft: InteractionEditorDraft): void;
}
export function createInteractionCard(request: InteractionView, submit: (response: InteractionResponse) => Promise<void>,
    options: InteractionCardOptions = {}): InteractionCard {
    return new InteractionCard(request, translator(options.locale, options.translate), submit, options);
}

export class InteractionCard {
    readonly element = element('section', 'llm-chat__interaction');
    private readonly form = element('form');
    private readonly feedback = element('p', 'llm-chat__error');
    private readDraft: () => InteractionEditorDraft = () => ({fields: {}});
    private busy = false;
    private pending = false;
    private closed = false;
    constructor(readonly request: InteractionView, private readonly t: Translate,
        private readonly submit: (response: InteractionResponse) => Promise<void>, private readonly options: InteractionCardOptions = {}) {
        this.element.dataset.requestId = request.id;
        this.element.append(element('h3', undefined, request.title));
        this.context();
        this.element.append(this.form,this.feedback);
        if (request.state !== 'pending') { this.form.textContent = request.state; return; }
        if (request.kind === 'approval') this.approval();
        else if (request.kind === 'input') this.input(request.fields);
        else this.form.textContent = this.t('unsupportedInteraction');
        this.form.addEventListener('input', () => this.changed());
        this.form.addEventListener('change', () => this.changed());
    }
    private context():void {
        if(this.request.detail)this.element.append(element('p',undefined,this.request.detail));
        if(this.request.facts?.length){
            const facts=element('dl','llm-chat__interaction-facts');
            for(const fact of this.request.facts)facts.append(element('dt',undefined,fact.label),element('dd',undefined,fact.value));
            this.element.append(facts);
        }
        for(const detail of this.request.details??[]){
            const disclosure=element('details','llm-chat__interaction-details'),body=element('pre');
            disclosure.append(element('summary',undefined,detail.label),body);
            disclosure.addEventListener('toggle',()=>{body.textContent=disclosure.open?detail.text:'';});
            this.element.append(disclosure);
        }
    }
    private approval(): void {
        const request = this.request;
        if (request.kind !== 'approval') return;
        const note = element('textarea'); note.setAttribute('aria-label', this.t('note'));
        if (request.note) {note.value = this.options.draft?.note ?? ''; this.form.append(note);}
        this.readDraft = () => ({fields: {}, ...(request.note ? {note: note.value} : {})});
        for (const decision of request.decisions) this.form.append(button(decision.label, () => {
            void this.run({ kind: 'approval', decisionId: decision.id, ...(request.note ? { note: note.value } : {}) });
        }));
    }
    private input(fields: readonly InputField[]): void {
        const controls = fields.map(field => ({field, control: interactionField(field, this.options.draft?.fields[field.id])}));
        this.readDraft = () => ({fields: Object.fromEntries(controls.filter(({field}) => field.kind !== 'text' || !field.secret).map(({field, control}) => [field.id, control.draft()]))});
        controls.forEach(({control}) => this.form.append(control.element));
        const send = element('button', undefined, this.t('answer')); send.type = 'submit'; this.form.append(send);
        this.form.addEventListener('submit', event => {
            event.preventDefault();
            const values: Record<string, string | string[]> = Object.create(null);
            for (const {field, control} of controls) {
                const items = control.values();
                if (field.required && !items.some(value => value.trim())) { this.feedback.textContent = this.t('required'); return; }
                if (field.kind === 'multi-choice' && (items.length < (field.min ?? 0) || items.length > (field.max ?? Infinity))) {
                    this.feedback.textContent = this.t('range'); return;
                }
                values[field.id] = field.kind === 'multi-choice' ? items : items[0] ?? '';
            }
            void this.run({ kind: 'input', values });
        });
    }
    getDraft(): InteractionEditorDraft {return this.readDraft();}
    private changed(): void {
        if (this.closed || this.busy || this.pending) return;
        this.options.onDraftChange?.(this.getDraft());
    }
    private async run(response: InteractionResponse): Promise<void> {
        if (this.busy || this.pending || this.closed) return;
        this.busy = true; this.disable(true); this.feedback.textContent = this.t('pending');
        try { await this.submit(response); if (!this.closed) this.feedback.textContent = this.t('accepted'); }
        catch (error) { if (!this.closed) this.feedback.textContent = errorText(error); }
        finally { this.busy = false; if (!this.closed) this.disable(this.pending); }
    }
    setPending(pending: boolean, message?: string): void {
        this.pending = pending || !!this.request.responding;
        this.disable(this.pending || this.busy);
        if (message) this.feedback.textContent = message;
    }
    private disable(value: boolean): void {
        this.form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>('input,button,textarea')
            .forEach(control => { control.disabled = value; });
    }
    destroy(): void { this.closed = true; this.element.remove(); }
}
