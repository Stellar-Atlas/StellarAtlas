# PNPM Commands

## General Commands

1. **Install dependencies**:

   ```bash
   pnpm install
   ```

2. **Build the project**:

   ```bash
   pnpm build
   ```

3. **Run the development environment**:

   ```bash
   pnpm dev
   ```

4. **Run all tests (unit and integration)**:

   ```bash
   pnpm test:all
   ```

## Backend Commands

1. **Start the backend API**:

   ```bash
   pnpm start:api
   ```

2. **Run a Stellar network scan**:

   ```bash
   pnpm start:scan-network 1 0
   ```

3. **Run a history scan**:

   ```bash
   pnpm start:scan-history 1 1
   ```

## Frontend Commands

1. **Start the frontend server**:

   ```bash
   pnpm start:frontend
   ```

## Testing Commands

1. **Run unit tests**:

   ```bash
   pnpm test:unit
   ```

2. **Run integration tests**:

   ```bash
   pnpm test:integration
   ```

3. **Run linting**:

   ```bash
   pnpm lint
   ```

## Additional Commands

1. **Build TypeScript packages**:

   ```bash
   pnpm build:ts
   ```

2. **Force rebuild TypeScript packages**:

   ```bash
   pnpm build:ts:force
   ```

3. **List all available commands**:

   ```bash
   pnpm run
   ```
