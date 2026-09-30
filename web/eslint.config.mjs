import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
const config = [
  { ignores: ['playwright-report/**', 'test-results/**'] },
  ...compat.extends('next/core-web-vitals'),
];
export default config;
