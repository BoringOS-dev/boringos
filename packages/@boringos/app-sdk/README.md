# @boringos/app-sdk

> Public SDK for building apps and connectors on the [BoringOS](https://boringos.dev) platform.

This package is the contract third-party developers build against. It exposes:

- **Manifest types** — `ConnectorManifest`, `AppManifest`, `PublisherInfo`, capability scopes
- **Builder helpers** — `defineApp`, `defineConnector`, `defineUI`
- **Slot type interfaces** — `NavSlot`, `DashboardWidget`, `EntityAction`, `CopilotTool`, `InboxHandler`, etc.
- **Lifecycle context** — `LifecycleContext`, `ContextBuildContext`, `ActionContext`
- **`useBrand()` hook** — tenant-aware branding for app UI

## Status

**`1.0.0-alpha.0`** — first publishable alpha. The contract may change before `1.0.0` based on what we learn migrating the first connectors (Phase 1 task D2) and porting CRM (Phase 2). Pin to `1.0.0-alpha.0` if you need stability against in-progress refinements.

See [`docs/phases/phase-1.md`](../../../docs/phases/phase-1.md) and [`docs/build/tasks-phase-1.json`](../../../docs/build/tasks-phase-1.json) for the build sequence.

## License

MIT — see [LICENSE](./LICENSE).
