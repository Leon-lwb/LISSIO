import type { ReactElement, ReactNode } from 'react';
import {
  render,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import { I18nextProvider, i18n } from '../i18n';

interface I18nRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  wrapper?: (props: { children: ReactNode }) => ReactElement;
}

/** 测试统一入口：所有组件测试都在 react-i18next Provider 下渲染。 */
export function renderWithI18n(
  ui: ReactElement,
  options: I18nRenderOptions = {}
): RenderResult {
  const { wrapper: TestWrapper, ...rest } = options;
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => {
    const content = TestWrapper ? <TestWrapper>{children}</TestWrapper> : children;
    return <I18nextProvider i18n={i18n}>{content}</I18nextProvider>;
  };
  return render(ui, { ...rest, wrapper });
}
