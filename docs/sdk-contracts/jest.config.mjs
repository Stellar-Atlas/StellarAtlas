import base from '../../jest.config.mjs';
import { fileURLToPath } from 'node:url';

const { projects, ...common } = base;
const backend = projects.find(project => project.displayName === 'backend');
export default {
  ...common,
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  roots: ['<rootDir>/docs/sdk-contracts'],
  testMatch: ['<rootDir>/docs/sdk-contracts/*.test.mjs'],
  moduleDirectories: ['node_modules', '<rootDir>/apps/backend/node_modules'],
  moduleNameMapper: Object.fromEntries(Object.entries(backend.moduleNameMapper).map(([key, value]) =>
    [key, typeof value === 'string' ? value.replaceAll('<rootDir>', '<rootDir>/apps/backend') : value])),
  transform: {
    ...common.transform,
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: { target: 'ESNext', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
        esModuleInterop: true, isolatedModules: true }
    }]
  }
};
