# `@bslt/schema`

Zero-dependency, isomorphic TypeScript schema validation and introspection kernel package.

Compiled strictly without Node or DOM ambient types (`lib: ["ES2023"]`, `types: []`). Provides:

- Structural combinators (`string`, `number`, `boolean`, `literal`, `enumOf`, `object`, `optional`, `nullable`, `array`, `record`, `union`, `discriminated`, `brand`, `refine`, `bigintString`, `sealed`)
- Type inference (`Infer<S>` / `InferSchema<S>`)
- Canonical AST introspection (`describe(schema)`)
- Standard Schema v1 (`~standard` interface)
