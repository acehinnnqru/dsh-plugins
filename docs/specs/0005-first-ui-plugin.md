# 0005 — 第一个 UI 插件

## 目标

做第一个有浏览器半边的插件：在 Web GUI 里看得见东西，改代码自动刷新。

## 做完的标志

1. 打开 `dsh web`，界面上出现这个插件的 UI。
2. 改一下 `src/client/` 里的代码，重新构建后**刷新浏览器就看到新内容**，不用重启 dsh。
3. `pnpm verify` 和 `pnpm verify:pack` 都还是绿的。

## 做什么

### 1. 给现成的插件加浏览器半边

拿 0002 的插件改造，或者新建一个。目录变成：

```
plugins/<name>/
├── package.json          # 加 dsh.client
├── cordis.patch.yml      # 不变
├── tsconfig.json         # 加 DOM / JSX
├── tsdown.config.ts      # 新增，调 clientBundle
├── src/
│   ├── index.ts          # host 半边（必须有）
│   └── client/index.ts   # 浏览器半边
└── tests/
```

### 2. `package.json` 加三处

```json
{
  "exports": {
    "./client": {
      "types": "./lib/types/client/index.d.ts",
      "default": "./lib/client.js"
    }
  },
  "files": ["lib/index.js", "lib/client.js", "cordis.patch.yml", "lib/types/**/*.d.ts"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" }
  }
}
```

**少任何一处都会失败，而且失败点很靠后、很难查**：

- 没有 `exports["./client"]` → 客户端扫描阶段直接抛错
- 没有 `files` 里的 `lib/client.js` → 装进 profile 后文件不存在
- 没有 `dsh.client` → 根本不会被当成客户端包

### 3. host 半边不能少（容易忽略）

**浏览器端只认识"已经在运行的 host 行"**。模块图是从活着的 host Loader 行里扫出来的，所以：

- `src/index.ts` 必须存在，而且要能被正常加载（`apply` 可以是空的）
- 它的行必须在某个启用中的 patch 层里

这不是配置问题，是组合模型决定的。

### 4. `tsconfig.json` 开浏览器能力

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib/types",
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

### 5. `tsdown.config.ts`

```ts
import { clientBundle } from 'dsh-client-preset'

export default clientBundle('dsh-plugin-<name>', ['lib/types/index.js'])
```

### 6. 浏览器半边

`src/client/index.ts` 的形状：

```ts
export const inject = ['slots']

export function apply(ctx: Context) {
  ctx.slots.inject('<slot 名>', () => ctx.slots.register({
    name: 'dsh-plugin-<name>',
    id: '<name>',
  }, Component))
}
```

两个 `inject` 别搞混：

- 源码里的 `export const inject = ['slots']` —— **Cordis 服务名**，决定什么时候加载
- `package.json` 里的 `dsh.client.inject` —— **包名**，只是信息，不决定加载顺序

slot 名和注册参数以 `docs/subsystems/slots.md` 为准。

写完之后加一条 lint 规则：

| 规则 | 检查什么 |
|---|---|
| L7 | 声明了 `dsh.client` ⟺ 有 `exports["./client"]`，且 `files` 里有 `lib/client.js` |

## 开发循环

两个终端：

```sh
# 终端 A（在这个仓库里）
pnpm --filter dsh-plugin-<name> watch

# 终端 B（你来跑，在 DSH checkout 里）
dsh --profile <你的 profile>
```

改 `src/client/` 的代码 → 终端 A 重新写出 `lib/client.js` → dsh 检测到文件变了 → 浏览器自动换掉这个插件。

**dsh 端不用重启。** 它靠轮询文件变化工作，不需要任何额外的 watcher。

> 注意：插件是**先装进 profile 才有的**。改动 `lib/client.js` 会被自动拾取，但如果你改了 `package.json` 的清单或 patch 文件，需要重新装一次。

## 不做

- 不做需要跨插件共享运行时值的 UI（构建会拦，这是故意的）
- 不做设置页（那是另一套 slot，等真有需求再说）

## 验收

```sh
pnpm --filter dsh-plugin-<name> build
ls plugins/<name>/lib/client.js        # 存在
pnpm verify
pnpm verify:pack
```

然后手动确认：

1. `dsh --profile <你的 profile>`，界面上看到 UI
2. 改一行显示的文字 → 重新构建 → 刷新浏览器 → 看到新文字
3. 故意删掉 `package.json` 里的 `"./client"` 导出，重新构建 → `pnpm plugin-lint` 必须报错（验证 L7 在工作），然后改回来
