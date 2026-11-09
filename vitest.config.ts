import {defineConfig} from 'vitest/config';
export default defineConfig({test:{root:process.cwd(),include:['tests/**/*.test.ts'],testTimeout:30000,fileParallelism:false}});
