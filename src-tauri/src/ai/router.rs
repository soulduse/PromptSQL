//! 모델 라우팅 - 질문 복잡도에 따라 적절한 모델 선택

use super::provider::ProviderType;

/// 질문 복잡도 분류
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueryComplexity {
    /// 단순 질문 - mini/flash 모델 사용
    Simple,
    /// 복잡한 질문 - 고성능 모델 사용
    Complex,
}

/// 복잡도 판단 패턴 (다국어 지원)
const COMPLEX_PATTERNS: &[&str] = &[
    // === 조인/서브쿼리 ===
    "조인", "join", "서브쿼리", "subquery",
    // === 분석 ===
    "분석", "analysis", "코호트", "cohort",
    // === 윈도우 함수 ===
    "윈도우 함수", "window function", "over(", "partition by",
    // === CTE ===
    "with ", "recursive", "cte",
    // === 조건부 로직 ===
    "case when", "case ",
    // === 그룹핑 후 조건 ===
    "having",
    // === 집합 연산 ===
    "union", "intersect", "except",
    // === 고급 함수 ===
    "피벗", "pivot", "재귀", "regexp", "json_",
    // === 다중 테이블 ===
    "여러 테이블", "multiple tables",
];

/// 경량 모델 패턴 (모델명에 포함된 키워드)
const LIGHT_MODEL_PATTERNS: &[&str] = &[
    "mini",
    "flash",
    "haiku",
    "small",
];

/// 질문 복잡도 분류
pub fn classify_complexity(message: &str) -> QueryComplexity {
    let msg_lower = message.to_lowercase();

    for pattern in COMPLEX_PATTERNS {
        if msg_lower.contains(&pattern.to_lowercase()) {
            return QueryComplexity::Complex;
        }
    }

    QueryComplexity::Simple
}

/// 사용 가능한 모델 목록에서 경량 모델 찾기
///
/// 패턴은 구분자(`-`, `.`, `_`, `:`)로 나뉜 세그먼트 단위로 비교한다.
/// 단순 substring 비교는 "gemini"가 "mini"에 매치되어 pro 모델을
/// 경량으로 오판하는 버그가 있었다.
pub fn find_light_model(available_models: &[String]) -> Option<String> {
    for model in available_models {
        let model_lower = model.to_lowercase();
        let is_light = model_lower
            .split(|c: char| !c.is_ascii_alphanumeric())
            .any(|segment| LIGHT_MODEL_PATTERNS.contains(&segment));
        if is_light {
            return Some(model.clone());
        }
    }
    None
}

/// Provider별 기본 경량 모델 반환
pub fn get_default_light_model(provider: &ProviderType) -> &'static str {
    // 단일 소스: ai/models.rs — available_models와 항상 일치한다
    // (과거 gemini-2.5-flash처럼 목록에 없는 기본값이 생기는 것을 방지)
    crate::ai::models::default_light_model(*provider)
}

/// 모델 라우팅 결과
#[derive(Debug, Clone)]
pub struct ModelSelection {
    pub provider: ProviderType,
    pub model: String,
    pub is_light_model: bool,
}

/// 복잡도에 따른 모델 선택
pub fn select_model(
    complexity: QueryComplexity,
    current_provider: &ProviderType,
    current_model: &str,
    available_models: &[String],
) -> ModelSelection {
    match complexity {
        QueryComplexity::Simple => {
            // 경량 모델 우선 시도
            if let Some(light_model) = find_light_model(available_models) {
                ModelSelection {
                    provider: current_provider.clone(),
                    model: light_model,
                    is_light_model: true,
                }
            } else {
                // 없으면 기본 경량 모델 사용
                ModelSelection {
                    provider: current_provider.clone(),
                    model: get_default_light_model(current_provider).to_string(),
                    is_light_model: true,
                }
            }
        }
        QueryComplexity::Complex => {
            // 현재 설정된 모델 사용 (사용자가 선택한 고성능 모델)
            ModelSelection {
                provider: current_provider.clone(),
                model: current_model.to_string(),
                is_light_model: false,
            }
        }
    }
}

/// 테이블 선택 및 요약에 사용할 경량 모델 선택
/// (항상 경량 모델 사용)
pub fn select_utility_model(
    current_provider: &ProviderType,
    available_models: &[String],
) -> ModelSelection {
    if let Some(light_model) = find_light_model(available_models) {
        ModelSelection {
            provider: current_provider.clone(),
            model: light_model,
            is_light_model: true,
        }
    } else {
        ModelSelection {
            provider: current_provider.clone(),
            model: get_default_light_model(current_provider).to_string(),
            is_light_model: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_simple() {
        assert_eq!(
            classify_complexity("users 테이블에서 모든 데이터 조회"),
            QueryComplexity::Simple
        );
        assert_eq!(
            classify_complexity("show all users"),
            QueryComplexity::Simple
        );
    }

    #[test]
    fn test_classify_complex_join() {
        assert_eq!(
            classify_complexity("users와 orders 조인해서 조회"),
            QueryComplexity::Complex
        );
        assert_eq!(
            classify_complexity("join users and orders"),
            QueryComplexity::Complex
        );
    }

    #[test]
    fn test_classify_complex_window() {
        assert_eq!(
            classify_complexity("윈도우 함수로 순위 계산"),
            QueryComplexity::Complex
        );
        assert_eq!(
            classify_complexity("use PARTITION BY to rank"),
            QueryComplexity::Complex
        );
    }

    #[test]
    fn test_classify_complex_cte() {
        assert_eq!(
            classify_complexity("WITH clause로 CTE 만들어줘"),
            QueryComplexity::Complex
        );
    }

    #[test]
    fn test_find_light_model() {
        let models = vec![
            "gpt-4o".to_string(),
            "gpt-4o-mini".to_string(),
            "gpt-3.5-turbo".to_string(),
        ];
        assert_eq!(find_light_model(&models), Some("gpt-4o-mini".to_string()));

        let models2 = vec![
            "gemini-1.5-pro".to_string(),
            "gemini-2.0-flash".to_string(),
        ];
        assert_eq!(find_light_model(&models2), Some("gemini-2.0-flash".to_string()));
    }

    #[test]
    fn test_select_model_simple() {
        let models = vec!["gpt-4o".to_string(), "gpt-4o-mini".to_string()];
        let selection = select_model(
            QueryComplexity::Simple,
            &ProviderType::OpenAI,
            "gpt-4o",
            &models,
        );
        assert!(selection.is_light_model);
        assert_eq!(selection.model, "gpt-4o-mini");
    }

    #[test]
    fn test_select_model_complex() {
        let models = vec!["gpt-4o".to_string(), "gpt-4o-mini".to_string()];
        let selection = select_model(
            QueryComplexity::Complex,
            &ProviderType::OpenAI,
            "gpt-4o",
            &models,
        );
        assert!(!selection.is_light_model);
        assert_eq!(selection.model, "gpt-4o");
    }
}
