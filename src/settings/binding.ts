import type {SettingsRuntime} from './runtime';
export type Constructor = new (...args: never[]) => object;
export type Tail<T> = T extends [unknown,...infer A] ? A : never;
export type Bound<C extends Constructor> = {new (...args:Tail<ConstructorParameters<C>>):InstanceType<C>} & {
    [K in keyof C]: C[K] extends (runtime:SettingsRuntime,...args:infer A)=>infer R ? (...args:A)=>R : C[K]
};
/** Keep context out of public constructors while retaining static factories and prototypes. */
export function bindConstructor<C extends Constructor>(type:C,runtime:SettingsRuntime,optionsIndex?:number):Bound<C> {
    const bound=function(...args:unknown[]) {
        if(optionsIndex!==undefined && runtime.prepareOptions) args[optionsIndex]=runtime.prepareOptions(args[optionsIndex]);
        return Reflect.construct(type,[runtime,...args]);
    };
    bound.prototype=type.prototype;
    for(const key of Object.getOwnPropertyNames(type)) {
        const value=Object.getOwnPropertyDescriptor(type,key)?.value;
        if(key!=='prototype' && typeof value==='function') Object.defineProperty(bound,key,{value:(...args:unknown[])=>{if(optionsIndex!==undefined&&runtime.prepareOptions)args[optionsIndex]=runtime.prepareOptions(args[optionsIndex]);return Reflect.apply(value,type,[runtime,...args]);}});
    }
    return bound as unknown as Bound<C>;
}
