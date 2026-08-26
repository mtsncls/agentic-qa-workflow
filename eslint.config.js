// eslint.config.js
import tseslint from 'typescript-eslint';
import playwright from 'eslint-plugin-playwright';

export default [
  ...tseslint.configs.recommended,
  ...playwright.configs['flat/recommended'],
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      // Add project-specific rules here
    },
  },
];
