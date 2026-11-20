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

Cada quadro OATP de 100 bytes viaja como 136 caracteres Base64 canônicos com padding, usando ggwave 0.4.0, modo variável audível normal, PCM mono de saída a 48 kHz. Há uma pausa nominal de 160 ms entre quadros. A primeira sequência segue o perfil inicial da [especificação](OATP_0.1_Especificacao_Completa.md). Cada continuação anuncia o manifesto, transmite oito reparos e repete o manifesto. Os ESIs avançam por geração e o início de cada rodada gira. O receptor descarta símbolos anteriores ao primeiro manifesto válido. Parar a escuta conserva o progresso na aba. Fechar ou recarregar a página encerra a sessão.

## Validação

A CI verifica o caminho bytes → PCM → bytes, perda do manifesto inicial, repetição de manifesto, reparos, integridade, mensagens Unicode, arquivos e compatibilidade byte a byte com as referências. A etapa de publicação distribui apenas os arquivos estáticos em dist.

Em teste de navegador, o Edge com viewport móvel recebeu pelo microfone virtual um WAV com a mensagem “Olá, Onda! 🌊” e outro com o arquivo binário de 256 bytes. A cópia e o download coincidiram com os originais. Também foram exercitados cancelamento da reprodução, continuação com reparos e permissão de microfone negada. A primeira sequência de “Olá, Onda!” dura aproximadamente 54 segundos no perfil inicial.

**Ensaio físico previsto:** em Safari/iPhone e Chrome/Android, trocar “Olá, Onda!” e um arquivo com os bytes 00 a FF, em ambos os sentidos. Anotar modelo, navegador, distância, duração, necessidade de reparos e comparação do arquivo recebido. Publicar resultados medidos separadamente dos testes de software.

## Licença

MIT para o projeto. O modem ggwave é distribuído sob a licença em [licenses/ggwave.txt](licenses/ggwave.txt). O QR code é gerado no build com qrcode. O site inclui os avisos de terceiros em NOTICE.txt.
