# Contributing to BoringOS

We welcome contributions! Here's how to get started.

## CLA Requirement

All contributors must sign our [Contributor License Agreement](CLA.md) before their first PR can be merged. This is a one-time process handled automatically:

1. Open a pull request
2. The CLA bot will comment if you haven't signed yet
3. Reply with: **I have read the CLA Document and I hereby sign the CLA**
4. All future contributions are covered — no need to sign again

The CLA ensures we can maintain and evolve BoringOS (including potential relicensing) while protecting both the project and contributors.

## Getting Started

```bash
git clone https://github.com/BoringOS-dev/boringos.git
cd boringos
pnpm install
pnpm -r build
pnpm test:run
```

## Development Workflow

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `pnpm -r typecheck` and `pnpm test:run` to verify
4. Submit a pull request

## What We're Looking For

- Bug fixes with tests
- New connector implementations (see `@boringos/connector-slack` as reference)
- New runtime adapters
- Documentation improvements
- Performance improvements with benchmarks

## Code Style

- TypeScript strict mode
- ES2022 target, NodeNext modules
- No external formatters — just follow existing patterns
- Tests in `tests/` using Vitest

## Questions?

Open an issue or start a discussion on GitHub.
