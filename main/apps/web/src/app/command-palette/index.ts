// main/apps/web/src/app/command-palette/index.ts
export { CommandPalette } from './CommandPalette';
export { createCommands, filterCommands, type Command, type CommandDependencies } from './commands';
export {
  openCommandPalette,
  useCommandPalette,
  type UseCommandPaletteResult,
} from './useCommandPalette';
