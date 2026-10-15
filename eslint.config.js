// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  // 1. Global ignores
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src-tauri/**',
      'public/**',
      'coverage/**',
      // Checkout-local diagnostics and TMP caches are generated, gitignored artifacts.
      'output/**',
      'docs/**',
      '**/*.d.ts',
      'src/types/generated/**',
      'promo*.html',
      'index.html',
      'eslint.config.js',
      // Local untracked tool directory (same name in gitignore) — not a repository deliverable
      '.workbuddy/**',
    ],
  },

  // 2. Base JS recommended rules
  js.configs.recommended,

  // 3. TypeScript strict tier: type-checked (type-related bugs) + stylistic (consistent style)
  ...[
    ...tseslint.configs.recommendedTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
  ].map(config => ({ ...config, files: ['**/*.{ts,tsx}'] })),

  // 4. Enable projectService for every TS/TSX file so each picks the right tsconfig
  //    (src/* → tsconfig.json, vite.config.ts → tsconfig.node.json)
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // 5. Source: browser + React ecosystem
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2024,
      },
    },
    settings: {
      react: { version: '19.0' },
    },
    rules: {
      // React ecosystem
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'error',
        {
          allowConstantExport: true,
          // These exports are pure utilities, type contexts, or R3F config needed by
          // same-module components; listing them explicitly keeps the remaining Fast
          // Refresh constraints in force.
          allowExportNames: [
            'BITRATE_PRESETS', 'BLOCK_TYPE_CONFIG', 'CHECKSUM_COVER_OPTIONS',
            'CHECKSUM_OPTIONS', 'CHECKSUM_POSITION_OPTIONS', 'CanvasErrorTooltip',
            'CompileDot', 'CustomWidget', 'FIELD_TYPE_OPTIONS', 'FRAME_DECODER_ADDABLE_TYPES',
            'FRAME_EXAMPLES', 'GROUP_SIZE', 'HISTORY_KEY', 'HISTORY_MAX', 'HeaderBytes',
            'IdLoadDistribution', 'MeasureItem', 'NumericPortStatus', 'PillRect', 'ROW_HEIGHT',
            'SlidingPill', 'THRESHOLD_PRESETS', 'WINDOW_PRESETS', 'WidgetCard',
            'WidgetEmbeddedContext', 'blockSummary', 'buildLissajousParticles',
            'buildLissajousPath', 'byteToAscii', 'byteToHex',
            'compileErrorMessage', 'directionColorClass', 'directionSymbol',
            'escapeControlChar', 'evalCustomWidgetDef',
            'formatBitrate', 'formatFps', 'formatFreq', 'formatNumericValue', 'formatPercent',
            'formatTime', 'getCompileStatus', 'getOutputPortNames', 'hexColorClass',
            'isInvisibleChar', 'isPrintable', 'isWindowsPlatform', 'loadColor', 'loadHistory',
            'numericValueOr', 'parseDraftNumber', 'saveHistory', 'segmentEscapedText',
            'useCanvasNodeError', 'usePanelFollowing', 'usePanelFrozen', 'usePanelGoLive',
            'usePanelKey', 'useSlidingPill',
          ],
        },
      ],

      // Strict TS style
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // General JS safety
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // 6. Tests: relax any / non-null assertions / console
  {
    files: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'src/test/**/*.{ts,tsx}',
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },

  // 7. Root config files: vite/vitest etc. run in the Node environment
  {
    files: ['*.config.{js,ts,mjs,cjs}', 'scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // 8. Strict rules: every diagnostic blocks lint.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/no-empty-function': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-implied-eval': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-for-of': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/unbound-method': 'error',
      'no-fallthrough': 'error',
      'no-useless-assignment': 'error',
      'preserve-caught-error': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/click-events-have-key-events': 'error',
      'jsx-a11y/label-has-associated-control': 'error',
      'jsx-a11y/no-autofocus': 'error',
      'jsx-a11y/no-noninteractive-element-interactions': 'error',
      'jsx-a11y/no-noninteractive-tabindex': 'error',
      'jsx-a11y/no-static-element-interactions': 'error',
      'no-console': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // React Three Fiber maps Three.js objects through JSX props; these are not DOM attributes.
      'react/no-unknown-property': [
        'error',
        {
          ignore: [
            'args',
            'emissive',
            'emissiveIntensity',
            'intensity',
            'object',
            'position',
            'rotation',
            'transparent',
          ],
        },
      ],
    },
  },
  // 9. Loading/lazy-loading discipline — above-the-fold modules must come from the entry
  //    or the manifest; lazy loading may only be declared under `src/components/lazy/` (the
  //    repo's only React.lazy manifest) and the panel view table (dock dispatch).
  //    See the header of `src/components/lazy/lazyComponents.ts` and `docs/architecture/web-exit.md`.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/components/lazy/**',
      'src/components/panels/registry/panelViewComponents.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='lazy']",
          message:
            'React.lazy may only be declared in src/components/lazy/lazyComponents.ts (the repo-wide lazy-loading manifest).',
        },
      ],
    },
  },
);
