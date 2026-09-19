// Modified by PrimusPost, 2026-09-19: vitest configuration for workspace test suites. See NOTICE.md.
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
  },
});
