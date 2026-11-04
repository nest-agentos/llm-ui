import {afterEach, expect, it, vi} from 'vitest';
import {GraphCanvas, type GraphModel, type GraphNode, type GraphEdge} from '../src/graph-canvas';

const canvases: GraphCanvas[] = [];
afterEach(() => {canvases.splice(0).forEach(canvas => canvas.destroy()); document.body.replaceChildren();});
function fixture() {
    const root = document.createElement('div'); document.body.append(root);
    const onMoveNode = vi.fn(), onConnect = vi.fn();
    const canvas = new GraphCanvas(root, {onMoveNode, onConnect}); canvases.push(canvas);
    const model: GraphModel<GraphNode, GraphEdge> = {revision: 7, zoom: 2, edges: [], nodes: [
        {id: 'a', name: 'A', position: {x: 10, y: 20}, inputs: [{id: 'in', label: 'Input'}], outputs: [{id: 'out', label: 'Output'}]},
    ]};
    canvas.render(model);
    return {root, canvas, model, onMoveNode, onConnect};
}
function pointer(target: EventTarget, type: string, x: number, y: number) {
    const event = new MouseEvent(type, {bubbles: true, button: 0, clientX: x, clientY: y});
    target.dispatchEvent(event);
}
it('commits drag coordinates in the model scale and ignores a click', () => {
    const f = fixture(), node = f.root.querySelector<HTMLElement>('[data-flow-node]')!;
    pointer(node, 'pointerdown', 0, 0); pointer(window, 'pointerup', 0, 0); expect(f.onMoveNode).not.toHaveBeenCalled();
    pointer(node, 'pointerdown', 0, 0); pointer(window, 'pointermove', 20, 40); pointer(window, 'pointerup', 20, 40);
    expect(f.onMoveNode).toHaveBeenCalledWith(f.model.nodes[0], {x: 20, y: 40});
});
it.each(['hide', 'destroy', 'render'])('cancels an in-flight drag on %s', action => {
    const f = fixture(), node = f.root.querySelector<HTMLElement>('[data-flow-node]')!;
    pointer(node, 'pointerdown', 0, 0); pointer(window, 'pointermove', 20, 40);
    if (action === 'hide') f.canvas.setActive(false);
    if (action === 'destroy') f.canvas.destroy();
    if (action === 'render') f.canvas.render(f.model);
    pointer(window, 'pointerup', 40, 80); expect(f.onMoveNode).not.toHaveBeenCalled();
});
it('captures the connection revision and cancels it when the graph changes', () => {
    const f = fixture(), output = () => f.root.querySelector<HTMLButtonElement>('[data-port="output"]')!, input = () => f.root.querySelector<HTMLButtonElement>('[data-port="input"]')!;
    output().click(); input().click();
    expect(f.onConnect).toHaveBeenCalledWith({nodeId: 'a', portId: 'out'}, {nodeId: 'a', portId: 'in'}, 7);
    output().click(); f.canvas.render({...f.model, revision: 8}); input().click(); expect(f.onConnect).toHaveBeenCalledTimes(1);
    f.canvas.setActive(false); output().click(); input().click(); expect(f.onConnect).toHaveBeenCalledTimes(1);
});
