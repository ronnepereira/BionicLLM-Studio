# Prévia de malha feminina — aguardando aprovação

Pedido de 11/11/2026: usuário rejeitou a aparência de imagem estática da versão feminina e pediu linhas/volume como na primeira cabeça, usando Desktop/CORREÇÕES BIONICLLM/1010.jpg como referência. Pediu captura antes de implementar.

Esta pasta é somente um estudo independente, fora de src/public e da compilação do app. A malha não foi integrada ao aplicativo. A implementação feminina por imagem do pedido anterior já estava no código e a compilação terminou; o teste nativo e o registro de entrega daquela opção foram suspensos com a nova orientação. Não apresentar aquela opção como a nova cabeça de linhas aprovada.

Captura: docs/bionic-preview/92-previa-malha-feminina.png, renderizada pelo código desta pasta em duas vistas da mesma geometria. Não usa textura de retrato nem imagem gerada para simular o resultado. A imagem 1010.jpg orienta a direção visual e não é carregada no renderizador.

Geometria facial base: https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj
Licença Apache-2.0 em MEDIAPIPE-LICENSE.txt. Arquivo baixado em 11/11/2026 e preservado localmente. Modificações de prévia: escultura de proporções femininas, mandíbula afinada, olhos ampliados, relevo dos lábios/nariz, extensão do crânio, orelhas e pescoço/ombros procedurais, linhas e subdivisões, câmera/projeção. Nenhuma inferência MediaPipe ou câmera é usada: somente coordenadas e triângulos da malha.

Para repetir: rtk proxy node docs/hologram-wire-preview/render.mjs. Cria servidor local temporário, captura no Edge headless e encerra servidor/navegador. Requer Playwright já instalado no projeto.

Próximo passo: obter aprovação desta direção visual antes de substituir o renderizador da Voz. Histórico e fluxo de geração de imagens permanecem fora do escopo da alteração visual.

## Variações solicitadas

Sem orelhas, pescoço e base: executar `rtk proxy node docs/hologram-wire-preview/make-face-only.mjs` e `rtk proxy node docs/hologram-wire-preview/render.mjs --face-only`. Captura 93-previa-somente-face.png.

Somente frente, com rotação lateral suave: executar `rtk proxy node docs/hologram-wire-preview/make-front-motion.mjs` e `rtk proxy node docs/hologram-wire-preview/render-motion.mjs`. Gera quadros em diretório temporário, sem alterar o app. Prévia 94-previa-rosto-movimento.gif: ciclo de 6 segundos, 120 quadros a 20 fps, rotação real em torno do eixo vertical de -0,13 a +0,13 radianos (aproximadamente 7,4 graus para cada lado). GIF exportado em 600x700. Direção e movimento aguardam aprovação antes da integração.
