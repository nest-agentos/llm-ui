# @nestos/llm-ui

独立的原生 DOM LLM 界面库，包含聊天与 Flow。唯一直接运行时依赖为 `@nestos/mdxeditor`；不依赖 MindOS、Session、Kernel、Flow 执行包、VFS、框架或特定传输协议。

## npm 与源码消费

独立仓库：[mushuanli/llm-ui](https://github.com/nest-agentos/llm-ui)。在仓库根目录使用 Node.js 22 和 pnpm 10.20.0：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

源码与 TypeScript/Vite 配置均不引用上级工作区。MindOS 将此仓库作为 `libraries/llm-ui` 子模块使用；该目录就是开发工作树，直接在其中提交并推送，再由主仓库更新子模块提交，不维护第二份源码。

发布制品通过 npm 安装，根入口使用 dist JavaScript 和声明：

```bash
pnpm add @nestos/llm-ui @nestos/mdxeditor
```

源码位于 libraries/llm-ui。pnpm 工作区将该目录与应用纳入 packages 后，应用声明 `@nestos/llm-ui: workspace:*`，包 exports 自动指向 src；mdxeditor 也可作为源码工作区提供。无需生成 dist，也无需为 Session、Flow 执行包或其他 MindOS 包设置路径别名。

源码入口只使用自身相对模块和公开的 mdxeditor 包。外部 Vite/TypeScript 工程也可直接引用 vendored `src/index.ts` 或 `src/flow.ts`，并提供 mdxeditor 依赖；使用支持 TypeScript 与 CSS 的 bundler。构建工具脚本不进入源码运行依赖。

```ts
import { createChatView, createOperationLedger } from '@nestos/llm-ui';
import '@nestos/llm-ui/style.css';
import '@nestos/mdxeditor/style.css';

// Keep the ledger in the host, beyond any individual view.
const operations = createOperationLedger();
const view = await createChatView(container, {
    source, // synchronous getSnapshot() and subscribe()
    actions, // named Promise operations and reconcile(operationId)
    operations,
});

await view.flushDraft();
await view.destroy();
```

可运行的内存宿主组合见 [memory-host.ts](./examples/memory-host.ts)。它演示快照发布、提交值捕获、选择器、资源候选及 toolbar 的 update/destroy。MindOS 的 Session 和原生会话接入位于 `@nestos/llm-ui-adapter/independent`。

标题栏提供“搜索内容”按钮，查找当前会话已加载的消息正文、思考、工具文本和附件名。搜索忽略大小写，支持匹配计数、高亮及上一项/下一项定位；视图内按 Ctrl/Cmd+F 打开，搜索框内按 Enter/Shift+Enter 切换，Esc 关闭。流式更新和加载更早消息后刷新结果；不会自动加载未展示的历史，不检索草稿或宿主自定义 renderer 内部内容。

兼容编辑器可通过 `createContentSearch({ root, history, getContents, onOpen, onNavigate })` 复用同一搜索控件。宿主用 getContents 按展示顺序提供稳定 ID 与可读正文 DOM，onOpen 激活尚未呈现的内容，onNavigate 展开目标历史卡片；控件再经 mdxeditor 的 revealRenderedContent 展开命中祖先，随后测量并滚动历史视口。返回的 button 和 element 由宿主挂载。控件只在打开且活动时观察正文变化，过滤表单及 `data-search-exclude` 区域，并在销毁时释放观察和高亮。MindOS 的本地及原生会话标题栏已接入此控件，手机上也直接显示搜索按钮。

`createInteractionCard(request, submit, {locale, translate})` 提供与 ChatView 共用的审批和问答卡片，支持单选、多选、选项说明、自定义答案及密码字段。宿主挂载返回的 `element`，用 `setPending` 更新提交权限，结束时调用 `destroy`；同一请求的观察更新应复用卡片，保留未提交的输入。未知交互显示只读提示。

## 共享界面与主题

`await view.replaceBinding(binding)` 在同一视图内更换 source/actions/operations、保存端口、资源与展示扩展，保留输入框和历史容器 DOM、当前草稿、焦点及光标。宿主可在草稿转正时使用此能力；切换资源或分支则传入 `{draft: targetDraft}`，复用输入 DOM 并加载目标草稿。切换到不同 conversationId 必须显式提供草稿，避免把原输入带到另一会话。`inputBusy` 表示绑定替换或附件/图片处理尚未结束，此时不能再开始替换。

替换会先保存旧草稿，包括等待保存期间产生的新编辑，再订阅新源并安装绑定。保存或订阅失败会保留旧绑定；拒绝错误的 `bindingCommitted` 区分安装前失败和安装后的宿主展示失败。宿主只有在未安装时才能释放准备中的新绑定。旧操作冻结其原动作与台账，迟到回执不会写入新台账；等待登记完成时已经更换视图的操作不会再派发。旧分页读取会被中止，旧源和旧回执均不能改写新输入。

宿主可提供草稿 `scopeId`，在观察实例重建后识别同一持久输入；不同分支或草稿应使用不同身份。同一 scope 内仍按文字、附件和参数各自的修订核对消费。显式替换草稿后，旧绑定的无 scope 记录也不能清空新草稿。视图只释放自身订阅和展示扩展，不关闭宿主 source、台账、连接或后台任务。`onBindingDiagnostic` 接收不含正文的操作身份、阶段、结果、耗时和安全错误码。

主题、语言、按钮呈现、Flow 功能和诊断回调属于视图级配置，不随 `ChatBinding` 更换。宿主展示插槽会在替换时重新挂载，应只释放其返回对象持有的资源。预览页面提供“切换绑定，保留输入”按钮，`?retain=1` 可运行输入 DOM、草稿、光标及焦点检查。

ChatView 自带输入卡片、右侧用户气泡、工具栏、提问目录和移动端样式，不需要 NestOS 的 CSS 才能呈现完整界面。`style.css` 统一加载基础布局、默认外观和目录样式。宿主可通过 `--llm-color-primary`、`--llm-color-primary-hover`、`--llm-bg-primary`、`--llm-bg-secondary`、`--llm-bg-tertiary`、`--llm-text-primary`、`--llm-text-secondary`、`--llm-border-color` 与 `--llm-font-family` 接入已有主题；未提供时使用库内默认值。`presentButton` 可以替换图标，按钮保留可访问名称和 `data-chat-action`，图标通过通用 `data-chat-icon` 获得相同尺寸和状态样式。

运行 `pnpm exec vite --host 127.0.0.1` 后打开 `/examples/chat-preview.html`，可并排操作默认主题和定制主题两个独立实例。示例仅消费本库和 mdxeditor，通过内存宿主完成提交及回执核对，不调用执行后端。

兼容编辑器可直接实例化 `PromptNavigator`，提供 `root`、`history`、`trigger`、`getRows()` 和 `reveal(id)`。目录共用 ChatView 的 DOM、样式、最近优先排序、全文过滤、100 条增量展示、开头/中间/最近定位及键盘操作；`setEarlier` 只呈现宿主的分页状态，读取更早历史必须由用户明确触发。目录不理解 Session、执行树或分支协议，宿主负责投影消息身份和展开目标。`destroy()` 释放监听、待执行帧和定位标记，不关闭宿主数据源。

`ScrollController` 统一内容及视口变化时的末尾跟随、阅读旧消息时的位置保护、流式切换与显式定位。`shouldSubmitMessage` 和 `resizeMessageInput` 统一桌面/触屏回车、IME 及输入框高度规则；旧编辑器可复用这些机制而不另写一套。

宿主通过 `configureInput(input, expectedRevision)` 原子修改选择与目标；草稿变化时拒绝过期写入，不替换输入 DOM。`inputContext()` 让宿主插件使用真实 textarea 与编辑方法，`removeAttachment({id, fileId, revision})` 按版本移除，适用于 OCR 等异步审阅。

`messageActions` 与 `attachmentActions` 注入宿主动作；消息编辑/重试仍使用正式操作台账。`revealMessage` 只展开消息外壳，不展开引用或结构化参数；`scrollHistory`、`openPrompts`、`print`、`collapseCurrent` 与 `disclosureState` 为宿主导航提供正式端口。原生分页可设置 `promptHistoryPages`：仅显式打开目录且尚无用户提问时有限读取，失败或隐藏即停止。

`captureRecovery()` 捕获真实输入文字、附件、选择区及焦点，`restoreRecovery(snapshot)` 核对会话身份后恢复。上传或绑定准备期间返回 RECOVERY_BUSY；宿主仍负责持久资源、停止旧视图写入及恢复操作台账。

草稿转正的 `prepareSend` 在登记操作前完成同视图交接；转正后按新绑定目录解释原冻结命令，未知命令保留输入。宿主目录可用 `dispatch: 'send'` 将命令交给正常消息准备和单份发送台账，避免嵌套派发；命令名与业务执行策略仍归宿主。

## Flow

可独立复用参数表单，不必加载聊天或连接执行服务：

```ts
import { renderParameterFields, readParameterFields } from '@nestos/llm-ui/forms';
import '@nestos/llm-ui/forms.css';

const fields = [{ name: 'limit', type: 'number', minimum: 1, default: 10 }] as const;
container.innerHTML = renderParameterFields(fields, { mode: 'defaults' });
const defaults = readParameterFields(container, fields, { mode: 'defaults' });
```

`mode: 'defaults'` 的空值表示继承，布尔值可选择继承/开启/关闭；`mode: 'run'` 使用定义默认值并校验必填、数值边界、整数及 JSON。宿主通过 `labels`/`error` 翻译，通过 `classes`/`optionLabel` 调整展示，通过 `renderField`/`parseField` 替换特殊控件。嵌入其他表单时可用 `namePrefix` 隔离原生控件名称，返回值仍使用原定义字段名。自定义控件保留同索引 `data-parameter` 的原生值控件，事件与释放归宿主。公共表单不读取 Flow 目录、版本、连接、凭据或存储。

默认 Flow 检查器也使用这套字段组件，通过 `parameterForm` 调整通用字段；`mountInspector` 可替换整个面板。MindOS 的智能体默认配置与 Flow 运行参数面板复用同一表单，业务连接校验、图片上传与运行仍由适配层执行。

Flow 是本库的一部分。聊天集成通过 features.flow 控制，默认关闭；只有启用并点击入口后才加载 Flow 代码：

```ts
const view = await createChatView(container, {
    source, actions, operations,
    features: { flow: true },
    flow: { source: flowSource, actions: flowActions, operations },
});
await view.setFlowEnabled(false);
await view.setFlowEnabled(true);
```

禁用隐藏入口并释放 Flow 视图，不取消后台执行。启用必须提供 flow 绑定；可在初始化时传入绑定但保持关闭。也可直接通过可选子入口单独创建 Flow 视图：

```ts
import { createFlowView, createOperationLedger } from '@nestos/llm-ui/flow';
import '@nestos/llm-ui/flow.css';

const flow = await createFlowView(container, {
    source: flowSource,
    actions: flowActions,
    operations: createOperationLedger(),
});
```

通用视图提供节点面板、端口连线、拖动、节点参数编辑、保存/运行/停止和执行输出。宿主通过 FlowSnapshot 投影节点类型、参数字段、端口、权限和运行状态，通过具名 callback 执行修改，不需要库理解具体插件名或业务模板。复杂节点检查器可通过 mountInspector 注入，并在卸载时释放。

节点编辑携带 expectedRevision；连线、保存和运行使用 graphRevision，它不随流式运行状态推进。取消固定 executionRef，unknown 通过同一宿主台账恢复核对。没有 action 的视图只读，销毁不停止执行。Flow 的存储、编译、运行和 MindOS 专有节点规则位于适配层及宿主。

## 宿主契约

- source 是唯一会话事实输入；读取不进行网络 I/O。快照及消息不可原地修改。一个 source 对应一次会话/分支观察绑定，多个窗口可各自绑定同一会话。
- `conversationId` 是跨绑定的稳定关联，`viewId` 是绑定实例身份。两者不代替授权。消息 revision 只在该消息变化时递增；snapshot revision 仅表示发布顺序。
- `accepted` 表示宿主接管提交内容、后续处理及失败恢复责任，不表示模型或任务已完成。内存宿主只保证实例寿命；持久宿主须提供持久接纳证据或可靠待发送记录。
- 宿主在 `snapshot.operationReceipts` 提供的持久接纳回执，以及关联 operationId 的 confirmed 用户消息，都可确认提交。optimistic 消息不清理草稿。accepted 清理对应草稿，正式用户消息出现后才替换临时气泡，并记录已经观察到正式消息，分页或重开不会复活临时卡片；assistant/tool 消息不会按 submissionId 合并。
- 有写操作的宿主必须实现 reconcile。unknown 不判失败、不自动重发，也禁止把同一待核对提交换新 ID 再发；查询不到记录仍可返回 unknown。
- 待核对的 edit/retry 锁定目标消息，respond 锁定请求 ID/revision；审批 accepted 后等待权威请求更新。Flow 恢复的 submitting 与 unknown 操作均可手动核对。
- 操作台账由宿主持有。`createOperationLedger({ initial, save })` 可接入持久化；register 保存成功后才派发操作，settle 保存成功后才发布结果。重新打开传入同一台账和持久草稿。多视图持久化可使用 `mergeOperationRecords(saved, proposed)` 合并，并在宿主原子条件写入成功后从 save 返回合并快照；库先核对该快照包含提议操作，再发布。冻结身份冲突或矛盾终态报错，旧 submitting/unknown 不覆盖终态。save 返回 void 的既有单视图端口保持兼容；没有原子条件写入的读合并写不保证并发安全。
- 接纳确认不会被迟到网络异常降级。矛盾的终态回执通过台账 onError 交给适配层核对；UI 不采用最后到达者覆盖。
- edit/retry 携带目标消息 revision。宿主进行权威版本检查；产生分支后由宿主创建新的绑定和 ChatView。cancel 必须核对不透明 executionRef。
- 宿主负责 refresh、分页和增量之间的数据新鲜度与合并。递增本地 revision 不代表上游数据更新。

## 草稿与扩展

草稿包含独立 textRevision 与附件项 ID。附件资源 ID 可以复用，草稿项 ID 不复用。上传期间不能提交；移除或销毁后，迟到上传结果不能恢复附件。saveDraft 串行合并，flushDraft 包括调用前仍在防抖中的编辑，失败不会标记为已保存。

宿主可投影 `snapshot.inputContract = {targetId, signature: {id, revision, digest}, label}` 开启参数 JSON 编辑器。`view.setArguments(json)` 与编辑器操作修改同一份 `draft.input` 原文和修订；无效 JSON 原文仍可保存，但禁止发送，不回退到旧有效值。参数根值限定为对象，可发送 `{}`、纯参数和全默认调用；无契约时普通聊天仍要求文字或附件。正文中的 JSON 保持普通文字。

`MessagePart.kind = 'json'` 用专用内容块展示结构化值，默认折叠，展开才填充格式化正文；更新保留展开状态，内容以文本节点显示。复制消息包含完整 JSON；打印当前 DOM 只包含已展开加载的 JSON 正文。`getOperationCallInput(record)` 可读取既有台账中的冻结调用参数，临时提交卡片和 MindOS Session 投影共用该数据，不把参数拼成模型 Markdown。

`ChatSubmission.input` 携带目标、签名及解析后的显式 values；宿主负责默认值、schema、绑定、资产与权限的最终准入。可注入纯函数 `validateInput` 提前反馈字段约束，不能替代后端校验。目标或签名改变后保留原参数，需用户检查并重新应用；移除目标后须显式处理残留参数。接纳只清理修订仍匹配的参数，命令接纳不消费参数草稿。表单与 JSON 的统一视图、异步 readiness 和通用文件传输仍由宿主进一步接入。

支持 approval、text、single-choice、multi-choice；请求事实状态与本窗口提交状态分别管理。复杂块使用显式登记的 `renderers`；注册代码是可信宿主扩展，不是沙箱。未知扩展显示占位，Markdown 围栏不能登记扩展。

Markdown 使用 literal HTML 策略及链接/图片协议限制；附件由 AssetProvider 经宿主权限边界读取。打印使用同一份已渲染内容。`searchResources` 接入文件提及，`selectors` 展示宿主选择器并在提交时捕获值，`mountToolbar` 接入应用动作。`mountComposerMenu` 将宿主控件挂到输入更多菜单，`mountComposerStart` 挂载输入栏起始控件，两者随绑定更新和释放；`ToolbarContext.headerMenu` 共用标题栏更多菜单，`data-chat-overflow` 将宿主控件收入窄屏菜单；选择器的 `placement: 'end'` 放到输入栏右侧、`placement: 'more'` 收起高级选项，`combineWith` 合并父子控件且仍保存原字段。

隐藏暂停昂贵呈现，仍处理操作和草稿确认。destroy 幂等，尝试全部清理后汇总异常；它不关闭 source、操作台账或共享运行时，不取消后台任务。

## 输入能力与 slash 命令

UI 不解析 LLMConnection、MCP connection 或 harness 的内部配置。宿主向 `snapshot.selectors` 提供选择器，`variants` 可按一个独立父选择器的当前值切换选项，例如模型切换推理档位。子选择随父值隔离，已经移除的选择器不进入 `ChatSubmission.selection`。

`snapshot.commands` 是当前绑定内可用命令的集合，`actions.command(input, context)` 是唯一提交入口。`composeCommandCatalogs` 合并各来源贡献，保留 `source`、局部 `commandId`、命名空间后的 `id` 与 `revision`；同名命令在菜单中并列展示来源，手工输入有歧义时要求选择。候选点击或 Enter 补全不执行，下一次明确提交才执行。

命令意图包含目标 ID、expectedRevision、原始文字、参数、kind 和捕获的 selection。执行方重新校验能力与版本。`action` 命令不创建临时用户消息；`prompt` 命令沿用提交确认与正式消息替换。未知回执保留草稿、核对原 operationId，不自动重放，不回退为普通模型请求。旧宿主没有 commands 投影时保留普通输入行为。

各功能只贡献自身公开、当前可用的命令。UI、宿主、Agent、Flow、当前 harness 的贡献可合并；权限、会话状态、初始化条件由宿主过滤。MCP tool 或内部函数不自动成为 slash 命令。完整可运行的声明、分来源路由与回执示例见 `examples/memory-host.ts` 的 View/Agent 命令目录。

## 验证

```bash
pnpm --filter @nestos/llm-ui typecheck
pnpm --filter @nestos/llm-ui test
pnpm --filter @nestos/llm-ui build
```

构建检查源码、JavaScript、声明和发布出口。工作区使用源码入口，发布 tarball 使用 dist 入口；消费类型使用 TypeScript bundler 解析。浏览器样式由宿主显式导入。

图片预处理及多图编辑通过可选 `ChatOptions.imageEditing` 注入，端口提供 `prepare`、`uploaded` 和 `edit`；宿主负责资源与原图元数据持久化。库本身不依赖图片处理包。编辑替换按附件项、资源 ID 与 revision 整组核对，发送接纳保留等待期间产生的新版本。

ImageEditingPort may expose getRevision, subscribe and refresh to regenerate existing attachments when host policy changes. Upload and replacement results are fenced by policy and attachment versions; failures block submission until retried or removed. The host continues to own original resources and durable metadata.

`createInteractionCard` 可选接收 `draft` 和 `onDraftChange`，`getDraft()` 返回独立的编辑快照，保留未勾选的自定义选项文字与审批备注。恢复草稿不触发提交；密码字段不捕获也不恢复。宿主按实际交互及修订隔离草稿，负责持久化、冲突和回答接纳后的清理；卡片不持有存储，也不把保存草稿视为回答已接纳。

宿主可通过 `ChatView.setContext(JsonValue)` 设置不透明的上下文选择，`ComposerDraft.context` 保存值及独立修订，`ChatSubmission.context` 随发送冻结其值。`null` 表示显式清除；持久接纳只清理匹配的原修订，保留等待期间的新选择。此字段复用 `initialDraft` / `saveDraft` 与原操作台账，不持有上下文目录、原生会话或授权规则；命令提交不消费该选择。

## 0.3 共享机制与绑定所有权

ChatBinding 的 `setActive?(active)` 和 `release?()` 由库调用；初始化失败、替换失败、旧绑定退役和最终关闭均释放相应绑定一次。先销毁订阅和插槽，再释放宿主为该绑定创建的资源；共享 source、连接及后台任务仍归宿主。无需覆写 `replaceBinding`、`setActive` 或 `destroy`。

`translate(key, params?)` 接收命名参数，例如目录计数的 `{count, total}`。未覆盖的文案由库格式化；宿主可使用自己的占位符和语序。`CHAT_SLOT_CLASSES.toolbar/menu` 是宿主挂载工具栏和菜单的正式样式契约。

`InputPluginRegistry` 提供有序注册和编辑钩子，ChatOptions.plugins 可直接接入 Composer。`PopupPanel` 是候选列表的共享视图，位置与业务选项由宿主提供；关闭视图必须调用 destroy。`DisclosureController` 管理折叠状态、批量操作及视口导航；ChatView.setAllCollapsed 可控制已加载消息部件。`TtyPanel` 只展示有界输出与实际退出码，不拥有进程。DOMCache、事件清理和滚动工具从根入口导入。

`@nestos/llm-ui/flow` 导出 GraphCanvas，用展示节点、端口和边接入拖拽与连线；回调捕获展示修订，隐藏或销毁取消在途手势。`@nestos/llm-ui/forms` 导出 SchemaForm，与 ParameterForm 共用叶字段渲染和读取；表达式只通过 acceptValue 注入。分别导入 flow.css/forms.css 使用独立样式。

产品可设 `inputPresentation: 'host'`，由既有宿主准备流程打开参数表单，输入区不展开 JSON 编辑器；独立视图默认保留内联编辑。目录 `autoSelectFirst: false` 要求宿主恢复偏好或用户明确选择，不自动选择首项。

`ConversationSnapshot.composerIndicators` accepts optional host-owned `{id, label, value, detail?, tone?, progress?}` observations. The composer shows indicators inline beside the attachment control; optional normalized progress draws a segmented meter, with null distinguishing unknown occupancy from zero. Touch and keyboard users can expand the bounded details panel above the action row. Snapshot updates preserve the input DOM, draft and disclosure state; replacing a binding clears old indicators. The library does not interpret account, quota, cost or context policies and does not fetch data or change send availability.

## Optional OCR and grouped tool output

Pass `ocr: {recognize(image, signal)}` to `createChatView` to enable image text extraction. `assets.read` supplies the image by default; optional `ocr.read` and `ocr.prepare` ports support authorized asset stores and host preprocessing. The view owns progress, cancellation, retry, editable review, insertion and attachment identity checks. No OCR connection, provider, prompt or configuration editor is bundled. Without the port there is no OCR action. Safe phase diagnostics are available through `ocr.onDiagnostic`.

Consecutive tool messages and consecutive tool parts within a mixed assistant message share a collapsed output group. Counts and running/failure status remain visible. Historical pagination and live updates retain the group's original nodes and user expansion; User prompts separate groups. Hosts can supply toolGroupId to keep a turn’s tools in one record across assistant prose; prose stays outside the record, while intervening reasoning can remain inside. Collapse is presentation only: source history, tool results and execution state are never removed or rewritten.

## Optional settings

Import `createSettingsUI` from `@nestos/llm-ui/settings` and styles from `@nestos/llm-ui/settings.css`. The factory returns constructors for Agent, Provider, Connection, MCP, Skill, SystemPrompt, ModelDefaults and Cost editors, plus OCR configuration fields. Each factory has its own presentation and callback context.

Supply a `SettingsHost` with translations, trusted icons, validation/config codecs and optional option preparation. Editors receive structural service ports; `SettingsEditorOptions` accepts navigation, one-shot anchor hints, resource rename/metadata callbacks and host slots. No backend, VFS, routing or storage policy is bundled. Credential storage notices and icon choices are optional host presentation. Server-side publication and revision checks stay in the supplied service. The main Chat/Flow entries do not load settings.


## 内容视图与消息时间

消息外框复用 mdxeditor 的 ContentView，历史通过 ContentListView 保留稳定 DOM；工具分组、权限与消息分页仍由 ChatView 管理。正文仍按稳定 part 持有 MDxRenderer，流式更新不重建外框。可选 `onContentSelection(selection, signal)` 将单项或跨项选区交给宿主，库只展示 AI 入口，不持有 Session 服务。

`ChatMessage.timing` 可提供 `submittedAt`、`startedAt`、`completedAt`、失败/取消的 `endedAt`，单位为 Unix 毫秒；`scope: 'message' | 'turn'` 区分响应耗时与整轮耗时。用户显示发送时间，助手终态显示完成/失败/停止时间，生成期间仅更新状态时钟；隐藏时停止时钟，时间不表示执行存活。缺失完成时间不补造，旧 `timestamp` 对助手仅标为“记录于”；点击时间可查看完整日期。宿主 OperationRecord 的 submittedAt 随冻结提交保存，准备耗时、重试、正式消息替换不能重置发送时间。

提问目录的行视图和键盘导航复用 ui-common `OutlineView`，窗口身份由 mdxeditor `ContentListView` 管理。宿主仅为用户消息提供“提交时间（缺失时使用记录时间）+ 提问摘要”的可选名称；助手回复不进入窗口索引。名称更新不替换消息 ID、内容框或编辑状态，搜索及更早历史仍沿用明确操作。

Queued native input may carry `recovery.required` and a host-provided `ChatMessage.statusLabel`. The folded queue highlights required recovery, and the message header can explain a missing terminal receipt without changing message state, content revision or admission evidence. Recovery and dispatch remain host-owned.
