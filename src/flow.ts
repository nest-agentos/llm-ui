import {GraphCanvas} from './graph-canvas';
export {GraphCanvas} from './graph-canvas';
export type * from './graph-canvas';
import { randomUUID } from './random';
import './flow.css';
import type { JsonValue, OperationContext, OperationKind, OperationReceipt } from './contracts';
import type { FlowActionName, FlowEdgeView, FlowNodeChange, FlowNodeView, FlowOptions, FlowSnapshot, FlowView, MountedFlowInspector } from './flow-contracts';
import { button, disposeAll, element, errorText } from './dom';
import { mountFlowInspector } from './flow-inspector';
import {diagnoseOperation} from './diagnostics';
import {registerOperation, settleOperation} from './operation-journal';

export type * from './flow-contracts';
export { createOperationLedger } from './operations';
const zh: Record<string, string> = { addNode: '添加节点', updateNode: '更新节点', removeNode: '删除节点', connect: '连接', disconnect: '断开连接',
    save: '保存', run: '运行', cancel: '停止', refresh: '刷新', apply: '应用', name: '名称', accepted: '已接纳', reconcile: '核对操作',
    waitingChanges: '等待已保存的节点更新' };

class FlowController implements FlowView {
    private readonly root = element('section', 'llm-flow');
    private readonly toolbar = element('header', 'llm-flow__toolbar');
    private readonly palette = element('aside', 'llm-flow__palette');
    private readonly canvas = element('div', 'llm-flow__canvas');
    private readonly graph: GraphCanvas<FlowNodeView, FlowEdgeView>;
    private readonly inspector = element('aside', 'llm-flow__inspector');
    private readonly output = element('pre', 'llm-flow__output');
    private readonly feedback = element('div', 'llm-flow__error');
    private readonly disposers: (() => void | Promise<void>)[] = [];
    private readonly inFlight = new Set<string>();
    private readonly t: (key: string) => string;
    private snapshot!: FlowSnapshot;
    private binding?: string;
    private flowId?: string;
    private selected?: string;
    private mounted?: MountedFlowInspector;
    private inspectorVersion = 0;
    private waitingInspector?: { id: string; revision: number; change: FlowNodeChange };
    private active = true;
    private closed = false;
    private disposed?: Promise<void>;
    constructor(container: HTMLElement, private readonly options: FlowOptions) {
        this.t = key => options.translate?.(key) ?? (options.locale === 'en' ? key : zh[key] ?? key);
        const body = element('div', 'llm-flow__workspace'); body.append(this.palette, this.canvas, this.inspector);
        this.canvas.tabIndex = 0;
        this.graph = new GraphCanvas(this.canvas, {
            onSelectNode: node => this.selectNode(node.id),
            onMoveNode: (node, position) => {void this.commit(node, {position}).catch(error => this.report(error));},
            onConnect: (from, to, revision) => {
                const edge = {from: {...from}, to: {...to}, expectedGraphRevision: revision!};
                this.launch('connect', edge, context => this.options.actions.connect!(edge, context));
            },
            onDisconnectEdge: edge => {
                const target = {edgeId: edge.id, expectedRevision: edge.revision};
                this.launch('disconnect', target, context => this.options.actions.disconnect!(target, context));
            },
        });
        this.root.append(this.toolbar, body, this.output, this.feedback); container.append(this.root);
    }
    initialize(): void {
        if (Object.keys(this.options.actions).some(key => key !== 'reconcile') && !this.options.actions.reconcile)
            throw new Error('Mutating Flow hosts must provide reconciliation');
        this.disposers.push(this.options.source.subscribe(() => this.changed()));
        this.disposers.push(this.options.operations.subscribe(() => { if (!this.closed && this.active) this.renderOperations(); }));
        this.changed();
        const slot = this.options.mountToolbar?.(this.toolbar, this.snapshot); if (slot) this.disposers.push(() => slot.destroy());
    }
    private changed(): void {
        if (this.closed) return;
        const next = this.options.source.getSnapshot();
        this.binding ??= next.viewId; this.flowId ??= next.flowId;
        if (next.viewId !== this.binding || next.flowId !== this.flowId || this.snapshot && next.revision < this.snapshot.revision) return;
        this.snapshot = next;
        if (this.active) this.render();
    }
    private render(): void {
        this.refreshInspector();
        this.renderToolbar(); this.renderPalette(); this.renderCanvas(); this.renderOperations();
        if (this.selected && !this.snapshot.nodes.some(node => node.id === this.selected)) this.clearInspector();
        this.output.textContent = this.snapshot.execution ? JSON.stringify(this.snapshot.execution, null, 2) : '';
    }
    private renderToolbar(): void {
        this.toolbar.querySelectorAll('[data-flow-action]').forEach(node => node.remove());
        const title = element('strong', undefined, this.snapshot.title); title.dataset.flowAction = 'title'; this.toolbar.prepend(title);
        for (const name of ['save', 'run', 'cancel'] as const) if (this.can(name)) {
            const revision = this.snapshot.graphRevision, executionRef = this.snapshot.execution?.executionRef;
            if (name === 'cancel' && !executionRef) continue;
            const control = button(this.t(name), () => this.launch(name, name === 'cancel' ? executionRef! : revision,
                context => name === 'cancel' ? this.options.actions.cancel!(executionRef!, context) : this.options.actions[name]!(revision, context)));
            control.dataset.flowAction = name; this.toolbar.append(control);
        }
        if (this.options.source.refresh) {
            const control = button(this.t('refresh'), () => { void this.options.source.refresh!().catch(error => this.report(error)); });
            control.dataset.flowAction = 'refresh'; this.toolbar.append(control);
        }
    }
    private renderPalette(): void {
        this.palette.replaceChildren();
        for (const type of this.snapshot.nodeTypes) {
            const control = button(type.label, () => this.launch('addNode', type.id,
                context => this.options.actions.addNode!(type.id, { x: 24, y: this.snapshot.nodes.length * 120 + 24 }, context)));
            control.title = type.description ?? ''; control.disabled = !this.can('addNode'); this.palette.append(control);
        }
    }
    private renderCanvas(): void {
        const nodes = this.snapshot.nodes.map(node => ({...node, state: this.snapshot.execution?.nodes[node.id]?.state}));
        this.graph.render({nodes, edges: this.snapshot.edges, revision: this.snapshot.graphRevision}, this.selected, undefined,
            {move: this.can('updateNode'), connect: this.can('connect'), disconnect: this.can('disconnect')});
    }
    selectNode(id: string): void {
        if (this.closed) return;
        const node = this.snapshot.nodes.find(item => item.id === id); if (!node) return;
        this.clearInspector(); this.selected = id;
        const version = this.inspectorVersion;
        const context = { node, snapshot: this.snapshot, canEdit: this.can('updateNode'),
            commit: (change: FlowNodeChange) => this.commitInspector(node, change, version) };
        try { this.mounted = this.options.mountInspector?.(this.inspector, context) ?? mountFlowInspector(this.inspector, context, this.t, this.options.parameterForm); }
        catch (error) { this.report(error); }
        if (this.can('removeNode')) this.inspector.append(button(this.t('removeNode'), () => {
            const target = { nodeId: node.id, expectedRevision: node.revision };
            this.launch('removeNode', target, operation => this.options.actions.removeNode!(target, operation));
        }));
        this.renderCanvas();
    }
    private commit(node: FlowNodeView, change: FlowNodeChange): Promise<void> {
        const target = { nodeId: node.id, expectedRevision: node.revision };
        return this.perform('updateNode', { ...target, ...change } as JsonValue, context => this.options.actions.updateNode!(target, change, context));
    }
    private async commitInspector(node: FlowNodeView, change: FlowNodeChange, version: number): Promise<void> {
        await this.commit(node, change);
        if (this.closed || this.inspectorVersion !== version) return;
        this.clearInspector(); this.selected = node.id;
        this.waitingInspector = { id: node.id, revision: node.revision, change };
        this.inspector.textContent = this.t('waitingChanges');
        this.refreshInspector();
    }
    private refreshInspector(): void {
        const pending = this.waitingInspector;
        if (!pending) return;
        const node = this.snapshot.nodes.find(item => item.id === pending.id);
        if (node && (node.revision !== pending.revision || matchesChange(node, pending.change))) this.selectNode(node.id);
    }
    private clearInspector(): void {
        ++this.inspectorVersion; this.waitingInspector = undefined;
        const mounted = this.mounted; this.mounted = undefined; this.selected = undefined; this.inspector.replaceChildren();
        if (mounted) { const task = Promise.resolve().then(() => mounted.destroy()); void task.catch(() => {}); this.disposers.push(() => task); }
    }
    private can(name: FlowActionName): boolean { return !!this.options.actions[name] && this.snapshot.allowed.includes(name); }
    private launch(name: FlowActionName, input: JsonValue, action: (context: OperationContext) => Promise<OperationReceipt>): void {
        void this.perform(name, input, action).catch(error => this.report(error));
    }
    private async perform(name: FlowActionName, input: JsonValue, action: (context: OperationContext) => Promise<OperationReceipt>): Promise<void> {
        if (this.closed || !this.can(name)) throw new Error('Flow operation unavailable');
        if (this.blocked(name, input))
            throw new Error('A Flow operation is awaiting reconciliation');
        const key = `${name}:${JSON.stringify(input)}`; if (this.inFlight.has(key)) return; this.inFlight.add(key);
        const context = { viewId: this.snapshot.viewId, operationId: randomUUID() };
        try {
            if (!await registerOperation(this.options, { context, conversationId: this.snapshot.flowId, kind: flowKind(name), input, status: 'submitting' })) return;
            const started = Date.now();
            let receipt: OperationReceipt, code: string | undefined;
            try { receipt = await action(context); }
            catch (error) {code = 'OPERATION_TRANSPORT_ERROR'; receipt = { status: 'unknown', operationId: context.operationId, message: errorText(error) }; }
            if (receipt.operationId !== context.operationId) {
                code = 'RECEIPT_IDENTITY_MISMATCH'; receipt = { status: 'unknown', operationId: context.operationId, message: 'Mismatched receipt identity' };
            }
            await settleOperation(this.options, receipt, flowKind(name));
            diagnoseOperation(this.options.onDiagnostic, {operationId: context.operationId, kind: flowKind(name), stage: 'dispatch', result: receipt.status}, started,
                receipt.status === 'rejected' ? receipt.code : code ?? (receipt.status === 'unknown' ? 'OUTCOME_UNCONFIRMED' : undefined));
            const result = this.options.operations.getSnapshot().find(record => record.context.operationId === context.operationId)!;
            if (result.status !== 'accepted') throw new Error(result.message ?? result.status);
        } finally { this.inFlight.delete(key); }
    }
    private blocked(name: FlowActionName, input: JsonValue): boolean {
        return this.options.operations.getSnapshot().some(record => record.conversationId === this.snapshot.flowId
            && record.kind.startsWith('flow.') && (record.status === 'unknown' || record.status === 'submitting')
            && (name === 'cancel' ? record.kind === 'flow.cancel' && record.input === input : record.kind !== 'flow.cancel'));
    }
    async reconcile(operationId: string): Promise<void> {
        const record = this.options.operations.getSnapshot().find(item => item.conversationId === this.snapshot.flowId && item.context.operationId === operationId);
        if (!record || !this.options.actions.reconcile) return;
        const receipt = await this.options.actions.reconcile(operationId);
        if (receipt.operationId !== operationId) throw new Error('Mismatched receipt identity');
        await settleOperation(this.options, receipt, record.kind);
    }
    private renderOperations(): void {
        this.feedback.replaceChildren(element('p', undefined, this.snapshot.error ?? ''));
        for (const record of this.options.operations.getSnapshot()) {
            if (record.conversationId !== this.snapshot.flowId || record.status === 'accepted') continue;
            const row = element('p', undefined, record.message ?? record.status);
            if ((record.status === 'unknown' || record.status === 'submitting') && this.options.actions.reconcile) row.append(button(this.t('reconcile'), () => {
                void this.reconcile(record.context.operationId).catch(error => this.report(error));
            }));
            this.feedback.append(row);
        }
    }
    private report(error: unknown): void { if (!this.closed) this.feedback.textContent = errorText(error); this.options.onError?.(error); }
    setActive(active: boolean): void { if (this.closed) return; this.active = active; this.graph.setActive(active); if (active) this.changed(); }
    focus(): void { if (!this.closed && this.active) this.canvas.focus(); }
    destroy(): Promise<void> {
        if (this.disposed) return this.disposed;
        this.closed = true; this.clearInspector(); this.graph.destroy();
        return this.disposed = disposeAll([...this.disposers, () => this.root.remove()]);
    }
}
function matchesChange(node: FlowNodeView, change: FlowNodeChange): boolean {
    return (change.name === undefined || change.name === node.name)
        && (change.config === undefined || JSON.stringify(change.config) === JSON.stringify(node.config))
        && (change.position === undefined || change.position.x === node.position.x && change.position.y === node.position.y);
}
function flowKind(name: FlowActionName): OperationKind {
    return ({ addNode: 'flow.add-node', updateNode: 'flow.update-node', removeNode: 'flow.remove-node', connect: 'flow.connect',
        disconnect: 'flow.disconnect', save: 'flow.save', run: 'flow.run', cancel: 'flow.cancel' } as const)[name];
}
export async function createFlowView(container: HTMLElement, options: FlowOptions): Promise<FlowView> {
    const controller = new FlowController(container, options);
    try { controller.initialize(); return controller; }
    catch (error) {
        try { await controller.destroy(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Flow initialization failed'); }
        throw error;
    }
}
