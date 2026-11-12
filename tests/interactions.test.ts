import {afterEach, expect, it, vi} from 'vitest';
import {createInteractionCard} from '../src/interactions';

afterEach(() => document.body.replaceChildren());
it('renders descriptions, multiple selections, custom answers and secret text without mixing fields', async () => {
    const submit = vi.fn(async () => {});
    const card = createInteractionCard({id: 'request', revision: 0, state: 'pending', kind: 'input', title: 'Questions', fields: [
        {id: 'features', label: 'Features', kind: 'multi-choice', required: true, min: 1, other: 'Other', choices: [
            {id: 'A', label: 'A', description: 'First feature'}, {id: 'B', label: 'B', description: 'Second feature'}]},
        {id: 'password', label: 'Token', kind: 'text', secret: true, required: true},
    ]}, submit); document.body.append(card.element);
    expect(card.element.textContent).toContain('First feature');
    const choices = card.element.querySelectorAll<HTMLInputElement>('input[type=checkbox]'); choices[0].checked = choices[1].checked = true;
    const token = card.element.querySelector<HTMLInputElement>('input[type=password]')!; token.value = 'private';
    card.element.querySelector('form')!.dispatchEvent(new Event('submit', {cancelable: true}));
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith({kind: 'input', values: {features: ['A', 'B'], password: 'private'}}));
    expect(card.element.innerHTML).not.toContain('private'); card.destroy();
});
it('requires an answer, validates selection limits and preserves input through disable/enable', async () => {
    const submit = vi.fn(async () => {}), card = createInteractionCard({id: 'q', revision: 0, state: 'pending', kind: 'input', title: 'Q',
        fields: [{id: 'q', label: 'Q', kind: 'single-choice', required: true, other: 'Other', choices: [{id: 'A', label: 'A'}]}]}, submit);
    document.body.append(card.element); const form = card.element.querySelector('form')!;
    form.dispatchEvent(new Event('submit', {cancelable: true})); expect(submit).not.toHaveBeenCalled();
    const custom = card.element.querySelector<HTMLInputElement>('input[type=text]')!; custom.value = 'Custom'; custom.dispatchEvent(new Event('input'));
    card.setPending(true); expect(custom.disabled).toBe(true); card.setPending(false); expect(custom.value).toBe('Custom');
    form.dispatchEvent(new Event('submit', {cancelable: true}));
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith({kind: 'input', values: {q: 'Custom'}})); card.destroy();
});
it('keeps unsupported interactions visible without response controls', () => {
    const card = createInteractionCard({id: 'u', revision: 0, kind: 'unsupported', state: 'pending', title: 'Unknown'}, vi.fn(), {locale: 'en'});
    expect(card.element.textContent).toContain('unsupported'); expect(card.element.querySelector('button')).toBeNull(); card.destroy();
});
it('restores exact editing state including unchecked custom text without submitting or persisting secrets', () => {
    const request = {id: 'draft', revision: 1, state: 'pending' as const, kind: 'input' as const, title: 'Draft', fields: [
        {id: 'answer', label: 'Answer', kind: 'text' as const, multiline: true},
        {id: 'choices', label: 'Choices', kind: 'multi-choice' as const, choices: [{id: 'a', label: 'A'}], other: 'Other'},
        {id: 'secret', label: 'Secret', kind: 'text' as const, secret: true}]};
    const submit = vi.fn(async () => {}), changed = vi.fn();
    const card = createInteractionCard(request, submit, {draft: {fields: {answer: {value: '{unfinished'},
        choices: {selected: ['a'], other: {selected: false, value: 'Unselected draft'}}, secret: {value: 'never restore'}}}, onDraftChange: changed});
    document.body.append(card.element);
    expect(card.element.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('{unfinished');
    expect(card.element.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('');
    expect(changed).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
    const text = card.element.querySelector<HTMLInputElement>('input[type=text]')!;
    expect(text.value).toBe('Unselected draft');
    expect(card.element.querySelector<HTMLInputElement>('[data-other-choice]')!.checked).toBe(false);
    text.value = 'Changed'; text.dispatchEvent(new Event('input', {bubbles: true}));
    expect(changed).toHaveBeenLastCalledWith({fields: {answer: {value: '{unfinished'}, choices: {selected: ['a'], other: {selected: true, value: 'Changed'}}}});
    const snapshot = card.getDraft(); snapshot.fields.answer.value = 'Mutated';
    expect(card.getDraft().fields.answer.value).toBe('{unfinished');
    card.destroy(); text.dispatchEvent(new Event('input', {bubbles: true})); expect(changed).toHaveBeenCalledTimes(1);
});
it('restores approval notes and captures edits without creating an approval decision', () => {
    const submit = vi.fn(async () => {}), changed = vi.fn();
    const card = createInteractionCard({id: 'approval', revision: 1, state: 'pending', kind: 'approval', title: 'Approve', note: true,
        decisions: [{id: 'yes', label: 'Yes'}]}, submit, {draft: {fields: {}, note: 'Saved note'}, onDraftChange: changed});
    document.body.append(card.element); const note = card.element.querySelector('textarea')!;
    expect(note.value).toBe('Saved note'); note.value = 'Edited note'; note.dispatchEvent(new Event('input', {bubbles: true}));
    expect(changed).toHaveBeenCalledWith({fields: {}, note: 'Edited note'}); expect(submit).not.toHaveBeenCalled();
    card.setPending(true); note.dispatchEvent(new Event('change', {bubbles: true})); expect(changed).toHaveBeenCalledTimes(1);
    card.destroy();
});

it('shows approval context first and only mounts escaped raw commands after expansion',async()=>{
 const submit=vi.fn(async()=>{}),command='python3 - <<\'PY\'\n<script>bad()</script>\nPY';
 const card=createInteractionCard({id:'approval-context',revision:1,state:'pending',kind:'approval',title:'Update verification',detail:'Update script and remove specified caches',
  facts:[{label:'Target',value:'/project/<verify>.mjs'}],details:[{label:'View full command',text:command}],decisions:[{id:'accept',label:'Allow once'},{id:'decline',label:'Decline'}]},submit);
 document.body.append(card.element);const disclosure=card.element.querySelector('details')!,pre=disclosure.querySelector('pre')!;
 expect(card.element.textContent).toContain('Update script and remove specified caches');expect(card.element.textContent).toContain('/project/<verify>.mjs');
 expect(disclosure.open).toBe(false);expect(pre.textContent).toBe('');expect(card.element.textContent).not.toContain(command);
 disclosure.open=true;disclosure.dispatchEvent(new Event('toggle'));expect(pre.textContent).toBe(command);expect(card.element.querySelector('script')).toBeNull();expect(submit).not.toHaveBeenCalled();
 card.setPending(true);card.setPending(false);expect(disclosure.open).toBe(true);
 card.element.querySelector('button')!.click();await vi.waitFor(()=>expect(submit).toHaveBeenCalledWith({kind:'approval',decisionId:'accept'}));
 disclosure.open=false;disclosure.dispatchEvent(new Event('toggle'));expect(pre.textContent).toBe('');card.destroy();
});
