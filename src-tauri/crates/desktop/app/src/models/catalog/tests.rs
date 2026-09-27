use super::*;

/// 测试用最小 AI provider 描述 (生产由 L4 组合根注入)。
fn sample_provider() -> ModelDescriptor {
    ModelDescriptor {
        id: "aiProvider:openai".into(),
        family: ModelFamily::AiProvider,
        schema_version: 1,
        display: ModelDisplay::fallback("OpenAI"),
        ui: ModelUiHints::default(),
        configuration: open_schema(),
        default_config: Value::Null,
        variants: Vec::new(),
        actions: vec![ModelAction::Configure],
        availability: ModelAvailability::AVAILABLE,
    }
}

fn catalog() -> ModelCatalog {
    let registry = device_tree::DriverRegistry::new();
    let providers = vec![sample_provider()];
    build_model_catalog(CatalogSources {
        drivers: &registry,
        ai_providers: &providers,
    })
    .expect("catalog builds")
}

#[test]
fn catalog_contains_all_families() {
    let catalog = catalog();
    assert_eq!(
        catalog.contract_version,
        data_model::model_descriptor::MODEL_CATALOG_CONTRACT_VERSION
    );
    assert!(catalog.revision.starts_with("rev-"));
    let families: std::collections::BTreeSet<_> = catalog.models.iter().map(|m| m.family).collect();
    for family in [
        ModelFamily::Widget,
        ModelFamily::Protocol,
        ModelFamily::Device,
        ModelFamily::PointSelector,
        ModelFamily::AiProvider,
    ] {
        assert!(families.contains(&family), "missing family {family:?}");
    }
}

#[test]
fn panel_catalog_covers_every_declared_panel_exactly_once() {
    let catalog = catalog();

    // 12 类面板: 10 个宿主控件派生 + 2 个无宿主的整库面板
    assert_eq!(catalog.panels.len(), 12, "面板目录条目数");
    let ids = catalog
        .panels
        .iter()
        .map(|p| p.id.clone())
        .collect::<Vec<_>>();
    let unique = ids.iter().collect::<std::collections::BTreeSet<_>>();
    assert_eq!(unique.len(), ids.len(), "面板 id 唯一");

    // 与控件注册表一一对应 (无第二张手写表)
    let declared = kind::widgets::definitions()
        .filter_map(|def| def.panel.map(|spec| (def.kind, spec.panel)))
        .collect::<std::collections::BTreeMap<_, _>>();
    assert_eq!(declared.len(), 10);
    for (host, panel_kind) in &declared {
        let found = catalog
            .panels
            .iter()
            .find(|p| p.kind == *panel_kind)
            .unwrap_or_else(|| panic!("{host}: 面板未进入目录"));
        assert_eq!(
            found.host_widget_kind.as_deref(),
            Some(*host),
            "{host}: 宿主控件回填"
        );
        assert_eq!(
            found.display.category.as_deref(),
            Some("derived"),
            "{host}: 分组"
        );
    }

    // 整库面板: 无宿主, Singleton 绑定, 空端口
    for kind in [PanelKind::Can, PanelKind::Logic] {
        let panel = catalog
            .panels
            .iter()
            .find(|p| p.kind == kind)
            .unwrap_or_else(|| panic!("{kind:?} 面板未进入目录"));
        assert!(panel.host_widget_kind.is_none(), "{kind:?}: 无宿主");
        assert_eq!(panel.binding, PanelBinding::Singleton);
        assert!(panel.inputs.is_empty() && panel.outputs.is_empty());
        assert_eq!(panel.display.category.as_deref(), Some("standalone"));
        assert!(panel.data_plane.push_request.is_some());
        assert!(panel.data_plane.fetch_op.is_some());
        assert!(panel.default_params.is_null());
    }
}

#[test]
fn panel_catalog_publishes_binding_and_ports_for_host_widgets() {
    let catalog = catalog();

    // Waveform: EdgeBound 展开为宿主的真实通道口 (CH0..N), 而不是参数无关形式
    let waveform = catalog
        .panels
        .iter()
        .find(|p| p.kind == PanelKind::Waveform)
        .expect("waveform panel");
    assert_eq!(waveform.tab_type, "waveform-extra");
    assert_eq!(
        waveform.display.label_key.as_deref(),
        Some("dataTabWaveform")
    );
    assert_eq!(waveform.data_plane.delivery, PanelDelivery::Both);
    assert_eq!(
        waveform.binding,
        PanelBinding::EdgeBound {
            input_handles: vec![
                "CH0".to_owned(),
                "CH1".to_owned(),
                "CH2".to_owned(),
                "CH3".to_owned(),
            ],
        }
    );

    // RawData: 由参数持有端口引用, 静态回退口是 "data"
    let raw = catalog
        .panels
        .iter()
        .find(|p| p.kind == PanelKind::Raw)
        .expect("raw panel");
    assert_eq!(
        raw.binding,
        PanelBinding::ConfigBound {
            config_key: "selectedInput".to_owned(),
            port_template: "src:{source}:{handle}".to_owned(),
        }
    );
    assert_eq!(raw.inputs.len(), 1);

    // Image: 面板已声明但数据面尚未实现 — 两个操作都不下发
    let image = catalog
        .panels
        .iter()
        .find(|p| p.kind == PanelKind::Image)
        .expect("image panel");
    assert_eq!(image.data_plane.delivery, PanelDelivery::Unavailable);
    assert!(image.data_plane.push_request.is_none());
    assert!(image.data_plane.fetch_op.is_none());

    // 排序值 = 投影顺序, 稳定且从 0 起
    for (index, panel) in catalog.panels.iter().enumerate() {
        assert_eq!(panel.display.sort_value as usize, index, "排序值稳定");
    }
}

#[test]
fn revision_changes_when_panels_change() {
    let mut catalog = catalog();
    let before = revision(&catalog);
    catalog
        .panels
        .retain(|panel| panel.kind != PanelKind::Logic);
    assert_ne!(
        revision(&catalog),
        before,
        "面板是目录的一部分, 变化必须换 revision"
    );
}

#[test]
fn widget_models_cover_registry_and_variants() {
    let catalog = catalog();
    let math = catalog
        .models
        .iter()
        .find(|m| m.id == "widget:Math")
        .expect("Math model");
    assert!(math.variants.len() >= 15, "Math 变体来自 Rust 运算定义");
    let add = math
        .variants
        .iter()
        .find(|v| v.id == "add")
        .expect("add variant");
    assert_eq!(add.config_patch["op"], "add");
    let sqrt = math
        .variants
        .iter()
        .find(|v| v.id == "sqrt")
        .expect("sqrt variant");
    assert_eq!(sqrt.config_patch["inputCount"], 1, "一元运算变体强制单输入");

    assert!(
        catalog.models.iter().any(|m| m.id == "widget:RawData"),
        "29 类控件全覆盖"
    );
}

#[test]
fn revision_changes_when_models_change() {
    let mut catalog = catalog();
    let before = revision(&catalog);
    catalog.models.push(ModelDescriptor {
        id: "widget:Bogus".into(),
        family: ModelFamily::Widget,
        schema_version: 1,
        display: ModelDisplay::fallback("Bogus"),
        ui: ModelUiHints::default(),
        configuration: open_schema(),
        default_config: Value::Null,
        variants: Vec::new(),
        actions: Vec::new(),
        availability: ModelAvailability::AVAILABLE,
    });
    assert_ne!(revision(&catalog), before);
}

/// 最小 mock 驱动 — 验证 default_config 与排除规则, 不依赖具体 adapter。
struct StubDriver {
    id: &'static str,
}

#[async_trait::async_trait]
impl device_tree::NodeDriver for StubDriver {
    fn id(&self) -> device_tree::DriverId {
        device_tree::DriverId::new(self.id)
    }
    fn role(&self) -> data_model::device_tree::NodeRole {
        data_model::device_tree::NodeRole::Endpoint
    }
    fn capabilities(&self) -> data_model::device_tree::CapabilityMask {
        data_model::device_tree::CapabilityMask::empty()
    }
    fn config_schema(&self) -> data_model::model_descriptor::ConfigurationSchema {
        data_model::model_descriptor::ConfigurationSchema::open(1)
    }
    fn child_policy(&self) -> data_model::device_tree::ChildPolicy {
        data_model::device_tree::ChildPolicy::none()
    }
    fn default_config(&self, node_id: &str) -> Option<Value> {
        Some(json!({ "stub": node_id }))
    }
    fn validate(
        &self,
        config: &Value,
        _parent: Option<&device_tree::ParentContract>,
    ) -> Result<device_tree::ValidatedNodeConfig, device_tree::ConfigError> {
        Ok(device_tree::ValidatedNodeConfig::new(
            self.id(),
            data_model::device_tree::DEVICE_TREE_SCHEMA_VERSION,
            config.clone(),
        ))
    }
    async fn open(
        &self,
        _config: device_tree::ValidatedNodeConfig,
        _parent: Option<std::sync::Arc<dyn device_tree::NodeRuntime>>,
        context: device_tree::NodeContext,
    ) -> Result<std::sync::Arc<dyn device_tree::NodeRuntime>, device_tree::OpenError> {
        Err(device_tree::OpenError::Driver {
            node_id: context.node_id().clone(),
            driver_id: self.id(),
            detail: "stub driver cannot open".to_owned(),
        })
    }
}

#[test]
fn device_models_follow_registry_registration() {
    let registry = device_tree::DriverRegistry::new();
    registry
        .register(std::sync::Arc::new(StubDriver { id: "stub-a" }))
        .expect("stub registers");
    let providers = vec![sample_provider()];
    let catalog = build_model_catalog(CatalogSources {
        drivers: &registry,
        ai_providers: &providers,
    })
    .expect("catalog builds");
    let device_ids: Vec<_> = catalog
        .models
        .iter()
        .filter(|m| m.family == ModelFamily::Device)
        .map(|m| m.id.clone())
        .collect();
    // simulation 是子节点语义, 不作为独立可创建条目
    assert!(!device_ids.iter().any(|id| id == "driver:simulation"));
    let stub = catalog
        .models
        .iter()
        .find(|m| m.id == "driver:stub-a")
        .expect("stub driver in catalog");
    // 目录 default 预览无实例身份 — 驱动以 driver id 作占位 node_id 派生
    assert_eq!(stub.default_config["stub"], "stub-a");
    assert_eq!(stub.actions.len(), 1, "设备仅支持 create 动作");
}
