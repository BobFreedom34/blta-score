// ESLint: catches the mistakes that slip in when a long file is edited (a lost backslash in a regular expression, an unused or undefined name,
// an unreachable line). Run: npm run lint
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'data/**', 'docs/**', 'mockups/**', 'assets/**', 'public/vendor/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-control-regex': 'off',
      // deliberate: zero-width and emoji characters in the text checks
      'no-misleading-character-class': 'off',
      'no-irregular-whitespace': 'off',
      'no-regex-spaces': 'warn',
    },
  },
  {
    // the pages' scripts are plain <script> files sharing one global scope
    files: ['public/js/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, io: 'readonly' } },
    rules: { 'no-unused-vars': 'off', 'no-redeclare': 'off', 'no-undef': 'off' },
  },
  { files: ['public/sw.js'], languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } } },
];
