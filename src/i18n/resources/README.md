# 文案资源目录

文案按产品能力拆分为同名模块，语言目录保持一一对应：

```text
src/i18n/resources/
  zh/
    navigation.yml
    widgets.yml
    ai-control.yml
    workspace.yml
    settings.yml
    custom-widgets.yml
    onboarding.yml
    panels.yml
    decoder.yml
    analysis.yml
    layout.yml
  en/
    ...
```

约定：

- 文件名使用英文小写 kebab-case，描述一个稳定的产品能力域。
- 两个语言目录必须包含完全相同的文件名和翻译键。
- 每个文件只维护本能力域的扁平键；键名保持全局唯一，不使用 namespace 前缀。
- 新增用户可见文案时，在对应能力域的两个语言文件中同步添加。
- 运行时由 `src/i18n/resources.ts` 合并为 i18next 的 `translation` 资源。
