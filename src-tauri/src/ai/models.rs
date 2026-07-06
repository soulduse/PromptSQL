//! 모델 레지스트리 — 프로바이더별 모델 목록·기본값의 단일 소스.
//!
//! providers의 available_models, router의 경량 모델 기본값,
//! AIManager의 초기 모델이 전부 이 모듈을 참조한다.
//! (기존에는 각자 하드코딩되어 router 기본값이 목록에 없는 모델을
//! 가리키는 불일치가 있었다 — 2026-07 기준으로 갱신)

use super::provider::{ModelInfo, ProviderType};

/// 정적 모델 정의
pub struct ModelDef {
    pub id: &'static str,
    pub name: &'static str,
    pub max_tokens: u32,
    /// 라우터가 단순 질의에 사용할 경량(저비용) 모델 여부
    pub light: bool,
}

pub const OPENAI_MODELS: &[ModelDef] = &[
    ModelDef {
        id: "gpt-5.5",
        name: "GPT-5.5",
        max_tokens: 128000,
        light: false,
    },
    ModelDef {
        id: "gpt-5.4",
        name: "GPT-5.4",
        max_tokens: 128000,
        light: false,
    },
    ModelDef {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        max_tokens: 128000,
        light: true,
    },
];

pub const ANTHROPIC_MODELS: &[ModelDef] = &[
    ModelDef {
        id: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        max_tokens: 1000000,
        light: false,
    },
    ModelDef {
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        max_tokens: 1000000,
        light: false,
    },
    ModelDef {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        max_tokens: 200000,
        light: true,
    },
];

pub const GEMINI_MODELS: &[ModelDef] = &[
    ModelDef {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro",
        max_tokens: 1000000,
        light: false,
    },
    ModelDef {
        id: "gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        max_tokens: 1000000,
        light: true,
    },
    ModelDef {
        id: "gemini-3.1-flash-lite",
        name: "Gemini 3.1 Flash Lite",
        max_tokens: 1000000,
        light: true,
    },
];

/// Ollama 정적 fallback — 실제 목록은 /api/tags 동적 조회가 우선
pub const OLLAMA_MODELS: &[ModelDef] = &[
    ModelDef {
        id: "llama4",
        name: "Llama 4",
        max_tokens: 128000,
        light: true, // 로컬 실행이라 비용 무관
    },
    ModelDef {
        id: "qwen3",
        name: "Qwen 3",
        max_tokens: 128000,
        light: true,
    },
    ModelDef {
        id: "deepseek-r1",
        name: "DeepSeek R1",
        max_tokens: 128000,
        light: true,
    },
    ModelDef {
        id: "gemma3",
        name: "Gemma 3",
        max_tokens: 128000,
        light: true,
    },
];

/// 앱 전체 기본 (프로바이더, 모델)
pub const DEFAULT_PROVIDER: ProviderType = ProviderType::OpenAI;
pub const DEFAULT_MODEL: &str = "gpt-5.4-mini";

/// RAG 내부(File Search 질의) 호출에 사용하는 모델
pub const RAG_QUERY_MODEL: &str = "gemini-3.5-flash";

pub fn models_for(provider: ProviderType) -> &'static [ModelDef] {
    match provider {
        ProviderType::OpenAI => OPENAI_MODELS,
        ProviderType::Anthropic => ANTHROPIC_MODELS,
        ProviderType::Gemini => GEMINI_MODELS,
        ProviderType::Ollama => OLLAMA_MODELS,
    }
}

/// 프로바이더 기본 경량 모델 (router가 단순 질의 라우팅에 사용)
pub fn default_light_model(provider: ProviderType) -> &'static str {
    models_for(provider)
        .iter()
        .find(|m| m.light)
        .map(|m| m.id)
        // 각 목록에 light 모델이 반드시 존재함은 테스트로 보장
        .unwrap_or(DEFAULT_MODEL)
}

/// available_models() 응답용 변환
pub fn model_infos(provider: ProviderType) -> Vec<ModelInfo> {
    models_for(provider)
        .iter()
        .map(|m| ModelInfo {
            id: m.id.to_string(),
            name: m.name.to_string(),
            provider,
            max_tokens: m.max_tokens,
            supports_streaming: true,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_PROVIDERS: [ProviderType; 4] = [
        ProviderType::OpenAI,
        ProviderType::Anthropic,
        ProviderType::Gemini,
        ProviderType::Ollama,
    ];

    #[test]
    fn test_every_provider_has_a_light_model() {
        for provider in ALL_PROVIDERS {
            assert!(
                models_for(provider).iter().any(|m| m.light),
                "{:?} has no light model",
                provider
            );
        }
    }

    #[test]
    fn test_default_light_model_is_in_available_models() {
        // router 기본값이 목록에 없는 모델을 가리키던 회귀 방지
        for provider in ALL_PROVIDERS {
            let light = default_light_model(provider);
            assert!(
                models_for(provider).iter().any(|m| m.id == light),
                "{:?} default light model '{}' not in available models",
                provider,
                light
            );
        }
    }

    #[test]
    fn test_default_model_is_in_default_provider_models() {
        assert!(
            models_for(DEFAULT_PROVIDER)
                .iter()
                .any(|m| m.id == DEFAULT_MODEL),
            "DEFAULT_MODEL '{}' not in {:?} models",
            DEFAULT_MODEL,
            DEFAULT_PROVIDER
        );
    }

    #[test]
    fn test_no_duplicate_model_ids_within_provider() {
        for provider in ALL_PROVIDERS {
            let models = models_for(provider);
            for (i, a) in models.iter().enumerate() {
                for b in &models[i + 1..] {
                    assert_ne!(a.id, b.id, "duplicate model id in {:?}", provider);
                }
            }
        }
    }
}
