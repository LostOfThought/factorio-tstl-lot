import fs from 'node:fs';

import eslintCommentsPlugin from '@eslint-community/eslint-plugin-eslint-comments';
import stylistic from '@stylistic/eslint-plugin';
import { ESLint, Linter } from 'eslint';
import functionalPlugin from 'eslint-plugin-functional';
import importXPlugin from 'eslint-plugin-import-x';
import jsdocPlugin from 'eslint-plugin-jsdoc';
import nPlugin from 'eslint-plugin-n';
import noSecretsPlugin from 'eslint-plugin-no-secrets';
import perfectionistPlugin from 'eslint-plugin-perfectionist';
import promisePlugin from 'eslint-plugin-promise';
import regexpPlugin from 'eslint-plugin-regexp';
import securityPlugin from 'eslint-plugin-security';
import securityNodePlugin from 'eslint-plugin-security-node';
import sonarjsPlugin from 'eslint-plugin-sonarjs';
import tsdocPlugin from 'eslint-plugin-tsdoc';
import unicornPlugin from 'eslint-plugin-unicorn';
import globalsImport from 'globals';
import { decycle } from 'json-decycle';
import tseslint, { type ConfigArray } from 'typescript-eslint';

// Define a more specific type for the globals we use
interface GlobalsInterface {
  readonly es2025?: Readonly<Record<string, boolean>>;
  readonly node?: Readonly<Record<string, boolean>>;
  // Add other environments if you use them from 'globals' e.g. browser, jest, etc.
}

type ReadonlyDeep<T> = {
  readonly [P in keyof T]: T[P] extends object ? ReadonlyDeep<T[P]> : T[P];
};

const globals: Readonly<GlobalsInterface> = globalsImport;

// Use tseslint.config() to build and export the configuration array
// eslint-disable-next-line functional/prefer-immutable-types
const rules: ReadonlyDeep<ConfigArray> = tseslint.config(
  // Global ignores
  {
    ignores: [
      'node_modules/',
      'dist/',
      'dist-tools/',
      'releases/',
      '**/*.lua',
      'pnpm-lock.yaml',
      'LICENSE.md',
      '.github/',
      '*.md',
    ],
  },

  // TypeScript-ESLint base configs
  // tseslint.configs.base provides parser, parserOptions for sourceType: "module"
  tseslint.configs.base,
  // Spread array-based configurations
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    plugins: {
      '@eslint-community/eslint-comments': eslintCommentsPlugin as unknown as ESLint.Plugin,
    },
    rules: {
      '@eslint-community/eslint-comments/disable-enable-pair': 'error',
      '@eslint-community/eslint-comments/no-aggregating-enable': 'error',
      '@eslint-community/eslint-comments/no-duplicate-disable': 'error',
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
      '@eslint-community/eslint-comments/no-unused-enable': 'error',
    },
  },

  // Combined configuration for other plugins for all TypeScript files
  {
    files: ['**/*.ts'],
    languageOptions: {
      // parser is typically set by tseslint.configs.base
      // parserOptions can be extended here if needed, base already sets sourceType
      globals: {
        // Define any global variables used by Factorio/TSTL if necessary
      },
      parserOptions: {
        ecmaVersion: 'latest', // Keep if more specific than base
        // project will be set in specific configs for type-aware linting
      },
    },
    plugins: {
      '@eslint-community/eslint-comments': eslintCommentsPlugin as unknown as ESLint.Plugin,
      '@stylistic': stylistic,
      'functional': functionalPlugin,
      'import-x': importXPlugin,
      'jsdoc': jsdocPlugin,
      'n': nPlugin,
      'no-secrets': noSecretsPlugin,
      'perfectionist': perfectionistPlugin,
      'promise': promisePlugin as unknown as ESLint.Plugin,
      'regexp': regexpPlugin,
      'security': securityPlugin as unknown as ESLint.Plugin,
      'sonarjs': sonarjsPlugin,
      'tsdoc': tsdocPlugin,
      'unicorn': unicornPlugin,
    },
    settings: {
      'import-x/resolver': {
        typescript: true,
      },
      'jsdoc': {
        mode: 'typescript',
      },
    },

    rules: {
      // Base ESLint rules
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-console': 'warn',
      'no-eval': 'error',
      'no-var': 'error',
      'prefer-const': 'error',

      // TypeScript-ESLint rule overrides
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-namespace': [
        'error',
        { allowDeclarations: true },
      ],
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/prefer-readonly': 'warn',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowAny: false,
          allowNullableBoolean: false,
          allowNullableNumber: false,
          allowNullableObject: true,
          allowNullableString: false,
          allowNumber: false,
          allowString: false,
        },
      ],

      // Stylistic rules
      ...stylistic.configs.customize({
        indent: 2,
        quotes: 'single',
        semi: true,
      }).rules,
      '@stylistic/type-generic-spacing': 'error',
      '@stylistic/type-named-tuple-spacing': 'error',

      // SonarJS rules
      ...sonarjsPlugin.configs.recommended.rules,

      // Unicorn rules
      ...unicornPlugin.configs.recommended.rules,
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
      'unicorn/no-null': 'off',
      'unicorn/prefer-module': 'error',
      'unicorn/prevent-abbreviations': 'off',

      // Import-X rules
      ...importXPlugin.configs.recommended.rules,
      ...importXPlugin.configs.typescript.rules, // Ensure this is compatible with flat config structure
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: true,
          optionalDependencies: false,
          packageDir: './', // Ensure this path is correct relative to where ESLint runs
          peerDependencies: false,
        },
      ],
      'import-x/no-nodejs-modules': 'error', // Overridden for 'tools' directory
      'import-x/no-unresolved': [
        'error',
        {
          amd: true,
          commonjs: true,
          ignore: ['^lua-types/.*', '^typed-factorio/.*'],
        },
      ],
      'import-x/order': [
        'warn',
        {
          'alphabetize': { caseInsensitive: true, order: 'asc' },
          'groups': [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          'newlines-between': 'always',
        },
      ],

      // Functional programming rules
      ...functionalPlugin.configs.recommended.rules,
      ...functionalPlugin.configs.externalTypeScriptRecommended.rules,
      ...functionalPlugin.configs.stylistic.rules,
      'functional/immutable-data': 'warn',
      'functional/no-classes': 'off',
      'functional/no-conditional-statements': 'off',
      'functional/no-expression-statements': 'off', // Overridden for 'tools'
      'functional/no-let': 'warn',
      'functional/no-loop-statements': 'warn',
      'functional/no-return-void': 'off', // Overridden for 'tools'
      'functional/no-this-expressions': 'warn',
      'functional/prefer-immutable-types': 'warn',
      'functional/prefer-tacit': 'warn',

      // no-secrets plugin rules (sensible defaults, can be customized)
      'no-secrets/no-secrets': 'error',

      // perfectionist plugin rules (example, customize as needed)
      // Using the recommended preset; you can fine-tune individual rules
      ...perfectionistPlugin.configs['recommended-natural'].rules,
      'perfectionist/sort-imports': 'off', // Disable perfectionist import sorting, let import-x handle it
      'perfectionist/sort-objects': [
        'warn',
        {
          order: 'asc',
          partitionByComment: true,
          partitionByNewLine: true,
          type: 'natural',
        },
      ],

      ...nPlugin.configs.recommended.rules,

      // TSDoc plugin rules
      'tsdoc/syntax': 'warn',

      // JSDoc plugin rules
      ...jsdocPlugin.configs['flat/recommended-typescript-flavor'].rules,
      'jsdoc/require-param-description': 'warn',
      'jsdoc/require-returns-description': 'warn',
      'jsdoc/tag-lines': ['warn', 'any', { startLines: 1 }],

      // Regexp plugin rules
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      ...regexpPlugin.configs['flat/recommended'].rules,

      // Security plugin rules
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      ...securityPlugin.configs.recommended.rules,

      '@typescript-eslint/no-deprecated': 'warn',

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      ...promisePlugin?.configs['flat/recommended'].rules,
    } as Partial<Record<string, Linter.RuleEntry>>,
  },

  // Configuration for src/control
  {
    files: ['src/control/**/*.ts'],
    languageOptions: {
      globals: { ...globals.es2025 },
      parserOptions: { project: './tsconfig.control.json' },
    },
  },

  // Configuration for src/data
  {
    files: ['src/data/**/*.ts'],
    languageOptions: {
      globals: { ...globals.es2025 },
      parserOptions: { project: './tsconfig.data.json' },
    },
  },

  // Configuration for src/settings
  {
    files: ['src/settings/**/*.ts'],
    languageOptions: {
      globals: { ...globals.es2025 },
      parserOptions: { project: './tsconfig.settings.json' },
    },
  },

  // Configuration for other src files (shared utilities, constants, etc.)
  // Needs to come after specific src/* parts if those are more specific,
  // or use ignores carefully if this is meant as a fallback.
  // Given the ignores, this is for src files NOT in control, data, or settings.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/control/**/*', 'src/data/**/*', 'src/settings/**/*'],
    languageOptions: {
      globals: { ...globals.es2025 }, // Removed optional chaining here
      parserOptions: { project: './tsconfig.json' }, // General tsconfig for other src files
    },
  },

  {
    // Factorio entry points.
    // Do not remove this block!
    files: [
      'src/control/control.ts',
      'src/data/data.ts',
      'src/data/data-updates.ts',
      'src/data/data-final-fixes.ts',
      'src/settings/settings.ts',
      'src/settings/settings-updates.ts',
      'src/settings/settings-final-fixes.ts',
    ],
    rules: {
      'unicorn/no-empty-file': 'off',
    },
  },

  // Configuration for tools directory
  {
    files: ['tools/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2025 },
      parserOptions: { project: './tools/tsconfig.json' },
    },
    plugins: {
      'security-node': securityNodePlugin as unknown as ESLint.Plugin,
    },
    rules: {
      'import-x/no-nodejs-modules': 'off',
      'n/no-extraneous-import': 'off', // Allow importing devDependencies
      'n/no-unpublished-import': 'off', // Allow importing devDependencies
      'no-console': 'off',

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      ...securityNodePlugin.configs.recommended.rules as Partial<Record<string, Linter.RuleEntry>>,
    },
  },

  // Configuration for eslint.config.ts
  {
    files: ['eslint.config.js', 'eslint.config.ts'],
    languageOptions: {
      // Ensure a tsconfig.json exists in the tools directory or adjust path
      globals: { ...globals.node, ...globals.es2025 },
      parserOptions: { project: './tsconfig.eslint.json' },
    },
    rules: {
      'import-x/no-nodejs-modules': 'off',
      'n/no-extraneous-import': 'off', // Allow importing devDependencies
      'n/no-unpublished-import': 'off', // Allow importing devDependencies
      'no-console': 'off',
    },
  },
);

export default rules;

// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
fs.writeFileSync('debug.eslint.config.json', JSON.stringify(rules, decycle(), 2));
