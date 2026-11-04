import type {SelectorView} from './contracts';
import {element} from './dom';
import type {ComposerSelectors} from './selectors';

/** A combined control changes both canonical values before publishing one draft revision. */
export function selectorControl(selector: SelectorView, selectors: readonly SelectorView[],
    selection: ComposerSelectors, changed: () => void): HTMLLabelElement {
    const child = selectors.find(item => item.id === selector.combineWith && item.variants?.selectorId === selector.id);
    const label = element('label'), caption = element('span', 'llm-chat__selector-label', selector.label), select = element('select');
    label.dataset.placement = selector.placement ?? 'start'; label.append(caption); select.setAttribute('aria-label', selector.label);
    select.dataset.selectorId = selector.id; select.disabled = !!selector.disabled || !!child?.disabled;
    if (child) fillCombined(select, selector, child, selection);
    else {
        for (const choice of selection.choices(selector)) {const option = element('option', undefined, choice.label); option.value = choice.id; select.append(option);}
        select.value = selection.get(selector.id);
    }
    select.addEventListener('change', () => {
        if (child) {
            const [parentValue, childValue] = JSON.parse(select.value) as [string, string];
            selection.set(selector.id, parentValue); selection.update(selectors); selection.set(child.id, childValue);
        } else selection.set(selector.id, select.value);
        changed();
    });
    label.append(select); return label;
}
function fillCombined(select: HTMLSelectElement, parent: SelectorView, child: SelectorView, selection: ComposerSelectors): void {
    select.dataset.combinedSelectorId = child.id;
    for (const choice of selection.choices(parent)) {
        const group = element('optgroup'); group.label = choice.label;
        for (const option of child.variants?.values[choice.id]?.choices ?? child.choices) {
            const node = element('option', undefined, option.label);
            node.value = JSON.stringify([choice.id, option.id]); group.append(node);
        }
        select.append(group);
    }
    select.value = JSON.stringify([selection.get(parent.id), selection.get(child.id)]);
}
