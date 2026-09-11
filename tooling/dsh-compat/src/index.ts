/** 本仓库针对的 DSH 版本。升级 DSH 时只改这里。 */
export const DSH_VERSION = '0.1.5-rc.1'
/** 身份必须共享的包：走 peerDependencies + devDependencies。 */
export const PEER_PACKAGES = ['@deepseek-ai/cordis'] as const
/** 允许出现在 dependencies 的 @deepseek-ai 包。 */
export const DEPENDENCY_ALLOWLIST = ['@deepseek-ai/schemastery'] as const
