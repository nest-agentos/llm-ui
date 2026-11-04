/** View-local events never own a host service or connection. */
export class EventBus<T extends object> {
    private readonly listeners = new Map<keyof T, Set<(value: never) => void>>();
    on<K extends keyof T>(key: K, listener: (value:T[K])=>void):()=>void {
        const set=this.listeners.get(key)??new Set();set.add(listener as (value:never)=>void);this.listeners.set(key,set);
        return ()=>{set.delete(listener as (value:never)=>void);};
    }
    emit<K extends keyof T>(key:K,value:T[K]):void {for(const listener of this.listeners.get(key)??[])listener(value as never);}
    clear():void {this.listeners.clear();}
}
