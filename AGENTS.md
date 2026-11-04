# llm-ui

独立的原生 DOM Chat + Flow 库，直接运行时依赖为 `@itookit/mdxeditor` 与零依赖的 `@itookit/ui-common`。

- ChatView 与兼容产品编辑器共用 PromptNavigator、ScrollController、输入回车和高度规则；目录通过 getRows/reveal 注入身份与 DOM，不查询 Session 或执行协议。默认聊天及目录外观归本库，宿主仅注入主题变量、图标和业务插槽。示例为 examples/chat-preview.html。

- `contracts.ts` 定义展示投影、具名操作、草稿与宿主持有的操作台账；不得导入 Session、Task、后端 Flow、VFS 或应用类型。
- `createChatView` 只拥有自己的 DOM、订阅、Markdown renderer 和局部异步读取。销毁不关闭 source、台账、共享连接或后台任务。
- replaceBinding 保留输入/历史 DOM，先保存旧草稿再安装新绑定；失败用 bindingCommitted 区分是否已安装。动作、台账及分页读取冻结在其原绑定，不把迟到结果应用到新视图。显式更换草稿以 scopeId 或绑定身份隔离消费；不同 conversationId 必须提供目标草稿。主题与语言等视图配置保持不变。
- 接纳确认与正式消息替换分开；匹配 operationId 的宿主持久 operationReceipts 或 confirmed 用户消息可以提供接纳证据。队列接纳不伪造已执行历史，未知操作不自动重发。
- 提交限制归操作台账与注册阶段，不等待原发送 Promise；已接纳操作允许后续新提交，旧 finally 不释放新操作的限制。Flow 的具体执行取消不受未知编辑或启动回执阻塞；同一取消仍按执行身份去重。
- onDiagnostic 仅接收操作身份、阶段、结果、耗时与安全错误码，不记录正文或完整参数，回调失败不改变业务结果。
- 文字按 textRevision 清理，附件按草稿项 id、资源 id 和 revision 清理；上传成功必须核对原草稿项仍有效。
- 结构化参数由 inputContract 提供目标及签名，draft.input 保留 JSON 原文和独立修订；无效原文阻止提交，目标变化保留参数并要求重新确认。参数、默认值及零参数入口不要求正文。validateInput 只提供宿主提前反馈，最终准入仍归宿主；命令不消费参数草稿。
- 自定义 renderer 是可信宿主代码；模型 Markdown 不登记扩展。显示和打印共用内容策略。
- json part 默认折叠，展开才填充纯文本 JSON，更新保留当前 details；复制包含结构化值。参数从冻结的操作输入投影，不伪造持久用户历史；未展开正文不会出现在当前 DOM 打印中。
- MindOS 业务兼容工厂在主仓库的 `ui/llm-ui-adapter`，不属于本独立仓库；通用 Flow 视图通过本包 `/flow` 提供。
- 验证：`pnpm typecheck`、`pnpm test`、`pnpm build`；构建扫描源码、JS 和声明的外部依赖。

图片能力由可选 ImageEditingPort 注入预处理、上传后元数据保存与整组编辑；本包不依赖 image-parser。编辑结果需按原附件及版本整体核对，销毁或隐藏后丢弃迟到结果，不关闭共享端口。

操作身份和上传项身份统一使用包内 randomUUID 兼容工具，支持原生方法缺失或抛错；不因此增加 common 依赖。Chat/Flow 回归覆盖这些入口；MindOS 集成另有 uuid:check。

输入能力由 snapshot.selectors / commands 投影；命令 source、稳定 id 与 revision 一起捕获，选择候选只补全，明确提交才走 actions.command 及操作台账。composeCommandCatalogs 保留不同来源的同名命令，禁止按注册顺序覆盖或失败后回落给模型。action 命令不伪造用户气泡；prompt 命令沿用正式用户消息替换。选择器 variants 只支持一个独立父项，值随父项作用域切换，移除的选择器不能残留在提交中。

ImageEditingPort 的 getRevision/subscribe/refresh 驱动已上传附件重算；处理与失败阻止提交，旧代次按附件 ID、资源和 revision 整体拒收。输入隐藏暂停重算；销毁释放本视图策略订阅，宿主继续拥有共享端口。

InstructionQueueView 只持有队列 DOM 与局部编辑文本，标签及 read/edit 端口由宿主注入；正文保存使用开始编辑时的 revision，通知不能静默升级条件。视图不接纳或派发指令、不拥有共享队列生命周期，本地和远程适配共用此组件。

initiallyCollapsed 只决定初始展示；收起入口保留数量与失败/待核对状态。开关始终可用，不受只读或在途编辑影响，也不调用 read/edit；切换保留 DOM 中的编辑、勾选与滚动位置，通知保留折叠状态和编辑时的原 revision。图标与展开/收起标签由宿主注入。

队列阻塞原因可以随观察在同一 revision 下改变；只更新 reason 展示，不能借此替换同修订的正文或提升正在编辑的 CAS 条件。

snapshot.operationMessages 只覆盖已接纳输入的临时展示，null 可隐藏合并或移除的预览；不修改冻结操作、不充当接纳证据或正式历史。InstructionQueueSnapshot 的可选时间由宿主提供，旧记录缺失时间不补造。

CommandDefinition.execution 与 CommandSubmission.execution 冻结 query/serial 分类；query 必须是 action。查询报告未知时允许用户显式创建新的只读观察，旧记录保留；不自动重放修改。已接纳查询的迟到发送 Promise 不阻止下一次同命令查询，恢复按冻结分类交给宿主。

OperationLedger 的 save 可返回实际持久合并快照；库核对提议操作被保存后才发布，不用本地旧快照覆盖返回值。mergeOperationRecords 只提供纯台账合并：独立操作取并集、冻结身份冲突报错、终态不可回退、矛盾回执报错。宿主负责原子版本条件写入及丢写回执核对；本库不持有 Session 存储或重放业务操作。register/settle 在进入异步队列前复制实参。

绑定生命周期统一由 ChatView 调用 ChatBinding.setActive/release，宿主不得 monkey-patch 实例。插件注册、PopupPanel、DisclosureController、TtyPanel、DOMCache 为共享机制；GraphCanvas 从 /flow 导出。SchemaForm 递归布局与参数表单共用 form-fields，不内置 Flow 表达式或插件名。translate(key, params) 传命名参数，禁止宿主传字面占位符逆适配。

composerIndicators 是宿主提供的通用只读展示 DTO，库不解释额度、费用或账户策略。ComposerIndicators 只更新独立摘要与明细 DOM，不改变输入、选择器、提交资格或草稿；更新保留 disclosure 展开状态，更换绑定清理旧指标。摘要与附件加号位于同一操作行；progress 为归一化占用，null 用虚线表示未知，不能显示为空用量。手机保留紧凑分段条及预算文字，点击后在工具栏上方展开有界明细；所有内容用 textContent，不依赖 title/hover 获取详情。

宿主可通过 resolveSubmissionMode(draft, snapshot) 按当前选择投影 send/queue/steer 按钮；该回调仅控制呈现，实际发送由宿主重新校验。选择变化立即刷新按钮，不重建输入或清空草稿。

输入菜单与 PopupPanel 通过 observePopupDismiss 在捕获阶段监听 pointerdown/click/Escape，弹层打开即注册，不能依赖下一帧；外部操作照常执行。aria-controls 关联的 portal 子弹层（含搜索）属于菜单内部，不能在选项执行前误关父菜单；destroy 释放监听，PopupPanel 隐藏时也释放本次监听。

InstructionQueueView 的可选 recovery.id 可在同 revision 的超时投影中出现，须独立更新展示；recover 需二次点击确认，revision 或目标变化清除确认，不提升旧 CAS。未知结果恢复记录即使队列为空也可展示；执行权威、停止与恢复校验均由宿主负责。

ToolbarContext.header 公开 title/status/extra/primary/menu/menuBody 原节点，供宿主注入完整标题布局。库继续维护标题与按钮行为，不导入宿主组件；默认布局和未提供挂载回调的独立使用保持可用。额外标题工具统一进入 extra 容器，重绑定与销毁必须释放宿主布局租约。

OCR is an optional ChatOptions.ocr port. The library owns review, cancellation, retry and version-checked attachment consumption; hosts own recognition, asset permissions and model configuration. Preserve input on errors and discard stale work after hide, destroy or replacement. Diagnostics never include file names, source images, recognized text or raw error messages.

Consecutive tool messages and adjacent tool parts share ToolOutputGroups disclosures. Both historical and live projections use the same renderer; status updates and prepended pages must retain user expansion and DOM identity. User messages break groups. Without a host toolGroupId, prose breaks groups; with an explicit presentation scope, tools share one record across prose while prose remains visible. Intervening reasoning can remain inside the record. Do not fold or truncate execution facts in the transport to implement a UI preference.

## Optional settings entry

`@itookit/llm-ui/settings` owns configuration editors and forms. `createSettingsUI(host)` binds each instance to injected labels, icons, validation/codecs and navigation/resource capabilities. Settings must not import application packages, VFS, backend services or process-global configuration. NestOS integration belongs in `ui/llm-ui-adapter/src/settings/`. Shared lifecycle, autosave and recovery belong in ui-common. The main chat and Flow entries must not load settings or settings styles.
