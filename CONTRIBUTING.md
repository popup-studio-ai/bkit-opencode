# Contributing to bkit-opencode

Thank you for your interest in contributing to bkit-opencode!

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## How to Contribute

### Reporting Issues

1. Check if the issue already exists
2. Create a new issue with a clear description
3. Include OpenCode version, bkit-opencode version, and error logs
4. Provide reproduction steps if reporting a bug

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Branch Naming

- `feature/*` - New features
- `fix/*` - Bug fixes
- `docs/*` - Documentation changes
- `refactor/*` - Code refactoring

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `refactor:` - Code refactoring
- `test:` - Tests
- `chore:` - Maintenance

## Development Setup

```bash
# Clone repository
git clone https://github.com/popup-studio-ai/bkit-opencode.git
cd bkit-opencode

# Install dependencies
bun install

# Link for local testing
# Option 1: Add as file plugin in your project's opencode.json:
```

```jsonc
{
  "plugin": ["file:///path/to/bkit-opencode/src/index.ts"]
}
```

```bash
# Option 2: Symlink into .opencode/plugins/
ln -s /path/to/bkit-opencode ~/.opencode/plugins/bkit-opencode
```

## Testing

### Automated Tests

```bash
bun run test       # vitest — unit tests (40 tests)
bun run typecheck  # tsc --noEmit — type checking
```

### Manual Integration Testing

Automated tests cover core logic, but hook and agent behavior requires running OpenCode with the plugin loaded:

- Verify agent triggering and PDCA workflow
- Test with all three project levels (Starter/Dynamic/Enterprise)
- Check Agent Teams functionality

## Review Process

- All PRs require review from at least one maintainer
- Only `admin` team members can merge to `main`
- PRs must pass all CI checks

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.

## Questions?

Feel free to open a discussion or contact us at contact@popupstudio.ai
