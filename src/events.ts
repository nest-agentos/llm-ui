interface ListenerRecord {
    target: EventTarget;
    type: string;
    handler: EventListenerOrEventListenerObject;
    capture: boolean;
}

export class EventCleanup {
    private listeners: ListenerRecord[] = [];

    add(
        target: EventTarget,
        type: string,
        handler: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
    ): void {
        const capture = typeof options === 'boolean'
            ? options
            : (options as AddEventListenerOptions)?.capture ?? false;

        target.addEventListener(type, handler, options);
        this.listeners.push({ target, type, handler, capture });
    }

    cleanup(): void {
        for (const { target, type, handler, capture } of this.listeners) {
            target.removeEventListener(type, handler, capture);
        }
        this.listeners = [];
    }
}
