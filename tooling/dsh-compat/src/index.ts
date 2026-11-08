/** The DSH version this repo targets. Upgrading DSH means editing only this. */
export const DSH_VERSION = '0.2.2-rc.1'
/** Packages whose identity must be shared: they go in peerDependencies + devDependencies. */
export const PEER_PACKAGES = ['@deepseek-ai/cordis'] as const
/** `@deepseek-ai` packages allowed to appear in dependencies. */
export const DEPENDENCY_ALLOWLIST = ['@deepseek-ai/schemastery'] as const
