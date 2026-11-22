# `@bslt/contract`

Zero-framework, strictly isomorphic contract vocabulary (`lib: ["ES2023"]`, `types: []`) depending only on `@bslt/schema`:

- `endpoint` (`HttpMethod`, `Auth`, `Requirement`, `InputOf`, `OutputOf`, `evaluateAuth`, `evaluateRequirement`)
- `event` (`EventDef`, `NotifyMeta`) and `job` (`JobDef`)
- `defineModule`, `defineConfig`, `validateModule`, and `validateModules`
- `defineErrors` and `lookupErrorCode` (`<moduleId>.<CODE>` HTTP status & `ErrorKind` registry)
- `emptyBodySchema` and `errorResponseSchema`
- `ASSET_EXPONENTS`, `assetCodeSchema`, `moneySchema`, and `Money`
- `composeRouter` and `moduleEndpointsToContract`
