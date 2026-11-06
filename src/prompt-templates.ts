import type {Translate} from './i18n';
import {escapeHTML} from './html';

export const PromptNavigationTemplates = {
    shell: (t: Translate): string => `
        <header class="llm-prompt-nav__header">
            <strong>${escapeHTML(t('prompts'))}</strong>
            <button type="button" data-action="close" aria-label="${escapeHTML(t('promptClose'))}">${escapeHTML(t('promptClose'))}</button>
        </header>
        <input type="search" class="llm-prompt-nav__search" placeholder="${escapeHTML(t('promptSearch'))}" aria-label="${escapeHTML(t('promptSearch'))}" />
        <div class="llm-prompt-nav__tools">
            <div class="llm-prompt-nav__jumps">${(['first', 'middle', 'last'] as const).map(position => `<button type="button" data-jump="${position}">${escapeHTML(t(position === 'first' ? 'promptFirst' : position === 'middle' ? 'promptMiddle' : 'promptLast'))}</button>`).join('')}</div>
            <button type="button" data-action="preview" aria-pressed="false" title="${escapeHTML(t('promptPreview'))}"><span>${escapeHTML(t('promptPreview'))}</span></button>
        </div>
        <nav class="llm-prompt-nav__list" aria-label="${escapeHTML(t('prompts'))}"></nav>
        <footer class="llm-prompt-nav__footer">
            <span class="llm-prompt-nav__range" role="status" aria-live="polite"></span>
            <button type="button" data-action="more" hidden>${escapeHTML(t('promptMore'))}</button>
        </footer>
        <p class="llm-prompt-nav__scope" hidden></p>
        <button type="button" data-action="earlier" hidden></button>`,
};
