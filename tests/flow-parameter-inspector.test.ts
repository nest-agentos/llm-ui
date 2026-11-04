import { afterEach, expect, it, vi } from 'vitest';
import { mountFlowInspector } from '../src/flow-inspector';
import { createFlowView, createOperationLedger, type FlowSnapshot, type FlowView } from '../src/flow';
import type { FlowInspectorContext, MountedFlowInspector } from '../src/flow-contracts';

const inspectors: MountedFlowInspector[] = [], views: FlowView[] = [];
afterEach(async () => {
    await Promise.all(inspectors.splice(0).map(inspector => inspector.destroy()));
    await Promise.all(views.splice(0).map(view => view.destroy())); document.body.replaceChildren();
});

function snapshot(): FlowSnapshot {
    return { flowId: 'flow', viewId: 'view', revision: 1, graphRevision: 2, title: 'Flow', edges: [], allowed: ['updateNode'], loading: false,
        nodeTypes: [{ id: 'kind', label: 'Node', fields: [
            { id: 'text', label: 'Text', kind: 'text' }, { id: 'count', label: 'Count', kind: 'number' },
            { id: 'enabled', label: 'Enabled', kind: 'boolean' }, { id: 'data', label: 'Data', kind: 'json' },
            { id: 'choice', label: 'Choice', kind: 'choice', choices: [{ id: 'first', label: 'First choice' }, { id: 'second', label: 'Second choice' }] },
        ] }], nodes: [{ id: 'node', revision: 4, type: 'kind', name: 'Node', config: {
            text: 'before', count: 1, enabled: true, data: { keep: true }, choice: 'second', hidden: 'preserved',
        }, position: { x: 0, y: 0 }, inputs: [], outputs: [] }] };
}

it('uses shared controls without losing false, zero, null, cleared strings or undisplayed node config', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const source = snapshot(), commit = vi.fn(async () => {});
    const context: FlowInspectorContext = { node: source.nodes[0], snapshot: source, canEdit: true, commit };
    inspectors.push(mountFlowInspector(host, context, key => key));
    const form = host.querySelector('form')!;
    form.querySelector<HTMLInputElement>('[name="text"]')!.value = '';
    form.querySelector<HTMLInputElement>('[name="count"]')!.value = '0';
    form.querySelector<HTMLInputElement>('[name="enabled"]')!.checked = false;
    form.querySelector<HTMLTextAreaElement>('[name="data"]')!.value = 'null';
    const select = form.querySelector<HTMLSelectElement>('[name="choice"]')!;
    expect(select.selectedOptions[0].textContent).toBe('Second choice'); select.value = '';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
    expect(commit.mock.calls[0][0]).toEqual({ name: 'Node', config: {
        text: '', count: 0, enabled: false, data: null, choice: '', hidden: 'preserved',
    } });
});

it('retains the form for correction when shared JSON validation fails', async () => {
    const host = document.createElement('div'); const source = snapshot(), commit = vi.fn(async () => {});
    inspectors.push(mountFlowInspector(host, { node: source.nodes[0], snapshot: source, canEdit: true, commit }, key => key,
        { error: (kind, parameter) => `${parameter.label}:${kind}` }));
    const form = host.querySelector('form')!, data = form.querySelector<HTMLTextAreaElement>('[name="data"]')!;
    data.value = '{'; form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(host.textContent).toContain('Data:json'));
    expect(commit).not.toHaveBeenCalled(); expect(host.querySelector('form')).toBe(form); expect(data.disabled).toBe(false);
    data.value = '{"fixed":true}'; form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
});

it('passes field customization through FlowOptions while preserving the captured node revision', async () => {
    let current = snapshot(); const listeners = new Set<() => void>();
    const updateNode = vi.fn(async (_target, _change, context) => ({ status: 'rejected' as const, operationId: context.operationId, code: 'CONFLICT', message: 'Changed' }));
    const host = document.createElement('div'); document.body.append(host);
    const view = await createFlowView(host, {
        source: { getSnapshot: () => current, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } },
        operations: createOperationLedger(), actions: { updateNode, reconcile: async operationId => ({ status: 'accepted', operationId }) },
        parameterForm: { classes: { label: 'custom-field-label' },
            renderField: (parameter, index, render) => parameter.name === 'text'
                ? `<label>Custom<input data-parameter="${index}" name="text" value="custom"></label>` : render(),
            parseField: (parameter, _index, field, parse) => parameter.name === 'text' ? field.value.toUpperCase() : parse(),
        },
    });
    views.push(view); view.selectNode('node');
    expect(host.querySelector('.custom-field-label')).not.toBeNull();
    current = { ...current, revision: 2, nodes: [{ ...current.nodes[0], revision: 5 }] }; listeners.forEach(listener => listener());
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(updateNode).toHaveBeenCalledOnce());
    expect(updateNode.mock.calls[0][0]).toEqual({ nodeId: 'node', expectedRevision: 4 });
    expect(updateNode.mock.calls[0][1].config.text).toBe('CUSTOM');
});
