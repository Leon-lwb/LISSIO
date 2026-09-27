use super::*;
use data_model::model_descriptor::{ModelCatalog, ModelFamily, ModelVariant};

fn widget_model(
    kind: &str,
    variants: Vec<ModelVariant>,
) -> data_model::model_descriptor::ModelDescriptor {
    data_model::model_descriptor::ModelDescriptor {
        id: format!("widget:{kind}"),
        family: ModelFamily::Widget,
        schema_version: 1,
        display: data_model::model_descriptor::ModelDisplay::fallback(kind),
        ui: data_model::model_descriptor::ModelUiHints::default(),
        configuration: data_model::model_descriptor::ConfigurationSchema::open(1),
        default_config: Value::Null,
        variants,
        actions: Vec::new(),
        availability: data_model::model_descriptor::ModelAvailability::AVAILABLE,
    }
}

fn layout() -> kind::document::NodeLayout {
    kind::document::NodeLayout {
        x: 10.0,
        y: 20.0,
        width: None,
        height: None,
    }
}

fn catalog() -> data_model::model_descriptor::ModelCatalog {
    let math_with_variants = data_model::model_descriptor::ModelDescriptor {
        variants: vec![ModelVariant {
            id: "add".into(),
            display: data_model::model_descriptor::ModelDisplay::fallback("Math add"),
            config_patch: json!({ "op": "add", "inputCount": 2 }),
        }],
        ..widget_model("Math", Vec::new())
    };
    let models = vec![math_with_variants, widget_model("Knob", Vec::new())];
    ModelCatalog {
        contract_version: data_model::model_descriptor::MODEL_CATALOG_CONTRACT_VERSION,
        revision: "rev-test".into(),
        models,
        panels: Vec::new(),
    }
}

fn create(
    model_id: &str,
    node_id: &str,
    patch: Value,
    variant: Option<String>,
) -> PrepareOperation {
    PrepareOperation::Create {
        model_id: model_id.to_owned(),
        variant_id: variant,
        node_id: node_id.to_owned(),
        tab_id: "t1".to_owned(),
        layout: layout(),
        label: None,
        config_patch: patch,
    }
}

#[test]
fn create_math_via_variant_applies_patch_and_normalizes() {
    let result = prepare_documents(
        &catalog(),
        vec![create(
            "Math",
            "n1",
            json!({ "precision": 4 }),
            Some("add".into()),
        )],
    );
    let prepared = result.items.into_iter().next().unwrap().expect("prepared");
    assert!(prepared.issues.is_empty());
    match &prepared.document.business {
        kind::document::NodeBusiness::Widget {
            widget_kind,
            params,
            ..
        } => {
            assert_eq!(widget_kind, "Math");
            assert_eq!(params["op"], "add");
            assert_eq!(params["inputCount"], 2);
            assert_eq!(params["precision"], 4, "用户 patch 覆盖变体");
            assert_eq!(params["id"], "n1");
        }
        other => panic!("unexpected: {other:?}"),
    }
}

#[test]
fn repeated_create_is_deterministic() {
    let op = || create("Math", "n1", json!({}), Some("add".into()));
    let first = prepare_documents(&catalog(), vec![op()])
        .items
        .remove(0)
        .unwrap();
    let second = prepare_documents(&catalog(), vec![op()])
        .items
        .remove(0)
        .unwrap();
    assert_eq!(
        serde_json::to_value(&first.document).unwrap(),
        serde_json::to_value(&second.document).unwrap(),
        "同一 nodeId 重复请求产生相同文档"
    );
}

#[test]
fn unknown_model_returns_structured_error() {
    let result = prepare_documents(&catalog(), vec![create("Nope", "n1", json!({}), None)]);
    match result.items.into_iter().next().unwrap() {
        Err(failed) => assert_eq!(failed.code, "model/unknown"),
        Ok(_) => panic!("unknown model must fail"),
    }
}

#[test]
fn config_patch_cannot_override_node_identity() {
    // configPatch 合并进 params, 不触达 NodeDocument 顶层 identity
    let result = prepare_documents(
        &catalog(),
        vec![create(
            "Math",
            "n1",
            json!({ "id": "hacked", "op": "div" }),
            None,
        )],
    );
    let prepared = result.items.into_iter().next().unwrap().expect("prepared");
    assert_eq!(prepared.document.id, "n1");
    match &prepared.document.business {
        kind::document::NodeBusiness::Widget { params, .. } => {
            assert_eq!(params["id"], "n1", "identity 不可被 patch 改写");
            assert_eq!(params["op"], "div", "业务字段可 patch");
        }
        other => panic!("unexpected: {other:?}"),
    }
}
