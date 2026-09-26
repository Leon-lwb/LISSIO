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
    assert_eq!(catalog.contract_version, 1);
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
