import './graph.css';
import {randomUUID} from './random';
import {element, button} from './dom';
import {EventCleanup} from './events';

export interface GraphPort {id: string; label: string}
export interface GraphNode {id: string; name: string; position: {x: number; y: number}; inputs: readonly GraphPort[]; outputs: readonly GraphPort[]; description?: string; state?: string}
export interface GraphEndpoint {nodeId: string; portId: string}
export interface GraphEdge {id: string; from: GraphEndpoint; to: GraphEndpoint; label?: string; kind?: 'data' | 'control'; viaY?: number}
export interface GraphModel<Node extends GraphNode, Edge extends GraphEdge> {nodes: readonly Node[]; edges: readonly Edge[]; revision?: number; zoom?: number}
export interface GraphCanvasOptions<Node extends GraphNode, Edge extends GraphEdge> {
    onSelectNode?(node: Node): void; onEditNode?(node: Node): void; onSelectCanvas?(): void;
    onMoveNode?(node: Node, position: {x: number; y: number}): void;
    onConnect?(from: GraphEndpoint, to: GraphEndpoint, revision?: number): void;
    onSelectEdge?(edge: Edge): void; onDisconnectEdge?(edge: Edge): void;
    mountNode?(root: HTMLElement, node: Node): void;
    minCoordinate?: number;
}

/** One renderer owns node geometry, edges, drag and connection gestures for every host. */
export class GraphCanvas<Node extends GraphNode = GraphNode, Edge extends GraphEdge = GraphEdge> {
    private readonly surface = element('div', 'dag-canvas__surface');
    private readonly edges = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    private readonly events = new EventCleanup();
    private readonly nodes = new Map<string, HTMLElement>();
    private readonly identity = randomUUID();
    private model: GraphModel<Node, Edge> = {nodes: [], edges: []};
    private pending?: {from: GraphEndpoint; revision?: number};
    private drag?: AbortController;
    private connection?: AbortController;
    private selected?: string;
    private canMove = true;
    private canConnect = true;
    private canDisconnect = true;
    private closed = false;
    private active = true;
    constructor(private readonly root: HTMLElement, private readonly options: GraphCanvasOptions<Node, Edge> = {}) {
        root.classList.add('llm-graph'); this.edges.classList.add('dag-canvas__edges'); this.surface.append(this.edges); root.append(this.surface);
        this.events.add(this.surface, 'click', event => this.click(event));
    }
    render(model: GraphModel<Node, Edge>, selected?: string, selectedEdge?: string, allowed = {move: true, connect: true, disconnect: true}): void {
        if (this.closed) return; this.cancelDrag(); if (this.model.revision !== model.revision) this.clearConnection(); this.model = model; this.selected = selected;
        this.canMove = allowed.move; this.canConnect = allowed.connect; this.canDisconnect = allowed.disconnect;
        const zoom = validZoom(model.zoom); this.surface.style.transform = `scale(${zoom})`;
        this.surface.style.width = `${Math.max(1200, ...model.nodes.map(node => node.position.x + 220))}px`;
        this.surface.style.height = `${Math.max(760, ...model.nodes.map(node => node.position.y + nodeHeight(node) + 40))}px`;
        const ids = new Set(model.nodes.map(node => node.id));
        for (const [id, view] of this.nodes) if (!ids.has(id)) {view.remove(); this.nodes.delete(id);}
        for (const node of model.nodes) this.renderNode(node);
        this.renderEdges(selectedEdge);
    }
    fit(): void {this.surface.scrollIntoView?.({block: 'nearest', inline: 'nearest'});}
    private renderNode(node: Node): void {
        let view = this.nodes.get(node.id);
        if (!view) {view = element('article', 'dag-node llm-flow__node'); view.dataset.flowNode = node.id; view.dataset.nodeId = node.id; this.nodes.set(node.id, view); this.surface.append(view);}
        Object.assign(view.style, {left: `${node.position.x}px`, top: `${node.position.y}px`, minHeight: `${nodeHeight(node)}px`});
        view.classList.toggle('is-selected', this.selected === node.id); view.dataset.selected = String(this.selected === node.id); view.replaceChildren();
        const heading = button(node.name, () => {if (this.active) this.options.onSelectNode?.(node);}); heading.dataset.graphHeading = ''; view.append(heading);
        if (node.description) view.append(element('small', 'dag-node__kind', node.description));
        for (const side of ['inputs', 'outputs'] as const) node[side].forEach((port, index) => {
            const control = button('', () => {}); control.className = `dag-port dag-port--${side === 'inputs' ? 'input' : 'output'}`;
            control.dataset.port = side === 'inputs' ? 'input' : 'output'; control.dataset.portSide = side; control.dataset.portId = port.id;
            control.style.top = `${42 + index * 22}px`; control.title = port.label; control.setAttribute('aria-label', port.label); control.disabled = !this.canConnect; view!.append(control);
            control.addEventListener('pointerdown', event => {event.stopPropagation(); if (side === 'outputs' && this.canConnect) this.startConnection(event, {nodeId: node.id, portId: port.id});});
        });
        if (node.state) view.append(element('small', 'dag-node__state', node.state));
        this.options.mountNode?.(view, node);
        view.onpointerdown = event => this.startDrag(event, node, view!);
        view.ondblclick = event => {if (this.active && !(event.target as HTMLElement).closest('[data-port]')) this.options.onEditNode?.(node);};
    }
    private click(event: Event): void {
        if (!this.active || this.closed) return;
        const target = event.target as HTMLElement, node = target.closest<HTMLElement>('[data-flow-node]'), port = target.closest<HTMLElement>('[data-port]');
        if (port && node && this.canConnect) {
            event.stopPropagation(); const endpoint = {nodeId: node.dataset.flowNode!, portId: port.dataset.portId!};
            if (port.dataset.port === 'output') this.begin(endpoint); else this.connect(endpoint); return;
        }
        if (node) {if (!target.closest('[data-graph-heading]')) this.selectNode(node.dataset.flowNode!); return;}
        if (!target.closest('[data-edge-id]')) {this.clearConnection(); this.options.onSelectCanvas?.();}
    }
    private selectNode(id: string): void {const node = this.model.nodes.find(item => item.id === id); if (node) this.options.onSelectNode?.(node);}
    private begin(from: GraphEndpoint): void {this.pending = {from, revision: this.model.revision}; this.root.classList.add('is-connecting');}
    private connect(to: GraphEndpoint): void {const pending = this.pending; this.clearConnection(); if (pending) this.options.onConnect?.(pending.from, to, pending.revision);}
    private startConnection(event: PointerEvent, from: GraphEndpoint): void {
        if (!this.active || event.button !== 0) return;
        this.connection?.abort(); this.begin(from); const abort = this.connection = new AbortController();
        document.addEventListener('pointerup', next => {
            abort.abort(); const target = next.target as HTMLElement | null;
            if (!target || !this.root.contains(target)) return;
            const port = target.closest<HTMLElement>('[data-port="input"]'), node = port?.closest<HTMLElement>('[data-flow-node]');
            if (port && node) this.connect({nodeId: node.dataset.flowNode!, portId: port.dataset.portId!});
        }, {once: true, signal: abort.signal});
        document.addEventListener('pointercancel', () => this.clearConnection(), {once: true, signal: abort.signal});
    }
    private clearConnection(): void {this.pending = undefined; this.connection?.abort(); this.connection = undefined; this.root.classList.remove('is-connecting');}
    private startDrag(event: PointerEvent, node: Node, view: HTMLElement): void {
        if (!this.active || !this.canMove || event.button !== 0 || (event.target as HTMLElement).closest('[data-port]')) return;
        this.cancelDrag(); const abort = this.drag = new AbortController(), start = {x: event.clientX, y: event.clientY}; let moved = false;
        const scale = validZoom(this.model.zoom), minimum = this.options.minCoordinate ?? 0;
        const position = (next: PointerEvent) => ({x: Math.max(minimum, node.position.x + (next.clientX - start.x) / scale), y: Math.max(minimum, node.position.y + (next.clientY - start.y) / scale)});
        window.addEventListener('pointermove', next => {
            if (Math.hypot(next.clientX - start.x, next.clientY - start.y) < 4 && !moved) return;
            moved = true; const point = position(next); view.classList.add('is-dragging'); view.style.left = `${point.x}px`; view.style.top = `${point.y}px`;
        }, {signal: abort.signal});
        window.addEventListener('pointerup', next => {
            abort.abort(); this.drag = undefined; view.classList.remove('is-dragging');
            if (moved && !this.closed) this.options.onMoveNode?.(node, position(next));
        }, {once: true, signal: abort.signal});
        window.addEventListener('pointercancel', () => {this.cancelDrag(); view.style.left = `${node.position.x}px`; view.style.top = `${node.position.y}px`;}, {once: true, signal: abort.signal});
    }
    private cancelDrag(): void {
        this.drag?.abort(); this.drag = undefined;
        for (const node of this.model.nodes) {
            const view = this.nodes.get(node.id); if (!view) continue;
            view.classList.remove('is-dragging'); view.style.left = `${node.position.x}px`; view.style.top = `${node.position.y}px`;
        }
    }
    private renderEdges(selected?: string): void {
        const namespace = 'http://www.w3.org/2000/svg', defs = document.createElementNS(namespace, 'defs'); this.edges.replaceChildren(defs);
        for (const kind of ['data', 'control']) {
            const marker = document.createElementNS(namespace, 'marker'); marker.id = `${this.identity}-${kind}`;
            for (const [key, value] of Object.entries({viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse'})) marker.setAttribute(key, value);
            const shape = document.createElementNS(namespace, 'path'); shape.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z'); shape.style.fill = kind === 'data' ? '#60a5fa' : '#a78bfa'; shape.style.stroke = 'none'; marker.append(shape); defs.append(marker);
        }
        for (const edge of this.model.edges) {
            const from = this.model.nodes.find(node => node.id === edge.from.nodeId), to = this.model.nodes.find(node => node.id === edge.to.nodeId); if (!from || !to) continue;
            const path = document.createElementNS(namespace, 'path'), kind = edge.kind ?? 'data'; path.setAttribute('data-edge-id', edge.id);
            path.setAttribute('d', edgePath(from, to, edge)); path.setAttribute('class', `is-${kind}${edge.id === selected ? ' is-selected' : ''}`); path.setAttribute('marker-end', `url(#${this.identity}-${kind})`);
            path.setAttribute('aria-label', edge.label ?? edge.id); path.setAttribute('tabindex', '0');
            path.addEventListener('click', event => {if (!this.active) return; event.stopPropagation(); this.clearConnection(); this.options.onSelectEdge?.(edge);});
            if (this.canDisconnect) {path.addEventListener('dblclick', () => {if (this.active) this.options.onDisconnectEdge?.(edge);}); path.addEventListener('keydown', event => {if (this.active && (event as KeyboardEvent).key === 'Delete') this.options.onDisconnectEdge?.(edge);});}
            this.edges.append(path);
        }
    }
    setActive(active: boolean): void {this.active = active; if (!active) {this.cancelDrag(); this.clearConnection();}}
    destroy(): void {if (this.closed) return; this.closed = true; this.cancelDrag(); this.clearConnection(); this.events.cleanup(); this.nodes.clear(); this.surface.remove();}
}
function nodeHeight(node: GraphNode): number {return Math.max(90, 60 + Math.max(node.inputs.length, node.outputs.length) * 22);}
function edgePath(from: GraphNode, to: GraphNode, edge: GraphEdge): string {
    const x = from.position.x + 180, y = from.position.y + 42 + Math.max(0, from.outputs.findIndex(port => port.id === edge.from.portId)) * 22;
    const endX = to.position.x, endY = to.position.y + 42 + Math.max(0, to.inputs.findIndex(port => port.id === edge.to.portId)) * 22;
    if (edge.viaY !== undefined) return `M ${x} ${y} L ${x + 30} ${y} L ${x + 30} ${edge.viaY} L ${endX - 30} ${edge.viaY} L ${endX - 30} ${endY} L ${endX} ${endY}`;
    const bend = Math.max(40, Math.abs(endX - x) / 2); return `M ${x} ${y} C ${x + bend} ${y}, ${endX - bend} ${endY}, ${endX} ${endY}`;
}

function validZoom(zoom?: number): number {return zoom && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;}
