# StellarAtlas Developer Setup Guide

This guide provides tested, step-by-step instructions for setting up a complete StellarAtlas development environment with live Stellar network connectivity.

## Prerequisites

### Required Versions
- **Node.js 22.x** (as specified in package.json engines)
- **pnpm 10.12.1** (as specified in package.json engines)
- **PostgreSQL** (local installation or via devcontainer)

### Version Setup
```bash
# Install and use Node.js 22.x
nvm install 22
nvm use 22

# Install and activate pnpm 10.12.1
corepack enable
corepack prepare pnpm@10.12.1 --activate

# Verify versions
node --version  # Should show v22.x.x  
pnpm --version  # Should show 10.12.1
```

## Development Environment Options

StellarAtlas supports two development approaches:

### Option 1: Devcontainer (Recommended)
The project includes a complete devcontainer setup with PostgreSQL and all dependencies pre-configured.

**Prerequisites:**
- [Docker](https://www.docker.com/)
- [Visual Studio Code](https://code.visualstudio.com/)
- [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

**Setup:**
1. Open the StellarAtlas project folder in VS Code
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
3. Select `Dev Containers: Reopen in Container`
4. Wait for the container to build (first time takes a few minutes)
5. Skip to the "Repository Setup" section below

### Option 2: Local Development

#### PostgreSQL Configuration
Create the required PostgreSQL user and databases:

```bash
# Create user with database creation privileges
psql postgres -c "CREATE USER stellaratlas WITH PASSWORD 'stellaratlas';"
psql postgres -c "ALTER USER stellaratlas CREATEDB;"

# Create development and test databases
psql postgres -c "CREATE DATABASE stellaratlas OWNER stellaratlas;"
psql postgres -c "CREATE DATABASE stellaratlas_test OWNER stellaratlas;"
```

## Repository Setup

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Environment Configuration

#### Backend Environment
```bash
cp apps/backend/.env.dist apps/backend/.env
```

**For Local Development** - Update `apps/backend/.env`:
```bash
# Replace database URLs for local PostgreSQL:
ACTIVE_DATABASE_URL=postgresql://stellaratlas:stellaratlas@localhost:5432/stellaratlas
DATABASE_TEST_URL=postgresql://stellaratlas:stellaratlas@localhost:5432/stellaratlas_test

# Update with current Stellar seed nodes:
NETWORK_KNOWN_PEERS=[["54.210.6.104", 11625], ["54.161.143.145", 11625], ["34.229.119.143", 11625]]
```

**For Devcontainer** - Update `apps/backend/.env`:
```bash
# Database URLs remain as-is for devcontainer:
ACTIVE_DATABASE_URL=postgresql://user:password@pgsql-dev:5432/mydb
DATABASE_TEST_URL=postgresql://user:password@pgsql-test:5432/mydb

# Update with current Stellar seed nodes:
NETWORK_KNOWN_PEERS=[["54.210.6.104", 11625], ["54.161.143.145", 11625], ["34.229.119.143", 11625]]
```

**Current Seed Nodes** correspond to:
- core-live-a.stellar.org
- core-live-b.stellar.org  
- core-live-c.stellar.org

**Note**: Stellar seed node IPs change periodically. If network scans fail, resolve current IPs:
```bash
nslookup core-live-a.stellar.org
nslookup core-live-b.stellar.org
nslookup core-live-c.stellar.org
```

#### Frontend Environment
```bash
cp apps/frontend/.env.dist apps/frontend/.env
```

Verify `apps/frontend/.env` contains:
```bash
VUE_APP_PUBLIC_API_URL=http://localhost:3000
```

#### Other Services Environment
```bash
# Copy environment files for all services
cp apps/history-scanner/.env.dist apps/history-scanner/.env
cp apps/users/.env.dist apps/users/.env
cp packages/crawler/.env.dist packages/crawler/.env
cp packages/node-connector/.env.dist packages/node-connector/.env
```

### 3. Build System Setup

#### Build TypeScript Packages
```bash
pnpm build:ts
```

#### Generate Required Schema Files
```bash
# Generate network schema (required by frontend)
cd packages/shared
pnpm run post-build
cd ../..

# Copy backend templates (if post-build script exists)
pnpm --filter backend run post-build
```

## Development Environment

### Start Development Services
```bash
# Start both backend API (port 3000) and frontend dev server (port 5173)
pnpm dev
```

The development environment will be available at:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- API Documentation: http://localhost:3000/docs

## Live Network Setup

### Initial Network Scan
Before the frontend can display data, you need to populate the database with live Stellar network data:

```bash
# Run a single network scan (takes 10-30 minutes)
pnpm start:scan-network 0 0
```

Parameters:
- First argument: `0` = single scan, `1` = continuous looping
- Second argument: `0` = live run, `1` = dry run

### Monitor Scan Progress
```bash
# Check scan logs (in another terminal)
tail -f /tmp/stellar-scan.log
```

Look for:
- "Starting crawl process" - scan has begun
- "Ledger closed!" - receiving live ledger data
- Connection timeouts will automatically retry with different seed nodes

### Verify Live Data
Once the scan completes:
1. Refresh http://localhost:5173
2. You should see live Stellar network data including:
   - Active validators and nodes
   - Network statistics
   - Live quorum set information

## Testing

### Unit Tests
```bash
pnpm test:unit
# Shorthand: pnpm tu
```

### Integration Tests (requires PostgreSQL)
```bash
pnpm test:integration  
# Shorthand: pnpm ti
```

### All Tests
```bash
pnpm test:all
```

### Component-specific Testing
```bash
pnpm test:unit:backend
pnpm test:unit:frontend
pnpm test:unit:crawler
pnpm test:unit:history-scanner
pnpm test:unit:scp-simulation
```

## Quality Assurance

### Linting
```bash
pnpm lint
```

## Production Commands

### Backend API
```bash
pnpm start:api
```

### Frontend Server
```bash
pnpm start:frontend
```

### Network Scanning Service
```bash
# Single scan
pnpm start:scan-network 0 0

# Continuous scanning (production)
pnpm start:scan-network 1 0
```

### History Archive Scanning
```bash
pnpm start:scan-history
```

## Troubleshooting

### Common Issues

#### "No network found" Error
**Cause**: Database not populated with network data
**Solution**: Run initial network scan: `pnpm start:scan-network 0 0`

#### Engine Version Mismatch
**Cause**: Wrong Node.js or pnpm version
**Solution**: Use exact versions - Node.js 22.x and pnpm 10.12.1

#### "Could not connect to a single node in crawl"
**Cause**: Outdated Stellar seed node IP addresses
**Solution**: Update `NETWORK_KNOWN_PEERS` in `apps/backend/.env` with current IPs

#### Database Connection Errors

**For Local Development:**
- **"role stellaratlas does not exist"**: Run the PostgreSQL setup commands above
- **Connection refused**: Ensure PostgreSQL is running locally

**For Devcontainer:**
- Database should work automatically
- If issues persist, rebuild container: `Dev Containers: Rebuild Container`

#### Missing network-schema.js
**Cause**: Post-build steps not executed
**Solution**: 
```bash
cd packages/shared && pnpm run post-build
```

#### ERR_BLOCKED_BY_CLIENT in Browser
**Cause**: Browser extension blocking API requests
**Solution**: Test in incognito mode or disable ad blockers

#### Frontend Build Failures
**Cause**: Missing dependencies or outdated build artifacts
**Solution**: 
```bash
pnpm build:ts
pnpm --filter frontend run build
```

### Network Connectivity Issues

If network scans consistently fail:

1. **Check seed node connectivity**:
   ```bash
   telnet 54.210.6.104 11625
   ```

2. **Resolve current IPs**:
   ```bash
   nslookup core-live-a.stellar.org
   ```

3. **Update configuration** with new IPs in `apps/backend/.env`

4. **Restart development services**:
   ```bash
   # Stop current dev process (Ctrl+C)
   pnpm dev
   ```

### Build System Issues

If incremental builds fail:
```bash
# Clean build (removes all lib/ directories)
find . -name "lib" -type d -exec rm -rf {} + 2>/dev/null || true

# Full rebuild
pnpm build:ts
pnpm build
```

### Devcontainer Issues

#### Container won't start
- Ensure Docker is running
- Try: `Dev Containers: Rebuild Container`

#### Database connection issues in devcontainer
- Container should auto-configure PostgreSQL
- Check `.devcontainer/docker-compose.yml` for database credentials

## Architecture Notes

### Monorepo Structure
- **TypeScript composite references** for incremental builds
- **pnpm workspaces** for dependency management
- **Shared packages** used by multiple apps

### Key Technologies
- **Backend**: Node.js, Express, TypeORM, PostgreSQL
- **Frontend**: Vue.js, Vite, Bootstrap 4
- **Testing**: Jest with separate unit/integration configs
- **Build**: TypeScript project references

### Configuration Management
- Environment files must be copied from `.env.dist` templates
- Database URLs differ between local and devcontainer setups
- CORS configured for local development (localhost:5173 → localhost:3000)

## Development Workflow

### Making Changes
1. **Backend changes**: Restart `pnpm dev` (no hot reload for backend)
2. **Frontend changes**: Hot reload automatically updates
3. **Package changes**: Run `pnpm build:ts` and restart services
4. **Database changes**: Create migrations using TypeORM CLI

### Before Committing
```bash
pnpm lint          # Fix linting issues
pnpm test:unit     # Ensure tests pass
pnpm build         # Verify build succeeds
```

## Devcontainer Details

The devcontainer provides:
- Pre-installed Node.js, pnpm, and Git
- PostgreSQL databases for development and integration testing
- Persistent volume for workspace data
- Non-root user `node` for security
- Rust support for specific packages

Access services in devcontainer:
- Backend API: http://localhost:3000
- Frontend: http://localhost:5173

## Next Steps

After successful setup:

1. **Explore the API**: Visit http://localhost:3000/docs for OpenAPI documentation
2. **Review network data**: Check the frontend dashboard for live Stellar network information
3. **Run tests**: Ensure all unit and integration tests pass
4. **Set up continuous scanning**: For ongoing development, use `pnpm start:scan-network 1 0`

This setup guide reflects the actual tested process for getting StellarAtlas running with live Stellar network connectivity. All commands and configurations have been verified to work with both local and devcontainer environments.