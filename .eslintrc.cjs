module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, browser: true, es2022: true },
  ignorePatterns: ['dist/', 'node_modules/'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-console': 'off',
  },
  overrides: [
    {
      // Principle 2: the rules engine is pure. No I/O, no network, no framework
      // imports, no reaching into server or client code.
      files: ['src/engine/**/*.ts'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [
            { group: ['../server/*', '../client/*', '../shared/*', '**/server/**', '**/client/**'],
              message: 'The rules engine must not import from server, client, or shared code (CLAUDE.md principle 2).' },
            { group: ['express', 'socket.io', 'socket.io-client', 'react', 'react-dom', 'fs', 'node:*', 'crypto'],
              message: 'The rules engine must be dependency-free and side-effect free (CLAUDE.md principle 2).' },
          ],
        }],
      },
    },
  ],
};
