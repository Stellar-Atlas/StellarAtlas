import base from '../../jest.config.mjs';
import { fileURLToPath } from 'node:url';

const { projects, ...common } = base;
export default {
  ...common,
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  testMatch: ['<rootDir>/docs/sdk-contracts/*.test.mjs'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: {
    ...common.transform,
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: { target: 'ESNext', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
        esModuleInterop: true, isolatedModules: true }
    }]
  }
};
