import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Global ignores (replaces ignorePatterns)
  {
    ignores: ['dist/', 'node_modules/', 'cdk.out/', 'vite.config.ts'],
  },

  // Base configs
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,

  // Global rules
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Disable base rule in favor of the TS-aware version
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },

  // Ported longhaul code inside tenant-web — same relaxed rules until the
  // follow-up phase rewrites it to match tenant-web conventions.
  {
    files: ['apps/tenant-web/src/features/driver-planning/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off',
      'no-useless-assignment': 'off',
      'no-prototype-builtins': 'off',
    },
  },
)
