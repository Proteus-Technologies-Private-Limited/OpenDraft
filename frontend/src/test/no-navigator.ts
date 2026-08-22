/**
 * Reproduces CI's Node 20, which has no `navigator` global (it arrived in 21).
 * Loaded ahead of setup.ts by vitest.node20.config.ts so the suite can be run
 * against the runtime CI actually uses, from a machine with a newer Node.
 */
// @ts-expect-error removing a global that only newer Node versions define
delete globalThis.navigator;
