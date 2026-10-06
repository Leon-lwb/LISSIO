# i18n

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: src/i18n/README.md
applies-to: Non-authoritative Chinese translation backup
-->

> 中文翻译备份；对应的英文源文件为权威版本。若中英文不一致，以英文为准。
> Chinese translation backup. The English source is authoritative; English controls in case of conflict.

本目录以 `i18next` 作为翻译运行时，以 `react-i18next` 作为 React 绑定。

- `resources.ts` 负责加载并校验资源；资源目录约定见 `resources/README.md`。
- `instance.ts` 创建全局 i18next 实例，并提供非 React 代码使用的 `translate`。
- React 组件使用 `useTranslation()`；应用根节点由 `I18nextProvider` 提供实例。
- `Lang` 与 `settings.general.language` 保持一致，设置切换时调用 `changeLanguage`。
- 缺失键返回键名，和旧实现保持可诊断的降级行为。