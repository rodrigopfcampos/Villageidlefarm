// ESLint "flat config" (ESLint 9). Simples de propósito: recomendados do JS e do TypeScript.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'apps/game/public/assets/**',
      'packages/shared/src/generated/**',
      'tools/assets/**',
      'assets-src/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // O cliente nunca decide valor com Date.now(); use o relógio injetado ou serverNow.
      'no-restricted-properties': [
        'warn',
        { object: 'Date', property: 'now', message: 'Use o relógio injetado / serverNow.' },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/vite.config.ts', 'eslint.config.js'],
    rules: { 'no-restricted-properties': 'off' },
  },
  prettier,
);
