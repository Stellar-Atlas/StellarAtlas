/* tslint:disable */
/* eslint-disable */
/**
* @param {string} json_fbas
* @param {string} json_orgs
* @param {number} merge_by
* @returns {any}
*/
export function analyze_minimal_quorums(json_fbas: string, json_orgs: string, merge_by: number): any;
/**
* @param {string} json_fbas
* @param {string} json_orgs
* @param {string} faulty_nodes
* @param {number} merge_by
* @returns {any}
*/
export function analyze_minimal_blocking_sets(json_fbas: string, json_orgs: string, faulty_nodes: string, merge_by: number): any;
/**
* @param {string} json_fbas
* @param {string} json_orgs
* @param {number} merge_by
* @returns {any}
*/
export function analyze_minimal_splitting_sets(json_fbas: string, json_orgs: string, merge_by: number): any;
/**
* @param {string} json_fbas
* @param {string} json_orgs
* @param {number} merge_by
* @returns {any}
*/
export function analyze_top_tier(json_fbas: string, json_orgs: string, merge_by: number): any;
/**
* @param {string} json_fbas
* @param {string} json_orgs
* @param {number} merge_by
* @returns {any}
*/
export function analyze_symmetric_top_tier(json_fbas: string, json_orgs: string, merge_by: number): any;
/**
*/
export function init_panic_hook(): void;
/**
*/
export enum MergeBy {
  DoNotMerge,
  Orgs,
  ISPs,
  Countries,
}
