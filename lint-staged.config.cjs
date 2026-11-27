/**
 * lint-staged commands, batched.
 *
 * lint-staged hands EVERY matched staged file to a single invocation of each
 * command. That is fine for an ordinary commit and breaks twice on a large
 * one (a 375-file merge, for instance):
 *
 * - `eslint` here is type-aware (`@typescript-eslint` rules that need type
 *   information), so one invocation builds the TypeScript program for every
 *   staged file at once and the process is killed for memory;
 * - the argument list passes the Windows command-line limit, which surfaces
 *   as "La ligne de commande est trop longue".
 *
 * Only the number of files per invocation is bounded here. The commands and
 * their thresholds are untouched, so nothing is weakened: a commit of a few
 * files still runs exactly one batch per command, and a huge commit runs the
 * same checks over several invocations instead of failing to run at all.
 */

/** Split `files` into consecutive groups of at most `size`. */
function chunk(files, size) {
  const groups = [];
  for (let i = 0; i < files.length; i += size) groups.push(files.slice(i, i + size));
  return groups;
}

/**
 * Quote every path. lint-staged parses the command string itself (string-argv),
 * so double quotes keep paths with spaces intact on Windows and POSIX alike.
 */
function args(batch) {
  return batch.map((file) => JSON.stringify(file)).join(' ');
}

// eslint carries the type information, so it gets the smaller batch.
const ESLINT_BATCH = 25;
const PRETTIER_BATCH = 40;

module.exports = {
  '*.{ts,tsx,js,jsx,mjs,cjs}': (files) => [
    ...chunk(files, PRETTIER_BATCH).map((batch) => `prettier --write ${args(batch)}`),
    ...chunk(files, ESLINT_BATCH).map(
      (batch) => `eslint --fix --max-warnings=0 --no-warn-ignored ${args(batch)}`,
    ),
  ],
  '*.{json,md,yml,yaml}': (files) =>
    chunk(files, PRETTIER_BATCH).map((batch) => `prettier --write ${args(batch)}`),
};
