# Onda

**Teste com dois celulares:** [abrir a página experimental](https://dougpomp.github.io/onda-oatp/).

1. No celular de destino, abra a página em Safari ou Chrome, toque em **Receber** e permita o microfone.
2. No emissor, cole uma mensagem curta como **Olá, Onda!** ou escolha um arquivo de até 4 KiB. Confira a estimativa e toque em **Transmitir**.
3. Comece em ambiente silencioso, com volume moderado e os aparelhos próximos. Mantenha as páginas em primeiro plano. O receptor libera **Copiar mensagem** ou **Baixar arquivo** depois de verificar a integridade.
4. Se o outro aparelho ainda estiver incompleto, toque em **Continuar com reparos**. O emissor opera sem confirmação de retorno. Você pode parar o som assim que o receptor confirmar a entrega.

Conteúdo e áudio são processados nos aparelhos. O som é audível e pode ser recebido por outros aparelhos próximos. A versão é experimental. O ensaio acústico físico entre Android e iPhone está pendente.

## Desenvolvimento

Requisitos: Node.js 24, npm e Python 3. Na raiz do projeto:

```sh
npm ci --ignore-scripts
npm test
python tests/reference_check.py
npm run build
python -m http.server 8000 --directory dist
```

Abra localhost no mesmo computador. Para um celular, use o endereço HTTPS do Pages. O [Laboratório](https://dougpomp.github.io/onda-oatp/laboratorio/) preserva os ensaios simulados de escalonamento. A bateria histórica completa roda com `python interop/test_interop.py`.

## Formato e perfil acústico

O objeto dentro do OATP contém, em sequência, o ASCII ONDA, versão de um byte (1), tipo de um byte (0 = mensagem UTF-8; 1 = arquivo), comprimento do nome em um byte, nome UTF-8 e conteúdo original. Mensagens têm nome vazio. O campo de comprimento do manifesto cobre o envelope inteiro. O limite de 4096 bytes da interface se aplica ao conteúdo. Exemplo: a mensagem A é `4f 4e 44 41 01 00 00 41`.

O emissor envia os 100 bytes binários de cada quadro diretamente pelo ggwave 0.4.0 (PCM mono a 48 kHz), com 160 ms entre quadros. Atualize a página nos dois aparelhos. O receptor também aceita o formato Base64 anterior e reconhece os três perfis audíveis automaticamente.

| Perfil | Áudio por quadro | Sequência inicial “Olá, Onda!” |
|---|---:|---:|
| Com ruído (normal, um reparo extra por geração) | 9,90 s | ≈ 51 s |
| Rápido | 6,83 s | ≈ 28 s |
| Turbo | 3,75 s | ≈ 16 s |

Os tempos são da forma de onda e das pausas, arredondados para cima no painel. A sequência inicial segue a especificação; no perfil Com ruído o emissor acrescenta um reparo por geração após o manifesto final. Se a abertura for perdida, o receptor guarda até 128 símbolos com CRC válido e reaplica os correspondentes quando recebe o manifesto. Se faltar progresso, mantenha o receptor ouvindo e use **Continuar com reparos** no emissor. O perfil pode ser trocado antes da continuação. Recarregar a página encerra a sessão.

## Validação

A CI verifica o caminho bytes → PCM → bytes, perda do manifesto inicial, repetição de manifesto, reparos, integridade, mensagens Unicode, arquivos e compatibilidade byte a byte com as referências. A etapa de publicação distribui apenas os arquivos estáticos em dist.

Em teste de navegador, o Edge com viewport móvel recebeu pelo microfone virtual um WAV com a mensagem “Olá, Onda! 🌊” e outro com o arquivo binário de 256 bytes. A cópia e o download coincidiram com os originais. Também foram exercitados cancelamento da reprodução, continuação com reparos e permissão de microfone negada. Os perfis atuais passaram por testes em PCM com interferência harmônica sintética e perda do primeiro marcador. Esses ensaios não estimam a taxa de sucesso com vozes ou latidos reais.

**Ensaio físico previsto:** em Safari/iPhone e Chrome/Android, trocar “Olá, Onda!” e um arquivo com os bytes 00 a FF, em ambos os sentidos. Anotar modelo, navegador, distância, duração, necessidade de reparos e comparação do arquivo recebido. Publicar resultados medidos separadamente dos testes de software.

## Licença

MIT para o projeto. O modem ggwave é distribuído sob a licença em [licenses/ggwave.txt](licenses/ggwave.txt). O QR code é gerado no build com qrcode. O site inclui os avisos de terceiros em NOTICE.txt.
