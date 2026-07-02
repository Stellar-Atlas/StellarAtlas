/* tslint:disable */
/* eslint-disable */
/**
* @param {string} json_fbas
* @param {string} json_orgs
* @param {MergeBy} merge_by
* @returns {any}
*/
export function analyze_minimal_quorums(json_fbas: string, json_orgs: string, merge_by: MergeBy): any;
/**
* @param {string} json_fbas
* @param {string} json_orgs
* @param {string} faulty_nodes
* @param {MergeBy} merge_by
* @returns {any}
*/
export function analyze_minimal_blocking_sets(json_fbas: string, json_orgs: string, faulty_nodes: string, merge_by: MergeBy): any;
/**
* @param {string} json_fbas
* @param {string} json_orgs
* @param {MergeBy} merge_by
* @returns {any}
*/
export function analyze_minimal_splitting_sets(json_fbas: string, json_orgs: string, merge_by: MergeBy): any;
/**
* @param {string} json_fbas
* @param {string} json_orgs
* @param {MergeBy} merge_by
* @returns {any}
*/
export function analyze_top_tier(json_fbas: string, json_orgs: string, merge_by: MergeBy): any;
/**
* @param {string} json_fbas
* @param {string} json_orgs
* @param {MergeBy} merge_by
* @returns {any}
*/
export function analyze_symmetric_top_tier(json_fbas: string, json_orgs: string, merge_by: MergeBy): any;
/**
*/
export function init_panic_hook(): void;
/**
*/
export enum MergeBy {
  DoNotMerge = 0,
  Orgs = 1,
  ISPs = 2,
  Countries = 3,
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly analyze_minimal_quorums: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly analyze_minimal_blocking_sets: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
  readonly analyze_minimal_splitting_sets: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly analyze_top_tier: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly analyze_symmetric_top_tier: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly init_panic_hook: () => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
