import {afterEach, expect, it, vi} from 'vitest';
import {ComposerAttachments} from '../src/composer-attachments';
import {translator} from '../src/i18n';

afterEach(() => {document.body.replaceChildren(); vi.unstubAllGlobals();});
it('collapses mobile attachments, exposes actions on demand and retains expansion during updates', () => {
    const listeners = new Set<() => void>();
    const media = {matches: true, addEventListener: (_: string, run: () => void) => listeners.add(run), removeEventListener: (_: string, run: () => void) => listeners.delete(run)};
    vi.stubGlobal('matchMedia', () => media);
    const list = document.createElement('div'), edit = document.createElement('button'); edit.textContent = 'Edit'; list.append(edit);
    const panel = new ComposerAttachments(list, translator()); document.body.append(panel.element);
    panel.update(3, false, false); expect(panel.element.open).toBe(false); expect(panel.element.hidden).toBe(false);
    const toggle = panel.element.querySelector<HTMLButtonElement>('[data-chat-action=attachments]')!;
    expect(toggle.getAttribute('aria-label')).toContain('(3)'); toggle.click(); expect(panel.element.open).toBe(true);
    panel.update(4, true, false); expect(panel.element.open).toBe(true); expect(toggle.title).toContain('上传中');
    panel.update(4, false, true); expect(toggle.title).toContain('失败'); expect(panel.element.dataset.state).toBe('failed');
    media.matches = false; listeners.forEach(run => run()); expect(panel.element.open).toBe(true);
    media.matches = true; listeners.forEach(run => run()); expect(panel.element.open).toBe(false);
    panel.update(0, false, false); expect(panel.element.hidden).toBe(true); panel.destroy(); expect(listeners.size).toBe(0);
});
