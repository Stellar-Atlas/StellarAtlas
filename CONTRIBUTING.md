# Contributing to StellarAtlas

Thank you for your interest in contributing to StellarAtlas! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Pull Request Process](#pull-request-process)
- [Community](#community)

## Code of Conduct

This project adheres to a Code of Conduct that all contributors are expected to follow. Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before contributing.

## Getting Started

### Prerequisites

- **Node.js 22.x** (required)
- **pnpm 10.12.1** (required)
- **PostgreSQL** (for development and testing)
- **Git**
- **Docker** (optional, for devcontainer)

### Quick Start

1. **Fork the repository** on GitHub
2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/StellarAtlas.git
   cd StellarAtlas
   ```

3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/Stellar-Atlas/StellarAtlas.git
   ```

4. **Follow the setup guide**: See [DEVELOPER_SETUP.md](DEVELOPER_SETUP.md)

## Development Setup

### Environment Setup

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Set up environment files**:
   ```bash
   cp apps/backend/.env.dist apps/backend/.env
   cp apps/frontend/.env.dist apps/frontend/.env
   cp apps/history-scanner/.env.dist apps/history-scanner/.env
   cp apps/users/.env.dist apps/users/.env
   cp packages/crawler/.env.dist packages/crawler/.env
   cp packages/node-connector/.env.dist packages/node-connector/.env
   ```

3. **Configure PostgreSQL** (see [DEVELOPER_SETUP.md](DEVELOPER_SETUP.md))

4. **Build the project**:
   ```bash
   pnpm build:ts
   ```

5. **Run tests** to ensure everything works:
   ```bash
   pnpm test:unit
   ```

### Using Devcontainer (Recommended)

If you have Docker and VS Code with the Dev Containers extension:

1. Open the project in VS Code
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
3. Select `Dev Containers: Reopen in Container`
4. Wait for the container to build
5. Follow the setup steps above inside the container

## How to Contribute

### Reporting Bugs

Before creating a bug report:

1. **Search existing issues** to avoid duplicates
2. **Check if the issue has been fixed** in recent commits

When creating a bug report, include:

- **Clear title** describing the issue
- **Steps to reproduce** the bug
- **Expected behavior**
- **Actual behavior**
- **Environment details** (OS, Node.js version, etc.)
- **Screenshots** if applicable
- **Logs or error messages**

Use the bug report template when available.

### Suggesting Features

Feature requests are welcome! Please:

1. **Search existing issues** for similar suggestions
2. **Describe the use case** and problem you're solving
3. **Explain why** this feature would benefit others
4. **Provide examples** of how it might work

Use the feature request template when available.

### Contributing Code

#### Finding Work

- Check the [issue tracker](https://github.com/Stellar-Atlas/StellarAtlas/issues)
- Look for issues labeled `good first issue` or `help wanted`
- Comment on an issue to indicate you're working on it
- Ask questions if anything is unclear

#### Making Changes

1. **Create a branch** from `main`:
   ```bash
   git checkout main
   git pull upstream main
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes**:
   - Follow the coding standards (see below)
   - Write tests for new functionality
   - Update documentation as needed

3. **Test your changes**:
   ```bash
   pnpm lint
   pnpm build:ts
   pnpm test:unit
   pnpm test:integration  # if you changed backend code
   ```

4. **Commit your changes** (see commit guidelines below)

5. **Push to your fork**:
   ```bash
   git push origin feat/your-feature-name
   ```

6. **Create a Pull Request** (see PR process below)

## Coding Standards

### TypeScript/JavaScript

- **Use TypeScript** for all new code
- **Follow existing code style**
- **Run ESLint**: `pnpm lint`
- **Run Prettier**: Formatting is handled by ESLint config
- **Use strict type checking**: No `any` types unless absolutely necessary
- **Prefer functional programming**: Pure functions, immutability where possible
- **Handle errors explicitly**: Use neverthrow's Result type

### Project Structure

- **Domain-driven design**: Keep business logic in domain folders
- **Clean architecture**: Separate domain, use cases, and infrastructure
- **Dependency injection**: Use inversify for dependency management
- **SOLID principles**: Follow single responsibility, open/closed, etc.

### Naming Conventions

- **Files**: kebab-case for file names (`user-service.ts`)
- **Classes**: PascalCase (`UserService`)
- **Functions/Variables**: camelCase (`getUserById`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_RETRY_ATTEMPTS`)
- **Interfaces**: PascalCase, no "I" prefix (`User`, not `IUser`)
- **Test files**: Same name as file being tested with `.test.ts` suffix

### Comments

- **Write self-documenting code** - good naming over comments
- **Use JSDoc** for public APIs and complex functions
- **Explain "why" not "what"** - code shows what, comments explain why
- **Update comments** when code changes

### Vue.js Conventions

- **Component names**: PascalCase, multi-word (`UserProfile.vue`)
- **Props**: camelCase in JavaScript, kebab-case in templates
- **Events**: kebab-case (`user-updated`)
- **Composition API preferred** for new components (Vue 3)

## Testing Guidelines

### Writing Tests

- **Test behavior, not implementation**
- **One assertion per test** when possible
- **Use descriptive test names**: `it('should return error when user not found')`
- **Follow AAA pattern**: Arrange, Act, Assert
- **Mock external dependencies**
- **Don't test third-party libraries**

### Test Organization

```
src/
  domain/
    user/
      User.ts
      User.test.ts          # Unit tests next to source
  use-cases/
    CreateUser.ts
    CreateUser.test.ts
  infrastructure/
    database/
      UserRepository.integration.test.ts  # Integration tests
```

### Running Tests

```bash
# All unit tests
pnpm test:unit

# All integration tests (requires PostgreSQL)
pnpm test:integration

# Specific component
pnpm test:unit:backend
pnpm test:unit:frontend
pnpm test:unit:crawler

# Watch mode (for development)
pnpm test:unit -- --watch
```

### Test Coverage

- Aim for **>70% coverage** for new code
- Run coverage: `pnpm test:unit -- --coverage`
- Focus on critical paths and business logic
- Don't sacrifice test quality for coverage numbers

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation only
- **style**: Code style changes (formatting, no logic change)
- **refactor**: Code refactoring (no feature/fix)
- **perf**: Performance improvement
- **test**: Adding or updating tests
- **chore**: Maintenance (dependencies, config, etc.)
- **ci**: CI/CD changes

### Scope

Optional, indicates the module or component:

- `backend`
- `frontend`
- `crawler`
- `history-scanner`
- `notifications`
- `shared`

### Subject

- Use imperative mood: "add feature" not "added feature"
- Don't capitalize first letter
- No period at the end
- Max 50 characters

### Examples

```
feat(backend): add health check endpoint

Add /health and /ready endpoints for Kubernetes liveness and readiness probes.
Checks database connectivity and crawler status.

Closes #123
```

```
fix(crawler): prevent connection leak on timeout

Ensure connections are properly closed even when timeout occurs.

Fixes #456
```

```
docs: update DEVELOPER_SETUP.md with devcontainer instructions
```

## Pull Request Process

### Before Submitting

- [ ] Tests pass: `pnpm test:unit` and `pnpm test:integration` (if applicable)
- [ ] Linting passes: `pnpm lint`
- [ ] Build succeeds: `pnpm build:ts`
- [ ] Documentation updated if needed
- [ ] Commit messages follow conventions
- [ ] Branch is up to date with `main`

### Creating the PR

1. **Use a clear title** following commit message guidelines
2. **Fill out the PR template** completely
3. **Link related issues** using keywords (Closes #123, Fixes #456)
4. **Add screenshots** for UI changes
5. **Describe testing** you performed
6. **Note breaking changes** if any

### PR Template Checklist

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] No new warnings generated
- [ ] Tests pass locally
```

### Review Process

1. **Automated checks** must pass (CI/CD)
2. **At least one maintainer** must approve
3. **Address review comments** promptly
4. **Keep discussions focused** on the code
5. **Be receptive to feedback**

### After Approval

- Maintainers will merge using squash or merge commit
- Delete your branch after merge
- Celebrate your contribution! 🎉

## Community

### Communication Channels

- **GitHub Issues**: Bug reports, feature requests
- **GitHub Discussions**: Questions, ideas, show and tell
- **Pull Requests**: Code review discussions

### Getting Help

- Check [DEVELOPER_SETUP.md](DEVELOPER_SETUP.md) for setup issues
- Search [existing issues](https://github.com/Stellar-Atlas/StellarAtlas/issues)
- Ask in [GitHub Discussions](https://github.com/Stellar-Atlas/StellarAtlas/discussions)
- Read the source code and inline documentation

### Recognition

Contributors are recognized in:

- Git commit history
- Release notes and changelogs
- README.md contributors section (coming soon)

## License

By contributing to StellarAtlas, you agree that your contributions will be licensed under the MIT License.

## Questions?

If you have questions about contributing:

1. Check this guide and [DEVELOPER_SETUP.md](DEVELOPER_SETUP.md)
2. Search existing discussions and issues
3. Open a new [GitHub Discussion](https://github.com/Stellar-Atlas/StellarAtlas/discussions)

Thank you for contributing to StellarAtlas! 🌟

---

**Last Updated**: December 26, 2025  
**Version**: 1.0
