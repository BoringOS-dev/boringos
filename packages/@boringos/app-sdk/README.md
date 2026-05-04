# @boringos/app-sdk

> Public SDK for building apps and connectors on the [BoringOS](https://boringos.dev) platform.

This package is the contract third-party developers build against. It exposes:

- **Manifest types** — `ConnectorManifest`, `AppManifest`, `PublisherInfo`, capability scopes
- **Builder helpers** — `defineApp`, `defineConnector`, `defineUI`
- **Slot type interfaces** — `NavSlot`, `DashboardWidget`, `EntityAction`, `CopilotTool`, `InboxHandler`, etc.
- **Lifecycle context** — `LifecycleContext`, `ContextBuildContext`, `ActionContext`
- **`useBrand()` hook** — tenant-aware branding for app UI

## Status

**Pre-alpha skeleton.** This package was scaffolded by TASK-B1 of Phase 1 and currently exports a placeholder only. Functional types and helpers land in B2–B4. The first publishable alpha (`1.0.0-alpha.0`) ships in B5.

See [`docs/phases/phase-1.md`](../../../docs/phases/phase-1.md) and [`docs/build/tasks-phase-1.json`](../../../docs/build/tasks-phase-1.json) for the build sequence.

## License

MIT — see [LICENSE](./LICENSE).
