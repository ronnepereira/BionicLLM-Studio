use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct RadioSearchRequest {
    pub name: String,
    pub limit: Option<u32>,
}

#[derive(Serialize, Clone)]
pub struct OnlineRadioStation {
    pub name: String,
    pub url: String,
    pub country: Option<String>,
    pub language: Option<String>,
    pub tags: Option<String>,
}

#[derive(Deserialize)]
struct RadioBrowserStation {
    name: Option<String>,
    url: Option<String>,
    url_resolved: Option<String>,
    stream_url: Option<String>,
    country: Option<String>,
    language: Option<String>,
    tags: Option<String>,
    hls: Option<u8>,
}

fn playable_url(raw: &str) -> Option<String> {
    let url = reqwest::Url::parse(raw.trim()).ok()?;
    // Match the existing custom-station store: no HTTP upgrades or credentials.
    if url.scheme() != "https" || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some()
        || url.as_str().len() > 2000
    {
        return None;
    }
    let path = url.path().to_ascii_lowercase();
    if path.ends_with(".m3u8") || path.ends_with(".hls") {
        return None;
    }
    Some(url.to_string())
}

fn normalize_stations(data: Vec<RadioBrowserStation>, limit: u32) -> Vec<OnlineRadioStation> {
    let mut seen_urls = std::collections::HashSet::new();
    let mut results = Vec::new();
    for station in data {
        let name = station.name.as_deref().unwrap_or("").trim();
        if name.is_empty() || name.chars().count() > 80 || station.hls.unwrap_or(0) != 0 {
            continue;
        }
        // An empty/invalid resolved URL must not hide a usable fallback.
        let url = [station.url_resolved.as_deref(), station.stream_url.as_deref(), station.url.as_deref()]
            .into_iter().flatten().find_map(playable_url);
        let Some(url) = url else { continue };
        if !seen_urls.insert(url.clone()) { continue; }
        results.push(OnlineRadioStation {
            name: name.to_string(), url,
            country: station.country, language: station.language, tags: station.tags,
        });
        if results.len() >= limit as usize { break; }
    }
    results
}

#[tauri::command]
pub async fn search_online_radios(req: RadioSearchRequest) -> Result<Vec<OnlineRadioStation>, String> {
    let q = req.name.trim();
    if q.is_empty() {
        return Err("Query vazia".to_string());
    }
    let limit = req.limit.unwrap_or(60).clamp(1, 60);

    // Servidores conhecidos do radio-browser.info (igual ao Hermes)
    let directory_servers = vec![
        "https://de1.api.radio-browser.info",
        "https://nl1.api.radio-browser.info",
        "https://us1.api.radio-browser.info",
    ];

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("BionicLLM-Studio/1.0")
        .build()
        .map_err(|e| format!("Falha ao criar cliente HTTP: {}", e))?;

    let mut last_error: Option<String> = None;

    // Parâmetros da query (igual ao Hermes)
    let params = format!(
        "name={}&limit={}&hidebroken=true&order=votes&reverse=true",
        urlencoding::encode(q),
        limit
    );

    for server in directory_servers {
        let url = format!("{}/json/stations/search?{}", server, params);
        match client.get(&url).send().await {
            Ok(response) => {
                if !response.status().is_success() {
                    last_error = Some(format!("HTTP {}", response.status()));
                    continue;
                }
                let data: Vec<RadioBrowserStation> = match response.json().await {
                    Ok(d) => d,
                    Err(e) => {
                        last_error = Some(format!("Erro ao parsear JSON: {}", e));
                        continue;
                    }
                };
                let results = normalize_stations(data, limit);
                if !results.is_empty() {
                    return Ok(results);
                }
            }
            Err(e) => {
                last_error = Some(format!("Erro na requisição: {}", e));
                continue;
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "Não foi possível pesquisar rádios online".to_string()))
}
