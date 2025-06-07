/**
 * @file eslint-find-rules.d.ts
 * @description This file is used to define the types for the eslint-find-rules package.
 */
declare module 'eslint-find-rules' {
  export default function getRuleFinder(config: string): {
    getCurrentRules(): string[]
    getCurrentRulesDetailed(): string[]
    getPluginRules(): string[]
    getAllAvailableRules(): string[]
    getUnusedRules(): string[]
    getDeprecatedRules(): string[]
  }
}