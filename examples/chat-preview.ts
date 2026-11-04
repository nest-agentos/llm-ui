import '@itookit/mdxeditor/style.css';
import {createChatView} from '../src';
import {createMemoryHost} from './memory-host';

async function mount(id: string): Promise<void> {
    const host = createMemoryHost();
    const container = document.getElementById(id)!, view = await createChatView(container, {...host.options, locale: 'zh-CN'});
    for (const text of ['界面可以用在哪些应用？', '输入、消息和提问目录共用组件，宿主负责业务连接。']) {
        view.setText(text); await view.submit();
    }
    view.setText('保留各自的输入草稿与滚动位置。');
    const button = document.createElement('button'); button.textContent = '切换绑定，保留输入';
    container.previousElementSibling!.append(button);
    const retain = async () => {
        const input = container.querySelector<HTMLTextAreaElement>('.llm-chat__input')!, history = container.querySelector('.llm-chat__history');
        const text = input.value, start = input.selectionStart, end = input.selectionEnd;
        await host.rebind(view);
        const preserved = container.querySelector('.llm-chat__input') === input && container.querySelector('.llm-chat__history') === history
            && input.value === text && input.selectionStart === start && input.selectionEnd === end;
        button.dataset.retained = String(preserved); button.textContent = preserved ? '绑定已切换，输入已保留' : '保留检查未通过';
        if (!preserved) throw new Error('Retained view check failed');
    };
    button.onclick = () => {void retain().catch(error => {button.textContent = error.message;});};
    if (id === 'default' && new URLSearchParams(location.search).has('retain')) {
        const input = container.querySelector<HTMLTextAreaElement>('.llm-chat__input')!; input.focus(); input.setSelectionRange(3, 7); await retain();
        if (document.activeElement !== input) throw new Error('Retained focus check failed');
    }
    window.addEventListener('pagehide', () => {void view.destroy();}, {once: true});
}
await Promise.all(['default', 'themed'].map(mount));
document.documentElement.dataset.previewReady = 'true';
