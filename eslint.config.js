// =============================================================================
// ESLint Configuration (Flat Config - ESLint 9+)
// =============================================================================
// The app was converted .js -> .ts (RTV-21..24). Until now this flat config
// registered no TypeScript parser and no `**/*.ts` block, so `eslint .` lint-ed
// only the JS tooling and SILENTLY SKIPPED all ~438 .ts source files. This wires
// typescript-eslint so the real app is linted, and enforces the clean-code.md
// deterministic floor (TypeScript row) at L0. See minicloud-gitops #2353.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Node.js + test globals shared by the JS tooling files.
const nodeGlobals = {
  console: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  module: 'readonly',
  require: 'readonly',
  exports: 'readonly',
  global: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  clearImmediate: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  fetch: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  Headers: 'readonly',
  FormData: 'readonly',
  Blob: 'readonly',
  describe: 'readonly',
  it: 'readonly',
  expect: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  vi: 'readonly',
  test: 'readonly',
};

export default tseslint.config(
  { ignores: ['node_modules/**', 'coverage/**', 'dist/**', 'build/**', '*.min.js'] },

  // ---------------------------------------------------------------------------
  // JavaScript tooling (scripts, *.config.js, instrument.js) — unchanged baseline
  // ---------------------------------------------------------------------------
  {
    files: ['**/*.js'],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: nodeGlobals },
    rules: {
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': 'error',
      'no-debugger': 'error',
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-return-await': 'warn',
      'prefer-const': 'warn',
      'no-var': 'error',
      semi: 'off',
      quotes: 'off',
      'no-case-declarations': 'warn',
      'no-new-wrappers': 'error',
      'no-empty': 'warn',
      'no-control-regex': 'off',
      'no-useless-escape': 'warn',
    },
  },

  // ---------------------------------------------------------------------------
  // TypeScript source (the real app) — the clean-code.md floor, type-aware.
  // ---------------------------------------------------------------------------
  {
    files: ['**/*.ts'],
    // Mirror tsconfig.json `exclude`: these dirs are outside the TS program, so the
    // type-aware parser (projectService) can't resolve them. They're also exempt from
    // the floor (tests/tooling) and were never linted before — keep it that way.
    ignores: ['tests/**', 'website/**', 'data/**'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // Measurable clean-code floor (house defaults — clean-code.md TypeScript row).
      complexity: ['error', 10],
      'max-params': ['error', 4],
      'max-depth': ['error', 4],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      // Error handling: an unhandled promise is a real bug class in async code.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        // allowSingleOrDouble: the `_req`/`_unused` single-underscore convention
        // AND the ESM `__dirname`/`__filename` shim + `__testables`/`__setFetchForTest`
        // test-seam double-underscore idioms are all deliberate, not style drift.
        { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allowSingleOrDouble' },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allowSingleOrDouble',
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'],
          leadingUnderscore: 'allowSingleOrDouble',
        },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'property', format: null }, // snake_case DB/API/wire fields are legitimate
        { selector: 'import', format: null },
      ],
      'no-console': 'error',
      // `== null` / `!= null` is the standard, intentional null-or-undefined check;
      // enforce `===` everywhere else.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // ---------------------------------------------------------------------------
  // Tooling dirs — console is the intended output; the floor is for app logic,
  // not one-shot scripts/seeds/tests (testing.md excludes scripts from the floor).
  // ---------------------------------------------------------------------------
  {
    files: [
      '**/instrument.js',
      '**/scripts/**',
      '**/seeds/**',
      '**/tests/**',
      '**/*.config.{js,ts,mjs}',
    ],
    rules: {
      'no-console': 'off',
      complexity: 'off',
      'max-lines-per-function': 'off',
      'max-params': 'off',
      'max-depth': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/naming-convention': 'off',
    },
  }
);
