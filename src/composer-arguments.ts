import type {ChatSubmission, ComposerArgumentDraft, ComposerInputContract} from './contracts';
import {button, element} from './dom';
import type {Translate} from './i18n';
import {sameCallTarget} from './composer-targets';
import {parseArgumentJson} from './argument-json';

/** Own only the editor surface; the Composer remains the authority for its raw draft. */
export class ComposerArguments {
    readonly element = element('section', 'llm-chat__arguments');
    private readonly label = element('label');
    private readonly editor = element('textarea', 'llm-chat__argument-input');
    private readonly feedback = element('p', 'llm-chat__argument-error');
    private readonly apply: HTMLButtonElement;
    private readonly remove: HTMLButtonElement;
    private contract?: ComposerInputContract;
    private draft?: ComposerArgumentDraft;
    constructor(private readonly t: Translate, private readonly changed: (input?: ComposerArgumentDraft) => void) {
        this.editor.setAttribute('aria-label', t('arguments')); this.editor.spellcheck = false;
        this.label.append(element('span', undefined, t('arguments')), this.editor);
        this.apply = button(t('applyArguments'), () => this.set(this.editor.value));
        this.remove = button(t('removeArguments'), () => this.changed(undefined));
        this.element.append(this.label, this.feedback, this.apply, this.remove);
        this.editor.addEventListener('input', () => {
            const input = this.draft ?? this.initial();
            if (input) this.changed({...input, revision: input.revision + 1, json: this.editor.value});
        });
    }
    update(contract?: ComposerInputContract, draft?: ComposerArgumentDraft, presentation: 'inline' | 'host' = 'inline'): void {
        this.contract = contract; this.draft = draft;
        this.element.hidden = !contract && !draft;
        const input = draft ?? this.initial();
        if (this.editor.value !== (input?.json ?? '{}')) this.editor.value = input?.json ?? '{}';
        this.editor.disabled = !contract;
        this.label.firstElementChild!.textContent = contract ? `${contract.label} · ${this.t('arguments')}` : this.t('arguments');
        this.apply.hidden = !contract || this.compatible(input);
        this.remove.hidden = !draft;
        const issue = this.issue(); this.feedback.textContent = issue ?? '';
        this.label.hidden = presentation === 'host';
        if (presentation === 'host') {this.element.hidden = !issue; this.apply.hidden = true;
            this.feedback.textContent = issue ? this.t(issue === this.t('invalidArguments') ? 'invalidArgumentsHost' : 'changedInputHost') : '';}
    }
    set(json: string): void {
        const initial = this.initial();
        if (!initial) throw new Error(this.t('changedInput'));
        this.changed({...initial, revision: (this.draft?.revision ?? 0) + 1, json});
    }
    issue(): string | undefined {
        const input = this.draft ?? this.initial();
        if (!input) return;
        if (!this.compatible(input)) return this.t('changedInput');
        try {this.resolve();} catch {return this.t('invalidArguments');}
    }
    resolve(): ChatSubmission['input'] {
        const input = this.draft ?? this.initial();
        if (!input) return;
        if (!this.compatible(input)) throw new Error(this.t('changedInput'));
        const values = parseArgumentJson(input.json);
        return {targetId: input.targetId, ...(input.target ? {target: {...input.target}} : {}), signature: {...input.signature}, values: values as NonNullable<ChatSubmission['input']>['values']};
    }
    private initial(): ComposerArgumentDraft | undefined {
        return this.contract && {revision: 0, targetId: this.contract.targetId, ...(this.contract.target ? {target: {...this.contract.target}} : {}), signature: {...this.contract.signature}, json: '{}'};
    }
    private compatible(input?: ComposerArgumentDraft): boolean {
        const current = this.contract;
        return !!current && !!input && sameCallTarget(current.target, input.target) && current.targetId === input.targetId && current.signature.id === input.signature.id
            && current.signature.revision === input.signature.revision && current.signature.digest === input.signature.digest;
    }
}
