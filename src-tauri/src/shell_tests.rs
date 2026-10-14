use super::*;

#[test]
fn tint_keeps_the_theme_channels_and_an_opaque_enough_alpha() {
    // 主题底色必须原样进入 GradientColor, 只有 alpha 由 shell 决定 ——
    // Win10 的 SWCA 亚克力正是靠这个值把背板染成应用主题色。
    assert_eq!(acrylic_tint(Some(&[13, 16, 22])), Some((13, 16, 22, 0x40)));
    assert_eq!(
        acrylic_tint(Some(&[240, 240, 240])),
        Some((240, 240, 240, 0x40))
    );
}

#[test]
fn tint_rejects_input_that_is_not_three_channels() {
    // 自定义 CSS 主题可能给出 var()/color-mix() (前端解析失败后传空数组)。
    // 那时不能让 DWM 收到一个猜出来的颜色, 而要退回它自己的默认 tint。
    assert_eq!(acrylic_tint(None), None);
    assert_eq!(acrylic_tint(Some(&[])), None);
    assert_eq!(acrylic_tint(Some(&[13, 16])), None);
    assert_eq!(acrylic_tint(Some(&[13, 16, 22, 40])), None);
}
