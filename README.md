# Monorepo for StellarAtlas project

[![Known Vulnerabilities](https://snyk.io/test/github/Stellar-Atlas/StellarAtlas/badge.svg)](https://snyk.io/test/github/Stellar-Atlas/StellarAtlas)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)

## About

StellarAtlas is a monitoring and analytics platform for the Stellar network and
its validators and organizations. It collects and visualizes network data with
the ability to time-travel, has simulation options, provides REST APIs for
integration, implements email notifications, scans validator history archives
for errors and provides educational tools to aid in understanding the Stellar
Consensus Protocol.

## Architecture

This monorepo is organized into several main components:

### Apps

- **Backend** ([apps/backend](apps/backend/README.md)) - Core application with
  three major modules:

  - Network-scan: Collects and updates network data
  - Notifications: Handles user subscriptions and email notifications
  - History-scanner-coordinator: Determines scan schedule, persists and exposes
    scan results.

  Provides REST APIs documented using the OpenAPI standard.

- **Frontend** ([apps/frontend](apps/frontend/README.MD)) - Vue.js based web
  dashboard
- **Users** ([apps/users](apps/users/README.md)) - User email microservice

- **History-scanner**
  ([apps/history-scanner](apps/history-scanner/README.md)) - History Scanner
  microservice/worker

### Packages

- **Crawler** ([packages/crawler](packages/crawler/)) - Stellar network crawler
  that identifies nodes and determines their status
- **Shared** ([packages/shared](packages/shared/)) - Common code used by both
  frontend and backend, including DTO classes and TrustGraph calculations
- **SCP Simulation** ([packages/scp-simulation](packages/scp-simulation/)) -
  Educational implementation of the Stellar Consensus Protocol
- **Node Connector** ([packages/node-connector](packages/node-connector/)) -
  Nodejs package to connect to Stellar nodes
- Various utility packages

### Apps communication

Backend, frontend and users share data through REST API's.

### Development

The project uses:

- Nodejs on the backend
- Vuejs on the frontend using Vite build system
- REST for API's
- TypeScript with unified configuration inherited from tsconfig.base.json
- pnpm for package management and monorepo setup
- Jest for testing
- ESLint for code quality
- Docker/Devcontainer support for development environments
- OpenAPI documentation

### Database

- PostgreSQL for data persistence
- Automatic migrations on first run (TypeORM)
- Separate test database instance for integration testing

### Deployment

![C4 Containers Model](architecture-c4-containers.png)

Adheres to
[twelve factor app methodology](https://en.wikipedia.org/wiki/Twelve-Factor_App_methodology)
for easy deployment on Heroku.

For history scanning think carefully about network traffic and costs when
choosing a provider.

## Devcontainer development

For easy development a devcontainer configuration is provided in the
.devcontainer folder: <https://containers.dev/>

You can develop on github codespaces or localy using vscode and devcontainers
extension.

A debian docker image with non-root user 'node' is used with nodejs and rust
support. Two postgress databases are added for development and integration
testing. A persistant volume is created linked to the remote 'workspace' folder.

Also works with podman.

Container config and postgresql credentials:

```sh
cd .devcontainer
cat docker-compose.yml
```

## Dev Container Usage

The StellarAtlas project includes a development container configuration to simplify the development environment setup. This allows you to work in a consistent environment, whether locally or in GitHub Codespaces.

### What is a Dev Container?

A dev container is a Docker-based development environment that includes all the necessary tools, libraries, and dependencies pre-installed. It ensures consistency across development environments and eliminates the need for manual setup.

### Features of the Dev Container

- Pre-installed Node.js, npm, and pnpm for JavaScript/TypeScript development.
- Pre-installed Git for version control.
- PostgreSQL databases for development and integration testing.
- Persistent volume for workspace data.
- Non-root user `node` for security.
- Rust support for specific packages.

### Steps to Use the Dev Container

1. **Install Prerequisites**:
   - Install [Docker](https://www.docker.com/) on your machine.
   - Install [Visual Studio Code](https://code.visualstudio.com/).
   - Install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) in VS Code.

2. **Open the Project in the Dev Container**:
   - Open the StellarAtlas project folder in VS Code.
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) to open the Command Palette.
   - Select `Dev Containers: Reopen in Container`.

3. **Wait for the Container to Build**:
   - The first time you open the project in the dev container, it will build the container image. This may take a few minutes.
   - Once the container is built, VS Code will automatically connect to it.

4. **Verify the Environment**:
   - Open a terminal in VS Code and run the following commands to verify the setup:

     ```sh
     node --version
     pnpm --version
     psql --version
     ```

5. **Run the Project**:
   - Install dependencies:

     ```bash
     pnpm install
     ```

   - Build the project:

    ```bash
     pnpm build
     ```

   - Start the development environment:

     ```bash
     pnpm dev
     ```

6. **Access the Services**:
   - Backend API: `http://localhost:3000`
   - Frontend: `http://localhost:5173`

### Notes

- The dev container uses a `.devcontainer` folder for its configuration. You can inspect or modify the configuration files if needed.
- PostgreSQL credentials and other environment variables are defined in the `.env` files. Ensure these files are correctly set up before running the project.
- The dev container also works with Podman as an alternative to Docker.

By using the dev container, you can ensure a consistent and hassle-free development experience. Let me know if you need further assistance!

## install

### Node.js and pnpm version requirements

This monorepo requires specific versions of Node.js and pnpm, as defined in the `engines` key in the root `package.json`:

```js
  "engines": {
    "node": "22.x",
    "pnpm": "10.12.1"
  }
```

#### Why is the `engines` key necessary?

- **Consistency:** Ensures all developers and CI environments use the same versions, preventing subtle bugs and incompatibilities.
- **Compatibility:** Some dependencies and scripts may only work with Node.js 20.x and pnpm 9.15.0. Using other versions can cause build or runtime errors.
- **Monorepo tooling:** pnpm 9.x is required for correct workspace and dependency management in this monorepo setup.

#### Why these versions?

- **Node.js 20.x** is a stable LTS release, widely supported and tested with this codebase.
- **pnpm 9.15.0** is the latest tested version that works reliably with the monorepo and its dependencies.

#### How to install the correct versions

If you encounter errors related to Node.js or pnpm versions, follow these steps:

1. **Check your current versions:**

   ```bash
   node --version
   pnpm --version
   ```

2. **Install Node.js 20.x:**
   - Use [nvm](https://github.com/nvm-sh/nvm):

     ```bash
     nvm install 20
     nvm use 20
     ```

   - Or download from [nodejs.org](https://nodejs.org/en/download/).
3. **Install pnpm 9.15.0:**

   ```bash
   npm install -g pnpm@9.15.0
   ```

4. After installing the correct versions, proceed with:

```bash
pnpm install
```

Afterwards, implement the necessary .env files (based on .env.dist) in the applications.

---

## list available commands

```sh
pnpm run
```

## development

### backend and packages

```sh
pnpm build:ts
```

### frontend and API

```sh
pnpm dev
```

This will start the api on port 3000 and the frontend hot reload environment.
API (backend) is not hot reloaded on changes. You have to manually stop and
restart pnpm serve.

## build

```bash
pnpm build
```

## run the app (in production)

Make sure to build first.

### Start the backend API

Start REST API that exposes all data. Used by frontend.

Source: apps/backend/core/infrastructure/http

```bash
pnpm start:api
```

### Start the frontend server and serve the website

Host the web dashboard.

source: apps/frontend

```bash
pnpm start:frontend
```

### Run a stellar network scan (recommended: use dedicated worker or machine)

Scans the a stellar network, detects nodes and validators, fetches geo data,
performs network analysis,...

Source: apps/backend/network-scan

```bash
pnpm start:scan-network 1 0
```

First argument controls if it should loop the scans (.env file in backend can
supply a loop time interval), second argument controls if it's a dry run.

### Run a history scan (recommended: use a dedicated machine)

Fetches all known history archives from db and scans and verifies their content.
Source: apps/backend/history-scan

```sh
pnpm start:scan-history 1 1
```

First argument controls persisting the results, the second argument if you want
to loop the scanning forever.

## typescript monorepo configuration

The pure typescript packages and apps (backend, crawler, shared,...) have their
tsconfigs linked through references in the root tsconfig.json and composite:true
value in the local tsconfigs.

They inherit common typescript settings from root tsconfig.base.json.

When running build on top level, typescript compiler only recompiles changed
apps/packages and does this in the correct order.

To compile:

```sh
pnpm build:ts

```

The frontend is separate because it uses vite to build. To build frontend and
all other apps and packages:

```sh

pnpm build

```

## eslint monorepo configuration

Eslint is defined at the top level using the esling.config.mjs file. Every
project needs to be defined here to enable linting.

run linting:

```sh
pnpm lint
```

## testing

Using Jest

### unit

```sh
pnpm test:unit
```

### integration

Using jest, needs postgres instance

```sh
pnpm test:integration
```

### run all tests (ci)

```sh
pnpm test:all
```
