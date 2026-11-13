// Metro config for the pnpm monorepo — watch the workspace root so shared
// packages (@djafat/*) resolve, and dedupe hoisted deps. Copied from
// apps/mobile (Bloc 0) — same monorepo, same fix.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Hierarchical lookup stays ON: pnpm keeps each package's own dependencies
// next to it (node_modules/.pnpm/<pkg>/node_modules), not hoisted to the root.
// Turning it off made Metro miss them (e.g. react-native -> invariant), so the
// app could not be bundled at all.

module.exports = config;
