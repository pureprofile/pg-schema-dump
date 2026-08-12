import { defineConfig } from 'oxlint';
import core from 'ultracite/oxlint/core';

export default defineConfig({
  extends: [core],
  options: { typeAware: true },
  rules: {
    // canonical config, do not re-enable these rules
    'default-param-last': 'off',
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'eslint/complexity': 'off',
    'func-style': ['error', 'declaration', { allowArrowFunctions: true }],
    'import/no-named-as-default': 'off',
    'import/no-named-as-default-member': 'off',
    'no-eq-null': 'off',
    'no-inline-comments': 'off',
    'no-warning-comments': 'off',
    'promise/avoid-new': 'off',
    'promise/prefer-await-to-callbacks': 'off',
    'promise/prefer-await-to-then': 'off',
    'react/no-did-update-set-state': 'off',
    'sort-keys': 'off',
    'typescript/no-non-null-assertion': 'off',
    'unicorn/prefer-native-coercion-functions': 'off',
    'typescript/strict-boolean-expressions': 'off',
    'typescript/no-confusing-void-expression': 'off',
    'typescript/restrict-template-expressions': 'off',
    'typescript/prefer-nullish-coalescing': 'off',
    'typescript/no-unsafe-type-assertion': 'off',
    'typescript/no-unsafe-assignment': 'off',

    'eslint/require-unicode-regexp': 'off',

    // Deliberately off, not deferred: the autofix rewrites `.sort()` to `.toSorted()`,
    // which is ES2023 / Node 20+. This is a published package with no engines floor, so
    // older-Node consumers would crash at runtime. The two src call sites already sort a
    // fresh spread copy, so the mutation concern the rule guards against does not apply.
    'unicorn/no-array-sort': 'off',

    // ── Rules deferred on adoption of ultracite 7.9.4 ──

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 8
    // complexity: dangerous
    // 8 `node:path` namespace imports (CLI entrypoint, table writer, several test suites) flagged for
    // default-import style — CJS deps under node16 moduleResolution constrain which import styles type-check
    // type: best-practice
    // consistent import style aids readability but must not fight the module's actual export shape
    'unicorn/import-style': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 5
    // complexity: dangerous
    // 5 unbound-method violations in the pg-client connection lifecycle helpers — method references without
    // binding lose `this` context at runtime
    // type: bug-prevention
    // passing an unbound method as a callback causes `this` to be undefined at call time
    'typescript/unbound-method': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 5
    // complexity: dangerous
    // 5 awaits inside loops (pg-client collectors, one e2e test) — sequential awaiting is often intentional
    // here (ordering, per-database restore sequencing)
    // type: best-practice
    // parallelising with Promise.all is only correct when iterations are independent; each site needs review
    'eslint/no-await-in-loop': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 3
    // complexity: safe
    // 3 `.concat()`/`.apply()` sites in fs-schema.ts and pg-client.ts replaceable with spread syntax
    // type: modern-syntax
    // spread is more readable and idiomatic than `.concat()` or `.apply()` for these patterns
    'unicorn/prefer-spread': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 3
    // complexity: dangerous
    // 3 interface method declarations in scope.ts to normalise to property style — no autofix; converting
    // shorthand to property style tightens parameter checking from bivariant to contravariant and can
    // surface new type errors
    // type: best-practice
    // property-style signatures get strict function variance checking; shorthand is bivariant (looser)
    'typescript/method-signature-style': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 2
    // complexity: dangerous
    // 2 consistent-function-scoping occurrences in pg-client.ts — moving inner functions out may change
    // closure access
    // type: best-practice
    // functions that don't use closure variables are cleaner as module-level declarations
    'unicorn/consistent-function-scoping': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 2
    // complexity: dangerous
    // 2 prefer-destructuring sites in bin.ts/pg-client.ts — some are member accesses guarding a later
    // reassignment; manual review needed
    // type: best-practice
    // destructuring is more idiomatic but behaviorally equivalent when applied correctly
    'eslint/prefer-destructuring': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 2
    // complexity: safe
    // 2 plain assignments in pg-client.ts replaceable with a logical assignment operator (e.g. `||=`)
    // type: best-practice
    // logical assignment operators are more concise and make the short-circuit intent explicit
    'eslint/logical-assignment-operators': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 1
    // complexity: safe
    // 1 simple if/else in pg-client.ts rewritable as a ternary expression
    // type: cosmetic
    // purely stylistic; ternary is more concise but has identical runtime behaviour
    'unicorn/prefer-ternary': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 1
    // complexity: safe
    // 1 `.substring()` call in fs-schema-helpers.ts replaceable with `.slice()`
    // type: modern-syntax
    // `slice` is the modern API; `substring` has confusing negative-index/argument-swap semantics
    'unicorn/prefer-string-slice': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 1
    // complexity: dangerous
    // 1 catch callback variable in bin.ts typed loosely rather than `unknown`
    // type: bug-prevention
    // typing caught errors as anything but `unknown` hides downstream property access errors
    'typescript/use-unknown-in-catch-callback-variable': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 1
    // complexity: safe
    // 1 constructor parameter property in fs-schema.ts flagged for an explicit class property instead
    // type: cosmetic
    // parameter properties compile to an equivalent class property; the choice is purely stylistic
    'typescript/parameter-properties': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 1
    // complexity: dangerous
    // 1 type parameter in pg-client.ts used only once in its function signature — requires intent verification
    // type: best-practice
    // unnecessary type parameters add cognitive overhead without adding type safety
    'typescript/no-unnecessary-type-parameters': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 1
    // complexity: safe
    // 1 dynamic-key `delete` in pg-client.ts — computed-key delete should use Map.delete() instead
    // type: best-practice
    // `delete obj[key]` with dynamic keys is error-prone; Map is the right data structure
    'typescript/no-dynamic-delete': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 1
    // complexity: safe
    // 1 import in sequences.ts not at the top of the file — autofix moves it up
    // type: best-practice
    // imports at top of file improve readability and match module resolution expectations
    'import/first': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 1
    // complexity: safe
    // 1 unnamed regex capture group in indexes.ts
    // type: best-practice
    // named capture groups document intent and make match-result access self-describing
    'eslint/prefer-named-capture-group': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 1
    // complexity: dangerous
    // 1 use-before-define occurrence in scope-file.ts (`validateScope` referenced before its declaration)
    // type: bug-prevention
    // referencing a variable before its declaration can cause undefined/TDZ errors at runtime
    'eslint/no-use-before-define': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 1
    // complexity: safe
    // 1 non-Error value thrown in pg-client.ts
    // type: bug-prevention
    // throwing non-Error values loses the stack trace; `new Error()` is idiomatic
    'eslint/no-throw-literal': 'off',

    // TODO: evaluate this rule in the future
    // occurrences in codebase: 1
    // complexity: dangerous
    // 1 class method in fs-schema.ts flagged as not using `this` — must verify it can stand alone
    // type: best-practice
    // methods that rely on `this` must remain methods; moving them breaks their binding
    'eslint/class-methods-use-this': 'off',

    // ── End of deferred block ──
  },
  overrides: [
    {
      // Findings confined to the test suites — kept out of the main rules block so
      // production source stays under the stricter set.
      files: ['**/*.{test,spec}.*', 'tests/**'],
      rules: {
        // TODO: evaluate this rule in the future
        // occurrences in codebase: 331
        // complexity: dangerous
        // every call on an `error`-typed value (mostly `expect(err).toThrow(...)` style assertions) requires
        // upstream typing fixes
        // type: bug-prevention
        // calling untyped functions hides missing-arg and wrong-return-type errors at runtime
        'typescript/no-unsafe-call': 'off',

        // TODO: evaluate this rule in the future
        // occurrences in codebase: 204
        // complexity: dangerous
        // every member access on an `error`-typed value (e.g. `.toContain`, `.toBe`, `.toEqual` matcher
        // chains) triggers this — requires upstream typing fixes
        // type: bug-prevention
        // catches real runtime errors caused by accessing properties on unknown/any-typed values
        'typescript/no-unsafe-member-access': 'off',

        // TODO: evaluate this rule in the future
        // occurrences in codebase: 6
        // complexity: dangerous
        // 6 arguments of an `error`-typed value passed into typed parameters — requires upstream typing fixes
        // type: bug-prevention
        // passing untyped arguments hides wrong-type bugs that only surface at runtime
        'typescript/no-unsafe-argument': 'off',

        // TODO: evaluate this rule in the future
        // occurrences in codebase: 5
        // complexity: dangerous
        // 5 `any` usages in test helper mocks — requires proper mock typing per site
        // type: best-practice
        // removes escape hatches that suppress type checking across the test suite
        'typescript/no-explicit-any': 'off',

        // TODO: evaluate this rule in the future
        // occurrences in codebase: 1
        // complexity: safe
        // 1 `dir` declaration in restore-failures.test.ts shadowing the suite-level `dir`
        // type: best-practice
        // non-shadowed naming improves readability; renaming the inner variable is a trivial follow-up
        'eslint/no-shadow': 'off',

        // TODO: evaluate this rule in the future
        // occurrences in codebase: 1
        // complexity: dangerous
        // 1 `__dirname` use in dump-db.test.ts — replacing it needs an `import.meta.url`-based path helper,
        // which conflicts with this package's CommonJS build output
        // type: modern-syntax
        // explicit ES module path resolution is unambiguous but requires the package to actually be ESM
        'unicorn/prefer-module': 'off',

        // TODO: evaluate this rule in the future
        // occurrences in codebase: 1
        // complexity: safe
        // 1 async test helper in dump-db.test.ts with no `await` expression — autofix removes the redundant
        // `async` keyword
        // type: best-practice
        // async without await adds microtask overhead and misleads readers about async intent
        'eslint/require-await': 'off',

        // TODO: evaluate this rule in the future
        // occurrences in codebase: 1
        // complexity: dangerous
        // 1 caught-but-unused `error` parameter in restore-failures.test.ts — requires verification before
        // removal or use
        // type: bug-prevention
        // unused variables indicate dead code or missing logic that should be wired up
        'eslint/no-unused-vars': 'off',
      },
    },
  ],
});
