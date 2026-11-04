export {randomUUID} from '../random';
import {randomUUID} from '../random';
export const shortUUID = () => randomUUID().replaceAll('-', '').slice(0,12);
