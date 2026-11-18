//! Read-only public catalogs. Closed feed selection, no caller-supplied URL or execution.
const MAX_BYTES: usize = 10 * 1024 * 1024;

#[derive(serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CatalogFeed { Cline, HermesPlugins, HermesBundledSkills, HermesOptionalSkills }

impl CatalogFeed {
    fn url(&self) -> &'static str {
        match self {
            Self::Cline => "https://cline.github.io/marketplace/catalog.json",
            Self::HermesPlugins => "https://nousresearch.github.io/hermes-agent/docs/api/plugin-catalog.json",
            Self::HermesBundledSkills => "https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/reference/skills-catalog.md",
            Self::HermesOptionalSkills => "https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/reference/optional-skills-catalog.md",
        }
    }
}

#[tauri::command]
pub async fn studio_marketplace_catalog(feed: Option<CatalogFeed>) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build().map_err(|e| format!("Não foi possível preparar a consulta ao Marketplace: {}", e))?;
    let url = feed.unwrap_or(CatalogFeed::Cline).url();
    let mut response = client.get(url).send().await
        .map_err(|e| format!("Não foi possível consultar o catálogo online: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("O catálogo retornou status inesperado: {}", response.status()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("A consulta ao catálogo foi interrompida: {}", e))? {
        if bytes.len() + chunk.len() > MAX_BYTES { return Err("O catálogo excedeu o limite permitido.".into()); }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|e| format!("O catálogo não contém texto UTF-8 válido: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_selection_accepts_only_the_four_public_feeds() {
        for name in ["cline", "hermes-plugins", "hermes-bundled-skills", "hermes-optional-skills"] {
            let feed: CatalogFeed = serde_json::from_value(serde_json::json!(name)).unwrap();
            assert!(feed.url().starts_with("https://"));
        }
        for name in ["https://example.com", "http://127.0.0.1", "hermes", "../secrets"] {
            assert!(serde_json::from_value::<CatalogFeed>(serde_json::json!(name)).is_err());
        }
    }
}
