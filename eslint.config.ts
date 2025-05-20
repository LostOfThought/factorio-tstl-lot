import globals from "globals";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import functionalPlugin from "eslint-plugin-functional";
import importXPlugin from "eslint-plugin-import-x";
import sonarjsPlugin from "eslint-plugin-sonarjs";
import unicornPlugin from "eslint-plugin-unicorn";
// Removed: import eslint from "eslint";

// Use tseslint.config() to build and export the configuration array
export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "node_modules/",
      "dist/",
      "dist-tools/",
      "releases/",
      "**/*.lua",
      "pnpm-lock.yaml",
      "LICENSE.md",
      ".github/",
      "*.md",
    ],
  },

  // TypeScript-ESLint base configs
  // tseslint.configs.base provides parser, parserOptions for sourceType: "module"
  tseslint.configs.base,
  // Spread array-based configurations
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Combined configuration for other plugins for all TypeScript files
  {
    files: ["**/*.ts"],
    plugins: {
      "@stylistic": stylistic,
      "functional": functionalPlugin, // Assumes tseslint.config handles potential type mismatches
      "import-x": importXPlugin,   // or plugins are compliant with ESLint v9 Plugin type
      "sonarjs": sonarjsPlugin,
      "unicorn": unicornPlugin,
    },
    languageOptions: {
      // parser is typically set by tseslint.configs.base
      // parserOptions can be extended here if needed, base already sets sourceType
      parserOptions: {
        ecmaVersion: "latest", // Keep if more specific than base
        // project will be set in specific configs for type-aware linting
      },
      globals: {
        // Define any global variables used by Factorio/TSTL if necessary
      },
    },
    rules: {
      // Base ESLint rules
      "eqeqeq": ["error", "always", { null: "ignore" }],
      "no-eval": "error",
      "no-var": "error",
      "prefer-const": "error",
      "no-console": "warn",

      // TypeScript-ESLint rule overrides
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/prefer-readonly": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-namespace": [
        "error",
        { allowDeclarations: true },
      ],
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: true,
          allowNullableBoolean: false,
          allowNullableString: false,
          allowNullableNumber: false,
          allowAny: false,
        },
      ],

      // Stylistic rules
      ...stylistic.configs.customize({
        indent: 2,
        quotes: "backtick",
        semi: true,
      }).rules,
      "@stylistic/type-generic-spacing": "error",
      "@stylistic/type-named-tuple-spacing": "error",

      // SonarJS rules
      ...sonarjsPlugin.configs.recommended.rules,

      // Unicorn rules
      ...unicornPlugin.configs.recommended.rules,
      "unicorn/prevent-abbreviations": "off",
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
      "unicorn/no-null": "off",
      "unicorn/prefer-module": "error",

      // Import-X rules
      ...importXPlugin.configs.recommended.rules,
      ...importXPlugin.configs.typescript.rules, // Ensure this is compatible with flat config structure
      "import-x/no-unresolved": [
        "error",
        {
          commonjs: true,
          amd: true,
          ignore: ["^lua-types/.*", "^typed-factorio/.*"],
        },
      ],
      "import-x/no-extraneous-dependencies": [
        "error",
        {
          devDependencies: true,
          optionalDependencies: false,
          peerDependencies: false,
          packageDir: "./", // Ensure this path is correct relative to where ESLint runs
        },
      ],
      "import-x/no-nodejs-modules": "error", // Overridden for 'tools' directory
      "import-x/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
            "object",
            "type",
          ],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],

      // Functional programming rules
      ...functionalPlugin.configs.recommended.rules,
      ...functionalPlugin.configs.externalTypeScriptRecommended.rules,
      ...functionalPlugin.configs.stylistic.rules,
      "functional/no-let": "warn",
      "functional/immutable-data": "warn",
      "functional/no-expression-statements": "off", // Overridden for 'tools'
      "functional/no-return-void": "off", // Overridden for 'tools'
      "functional/no-conditional-statements": "off",
      "functional/no-loop-statements": "warn",
      "functional/no-classes": "off",
      "functional/no-this-expressions": "warn",
      "functional/prefer-immutable-types": "warn",
      "functional/prefer-tacit": "warn",
    },
  },

  // Configuration for src/control
  {
    files: ["src/control/**/*.ts"],
    languageOptions: {
      parserOptions: { project: "./tsconfig.control.json" },
      globals: { ...globals.browser },
    },
    rules: {
      // "no-console": "off",
    },
  },

  // Configuration for src/data
  {
    files: ["src/data/**/*.ts"],
    languageOptions: {
      parserOptions: { project: "./tsconfig.data.json" },
      globals: { ...globals.browser },
    },
  },

  // Configuration for src/settings
  {
    files: ["src/settings/**/*.ts"],
    languageOptions: {
      parserOptions: { project: "./tsconfig.settings.json" },
      globals: { ...globals.browser },
    },
  },

  // Configuration for other src files (shared utilities, constants, etc.)
  // Needs to come after specific src/* parts if those are more specific,
  // or use ignores carefully if this is meant as a fallback.
  // Given the ignores, this is for src files NOT in control, data, or settings.
  {
    files: ["src/**/*.ts"],
    ignores: ["src/control/**/*", "src/data/**/*", "src/settings/**/*"],
    languageOptions: {
      parserOptions: { project: "./tsconfig.json" }, // General tsconfig for other src files
      globals: { ...globals.browser },
    },
  },

  // Configuration for tools directory
  {
    files: ["tools/**/*.ts"],
    languageOptions: {
      // Ensure a tsconfig.json exists in the tools directory or adjust path
      parserOptions: { project: "./tools/tsconfig.json" },
      globals: { ...globals.node, ...globals.es2021 },
    },
    rules: {
      "import-x/no-nodejs-modules": "off",
      "no-console": "off",
      "functional/no-expression-statements": "off",
      "functional/no-return-void": "off",
      "functional/immutable-data": "off",
      "unicorn/prefer-module": "off", // Tools are often CJS or run directly by vite-node
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      // unicorn/no-null is already off globally, so no need to repeat if that's intended.
    },
  },

  // Configuration for eslint.config.ts
  {
    files: ["eslint.config.ts"],
    languageOptions: {
      // Ensure a tsconfig.json exists in the tools directory or adjust path
      parserOptions: { project: "./tsconfig.eslint.json" },
      globals: { ...globals.node, ...globals.es2021 },
    },
    rules: {
      "import-x/no-nodejs-modules": "off",
      "no-console": "off",
      "functional/no-expression-statements": "off",
      "functional/no-return-void": "off",
      "functional/immutable-data": "off",
      "unicorn/prefer-module": "off", // Tools are often CJS or run directly by vite-node
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      // unicorn/no-null is already off globally, so no need to repeat if that's intended.
    },
  }
);

// Removed debugging console.log and decycle import
