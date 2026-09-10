# 0004 — 客户端构建 preset

## 目标

让本仓库能构建出**浏览器能加载的** `lib/client.js`。

## 背景（一句话版）

DSH 的 Web GUI 不给插件用打包器。它用 `<script src>` 加载一个文件，这个文件必须喊一声"我在这"，然后把自己注册进去。DSH 官方的构建脚本在它自己仓库里，**没有发布**，所以我们得自己写一份。

## 做完的标志

```sh
pnpm --filter dsh-client-preset test    # 一致性测试通过
```

测试里会：构建一个 fixture 插件 → 在 jsdom 里搭一个假的 `window.__ModuleLoader__` → 加载产出的 `lib/client.js` → 断言插件的 `apply` 真的被调用了。

## 契约（这就是全部要求）

产出的 `lib/client.js` 必须长这样：

```js
window.__ModuleLoader__.load({ id: "dsh-plugin-foo", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
/* ...插件代码... */
return module.exports; } });
```

具体参数：

| 项 | 值 |
|---|---|
| 格式 | `cjs` + `platform: 'browser'`。**不能是 ESM**——它是用普通 `<script>` 加载的 |
| 文件名 | 固定 `client.js` |
| banner | `window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => {` |
| intro | `var module = { exports: {} }; var exports = module.exports;` |
| footer | `return module.exports; } });` |
| 导出 | 插件对象（`apply` / `inject`），不需要 default export |
| sourcemap | 开，且带 `sourcesContent` |

### 哪些 import 保持原样，哪些打包进去

只有这些会被 `require()` 交给宿主，其余全部内联：

```
react
react/jsx-runtime
react-dom
react-dom/client
@deepseek-ai/cordis
@deepseek-ai/dsh-client-store
@deepseek-ai/dsh-client-ui-slots
@deepseek-ai/dsh-client-ui-primitives
@deepseek-ai/dsh-client-ui-dockkit
```

外加插件自己在 `dsh.client.external` 里声明的（一般用不到）。

**其余的 `@deepseek-ai/*` 值导入一律构建失败。** 这是上游的规矩，照做——跨插件协作走 Cordis 服务或 slots，不走 import。

### CSS

- `x.module.css` → 编译成哈希类名，导出映射，并往 `<head>` 注入 `<style>`
- `x.css?inline` → 导出编译后的文本
- `x.css` → 直接全局注入

用 `lightningcss` 编译。

## 做什么

### 1. 建 `tooling/dsh-client-preset`

```
tooling/dsh-client-preset/
├── package.json          # deps: tsdown, lightningcss
├── tsconfig.json
├── src/index.ts          # 导出 clientBundle()
└── tests/
    ├── fixtures/hello-client/   # 一个最小的双半 fixture
    └── conformance.spec.ts
```

### 2. 导出 `clientBundle`

```ts
export function clientBundle(
  id: string,                 // 包名，会写进 banner
  libEntry: string[],         // Node 半边入口，通常是 ['lib/types/index.js']
): UserConfig[]
```

返回**两个**配置：Node 半边的打包 + 客户端半边的打包。

> 上游用 `DSH_BUILD_FACE` 环境变量分两趟构建，那是因为它要处理双 tsconfig 聚合。我们不需要：一个包一次全出，简单得多。

客户端那半的关键选项：

```ts
{
  name: `${id}/client`,
  entry: { client: 'lib/types/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  clean: false,
  sourcemap: true,
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
}
```

三个容易漏的点：

1. **`clean: false`**——否则客户端构建会把前面 Node 半边的产物擦掉。
2. **`lib` 半边必须一起返回**。包级 `tsdown.config.ts` 会**替换**根配置，不重申就没有 `lib/index.js`。
3. **`dts: false`**——类型由 `tsc` 出，这里再出会破坏 banner 的解析。

### 3. 基线列表别手抄

那 9 个模块名会随上游变。优先从已安装的包里读：

```ts
import { PLATFORM_MODULES } from '@deepseek-ai/dsh-client-web/src/platform.ts'
```

（该包的 `exports` 里开放了 `./src/*`，所以这是官方支持的取法。）

读不到就退回本地常量，并让 `pnpm verify:platform-modules` 在两者不一致时失败。

### 4. 一致性测试

`tests/fixtures/hello-client/`：一个最小的双半包，`src/client/index.ts` 里：

```ts
export function apply(ctx: unknown) {
  (globalThis as any).__helloApplied = true
}
```

测试流程：

1. 用 `clientBundle` 构建 fixture
2. jsdom 环境里定义假的 `window.__ModuleLoader__`：

```ts
const registered = new Map<string, (require: (id: string) => unknown) => unknown>()
window.__ModuleLoader__ = {
  load({ id, factory }) { registered.set(id, factory) },
}
```

3. 把 `lib/client.js` 作为脚本注入执行
4. 断言 `registered.has('dsh-plugin-hello-client')`
5. 传入一个假的 `require`，执行 factory，拿到插件对象
6. 调它的 `apply`，断言 `globalThis.__helloApplied === true`

再补两个失败用例：

- fixture 里写一句 `import { something } from '@deepseek-ai/dsh-tools'`（不在基线里）→ **构建必须报错**
- 传入一个满足不了基线之外模块的 `require` → **执行时必须抛错**

## 不做

- 不做 CSS Modules 的类名稳定性承诺——哈希值会变，别依赖
- 不做代码分割：只有一个文件能被寻址
- 不做静态链接模式（上游的 `staticLinked`）——那是给 shell 内部用的

## 验收

```sh
pnpm --filter dsh-client-preset test
```

通过，且失败用例确实是失败的（不是被跳过的）。
