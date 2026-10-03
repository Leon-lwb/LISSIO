import { screen } from '@testing-library/react';
import { renderWithI18n } from '../../../../test/renderWithI18n';;
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { translate } from '../../../../i18n';
import { RawDataBackToLatest } from '../RawDataBackToLatest';

describe('RawDataBackToLatest', () => {
  // i18n 缺键会回退为 key 本身 — 回退即视为漏配 (中英任一缺失都拦在这里)
  it.each(['zh', 'en'] as const)('%s: 有可访问名称且不是 key 回退', (lang) => {
    renderWithI18n(<RawDataBackToLatest lang={lang} onClick={vi.fn()} />);

    const label = translate('rawDataBackToLatest', lang);
    expect(label).not.toBe('rawDataBackToLatest');
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });

  it('点击触发回到最新', async () => {
    const onClick = vi.fn();
    renderWithI18n(<RawDataBackToLatest lang="zh" onClick={onClick} />);

    await userEvent.click(screen.getByRole('button'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
