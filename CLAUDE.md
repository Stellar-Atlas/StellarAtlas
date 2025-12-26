# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development
- `pnpm dev` - Start development environment (backend API on :3000, frontend on :5173)
- `pnpm build:ts` - Compile TypeScript for all apps/packages
- `pnpm build` - Full build including frontend
- `pnpm lint` - Run ESLint across entire monorepo

### Testing  
- `pnpm test:unit` or `pnpm tu` - Run unit tests
- `pnpm test:integration` or `pnpm ti` - Run integration tests (requires PostgreSQL)
- `pnpm test:all` - Run all tests
- Specific test suites: `pnpm test:unit:frontend`, `pnpm test:unit:backend`, `pnpm test:unit:crawler`, etc.

### Production Services
- `pnpm start:api` - Start backend REST API
- `pnpm start:frontend` - Start frontend server
- `pnpm start:scan-network` - Start network scanning (args: loop, dry-run)
- `pnpm start:scan-history` - Start history archive scanning (args: persist, loop)

## Architecture Overview

**StellarAtlas** is a monitoring and analytics platform for the Stellar network. This monorepo follows clean architecture principles with domain-driven design.

### Core Applications

**Backend** (`apps/backend/`) - Main Node.js application with three modules:
- **Network-scan**: Crawls Stellar network, detects nodes/validators, performs network analysis
- **Notifications**: Handles user subscriptions and email notifications  
- **History-scan-coordinator**: Coordinates history archive scanning, exposes scan results via REST API

**Frontend** (`apps/frontend/`) - Vue.js dashboard with Vite build system

**History-scanner** (`apps/history-scanner/`) - Microservice for verifying Stellar history archives

**Users** (`apps/users/`) - User email management microservice

### Key Packages

**Shared** (`packages/shared/`) - Core domain models, DTOs, and business logic shared across apps:
- Network, Node, Organization entities and DTOs
- Trust graph algorithms and quorum set analysis
- Stellar Consensus Protocol utilities

**Crawler** (`packages/crawler/`) - Stellar network crawler with peer connection management

**Node-connector** (`packages/node-connector/`) - Low-level Stellar node connection library

**SCP-simulation** (`packages/scp-simulation/`) - Educational Stellar Consensus Protocol implementation

## Development Configuration

### TypeScript Setup
- Monorepo uses project references defined in root `tsconfig.json`
- All apps/packages inherit from `tsconfig.base.json` 
- Uses TypeScript 5.8+ with strict mode, ES2022 target, Node16 module resolution
- Decorators enabled for dependency injection (inversify)

### Key Dependencies
- **Node.js 22.x** and **pnpm 10.12.1** (exact versions required)
- **TypeScript** with strict configuration
- **Jest** for testing with integration test support
- **ESLint** configured at monorepo level in `eslint.config.mjs`
- **PostgreSQL** for data persistence with TypeORM migrations
- **Stellar SDK** (`@stellar/stellar-base`) for Stellar network integration
- **Nodemailer** for SMTP email functionality (local notifications)
- **Class-validator** for entity validation and email normalization

### Environment Requirements
- PostgreSQL databases for development and testing
- `.env` files required in each app (based on `.env.dist` templates)
- Dev container support available (`.devcontainer/`)

### Email Notification System
StellarAtlas supports two email notification modes:

**Local SMTP Service** (Recommended):
- Self-hosted email notifications using direct SMTP connection
- User data stored locally in PostgreSQL `users` table
- Zero external dependencies for email functionality
- Requires SMTP server configuration (Gmail, SendGrid, etc.)

**External User Service** (Legacy):
- Delegates user management to external microservice
- Requires separate `apps/users` service deployment
- HTTP API for user creation, lookup, and messaging

#### Local SMTP Configuration
```bash
# Enable local SMTP (recommended)
ENABLE_LOCAL_SMTP=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=true
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_ADDRESS=noreply@stellaratlas.io
```

#### External User Service Configuration (Legacy)
```bash
# Fallback to external service when SMTP disabled
ENABLE_LOCAL_SMTP=false
NOTIFICATIONS_ENABLED=true
USER_SERVICE_BASE_URL=http://localhost:3001
USER_SERVICE_USERNAME=api_user
USER_SERVICE_PASSWORD=api_password
FRONTEND_BASE_URL=https://stellaratlas.io
```

## Code Patterns

**Domain Entities**: Rich domain models in `src/*/domain/` folders following DDD patterns

**Use Cases**: Application services in `src/*/use-cases/` implementing business logic

**Infrastructure**: External concerns (HTTP, database, etc.) in `src/*/infrastructure/`

**Dependency Injection**: Uses inversify with container definitions in `di/container.ts`

**Error Handling**: Custom error types extending base `CustomError` class

**DTOs**: Versioned data transfer objects in `packages/shared/dto/` with JSON schema validation

## Important Notes

- Network scanning is resource-intensive - consider dedicated infrastructure
- History archive scanning generates significant network traffic
- Integration tests require PostgreSQL instance
- Frontend uses Vue 3 with TypeScript and Vite
- API documentation available via OpenAPI standard
- Add to memory SDF Update #1 - Q2 "https://docs.google.com/document/d/1khOQjJZNx026sUYK5ZZ1Xpx2bpiv0FVc6pPE7Qs9Wng/edit?tab=t.f9ia0liz0912" , Final  Proposal / Stellarbeat "https://docs.google.com/document/d/1khOQjJZNx026sUYK5ZZ1Xpx2bpiv0FVc6pPE7Qs9Wng/edit?tab=t.8f92387ei16p" , Request for Proposal / Stellarbeat "https://docs.google.com/document/d/1khOQjJZNx026sUYK5ZZ1Xpx2bpiv0FVc6pPE7Qs9Wng/edit?tab=t.0"
- Good find. Lets save this todo for now as this is something that can be considered later.