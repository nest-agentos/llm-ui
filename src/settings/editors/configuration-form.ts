import type { SettingsRuntime } from '../runtime';
import { randomUUID as randomUUID } from '../identity';
import type { SettingsAutoSave } from '../contracts/editor';
export interface FormOptions {
    width: string;
    confirmText: string;
    onConfirm(): Promise<void | false>;
    onAutoSave?(save: SettingsAutoSave): void;
    onClose?(): void;
    editableTitle?: {
        name: string;
        value: string;
        label: string;
    };
    statusBelowHeader?: boolean;
}
function editTitle(heading: HTMLElement, form: HTMLFormElement, options: FormOptions): void {
    if (!options.editableTitle)
        return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'settings-page__name';
    input.name = options.editableTitle.name;
    input.value = options.editableTitle.value;
    input.required = true;
    input.setAttribute('aria-label', options.editableTitle.label);
    input.placeholder = options.editableTitle.label;
    if (!form.contains(heading)) {
        form.id = 'configuration-form-' + randomUUID();
        input.setAttribute('form', form.id);
    }
    heading.replaceChildren(input);
}
/** Preserve the editing DOM while valid configuration changes save automatically. */
export function showConfigurationForm(runtime: SettingsRuntime, container: HTMLElement, title: string, content: string, options: FormOptions, inline: boolean): HTMLElement {
    if (!inline)
        return showAutoSaveModal(runtime, title, content, options);
    const page = document.createElement('section');
    page.className = 'settings-page';
    const header = document.createElement('div');
    header.className = 'settings-page__header';
    const heading = document.createElement('h2');
    heading.className = 'settings-page__title';
    heading.textContent = title;
    const actions = document.createElement('div');
    actions.className = 'settings-page__actions';
    const body = document.createElement('div');
    body.innerHTML = content;
    header.append(heading, actions);
    page.append(header, body);
    container.replaceChildren(page);
    const form = body.querySelector('form')!;
    if (options.editableTitle)
        form.prepend(header);
    editTitle(heading, form, options);
    const status = options.statusBelowHeader ? document.createElement('div') : actions;
    if (options.statusBelowHeader) {
        status.className = 'settings-page__save-status';
        header.after(status);
    }
    const save = new (dependencies(runtime).SettingsAutoSave)(options.editableTitle ? page : form, options.onConfirm, status);
    options.onAutoSave?.(save);
    return page;
}
function showAutoSaveModal(runtime: SettingsRuntime, title: string, content: string, options: FormOptions): HTMLElement {
    const modal = new (dependencies(runtime).Modal)(options.editableTitle ? '' : title, content, { width: options.width, cancelText: dependencies(runtime).t('action.close'), onCancel: options.onClose });
    modal.show();
    const overlay = document.body.lastElementChild as HTMLElement;
    overlay.querySelector('.settings-modal-confirm')?.remove();
    const form = overlay.querySelector('form')!;
    const heading = overlay.querySelector<HTMLElement>('.settings-modal__header h3');
    if (heading) {
        heading.classList.add('settings-page__title');
        editTitle(heading, form, options);
    }
    const save = new (dependencies(runtime).SettingsAutoSave)(options.editableTitle ? overlay : form, options.onConfirm, overlay.querySelector<HTMLElement>('.settings-modal__footer')!);
    options.onAutoSave?.(save);
    overlay.addEventListener('click', event => {
        const target = event.target as HTMLElement;
        if (target !== overlay && !target.closest('.settings-modal-close, .settings-modal-cancel'))
            return;
        event.stopImmediatePropagation();
        void save.dispose().then(closed => {
            if (closed)
                modal.hide();
        });
    }, true);
    return overlay;
}
export function addConfigurationAction(runtime: SettingsRuntime, container: HTMLElement, label: string, run: () => void, overflow = false): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settings-btn settings-btn--secondary';
    const actions = container.querySelector<HTMLElement>('.settings-page__actions');
    const host = overflow && actions ? configurationMenu(runtime, actions) : actions;
    button.textContent = label;
    button.onclick = () => {
        const menu = button.closest('details');
        if (menu)
            menu.open = false;
        run();
    };
    host?.append(button);
}
function configurationMenu(runtime: SettingsRuntime, actions: HTMLElement): HTMLElement {
    const existing = actions.querySelector<HTMLElement>('.settings-page__menu');
    if (existing)
        return existing;
    const menu = document.createElement('details'), summary = document.createElement('summary'), items = document.createElement('div');
    menu.className = 'settings-page__more';
    items.className = 'settings-page__menu';
    summary.innerHTML = dependencies(runtime).FILE_BROWSER_ICONS.more;
    summary.title = dependencies(runtime).t('vfs.columns.more');
    summary.setAttribute('aria-label', summary.title);
    menu.append(summary, items);
    actions.append(menu);
    menu.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            menu.open = false;
            summary.focus();
            event.stopPropagation();
        }
    });
    menu.addEventListener('focusout', event => {
        if (!menu.contains(event.relatedTarget as Node | null))
            menu.open = false;
    });
    return items;
}
export function addConfigurationEnabled(runtime: SettingsRuntime, container: HTMLElement, enabled: boolean): void {
    const label = document.createElement('label');
    label.className = 'settings-form__group';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'enabled';
    input.checked = enabled;
    label.append(input, ' ', dependencies(runtime).t('toolbox.enabled'));
    const form = container.querySelector('form'), header = form?.querySelector('.settings-page__header');
    if (header && form?.classList.contains('connection-form')) {
        label.classList.add('connection-form__enabled');
        header.prepend(label);
    }
    else if (header)
        header.after(label);
    else
        form?.prepend(label);
}
function createDependencies(runtime: SettingsRuntime) { return { FILE_BROWSER_ICONS: runtime.presentation.FILE_BROWSER_ICONS, t: runtime.presentation.t, Modal: runtime.widgets.Modal, SettingsAutoSave: runtime.widgets.SettingsAutoSave }; }
export function bind(runtime: SettingsRuntime) { return { showConfigurationForm: showConfigurationForm.bind(null, runtime), addConfigurationAction: addConfigurationAction.bind(null, runtime), addConfigurationEnabled: addConfigurationEnabled.bind(null, runtime) }; }

const dependencyCache = new WeakMap<SettingsRuntime, ReturnType<typeof createDependencies>>();
function dependencies(runtime: SettingsRuntime) {
    let value = dependencyCache.get(runtime);
    if (!value) { value = createDependencies(runtime); dependencyCache.set(runtime, value); }
    return value;
}
