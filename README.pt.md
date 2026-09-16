<div align="center">

# 🔭 Nostraxis Dashboard

**Um único painel local para observar, lançar e comparar o trabalho feito com agentes de programação.**

ChatGPT/Codex · Claude Code · GitHub Copilot CLI — sem enviar o teu histórico a nenhum serviço externo.

[![License: MIT](https://img.shields.io/badge/License-MIT-1f6feb.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2022.5-5fa04e?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-58c4dc?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-6-646cff?style=flat-square&logo=vite&logoColor=white)](https://vite.dev)
[![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003b57?style=flat-square&logo=sqlite&logoColor=white)](https://nodejs.org/api/sqlite.html)
[![Local-first](https://img.shields.io/badge/local--first-sem%20telemetria-2ea043?style=flat-square)](#privacidade-e-limites-dos-dados)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4?style=flat-square)](#contribuir)

[![Stars](https://img.shields.io/github/stars/DaniBelmonte/Nostraxis?style=flat-square&logo=github)](https://github.com/DaniBelmonte/Nostraxis/stargazers)
[![Issues](https://img.shields.io/github/issues/DaniBelmonte/Nostraxis?style=flat-square&logo=github)](https://github.com/DaniBelmonte/Nostraxis/issues)
[![Last commit](https://img.shields.io/github/last-commit/DaniBelmonte/Nostraxis?style=flat-square&logo=github)](https://github.com/DaniBelmonte/Nostraxis/commits)

### 🌐 Idioma

[Español](README.es.md) · [English](README.md) · [Français](README.fr.md) · **Português** · [Italiano](README.it.md)

</div>

---

O Nostraxis é um dashboard local para observar, lançar e comparar trabalho feito com agentes de programação. Reúne sessões de **ChatGPT/Codex**, **Claude Code** e **GitHub Copilot CLI** numa mesma vista, sem enviar o histórico a um serviço do Nostraxis nem substituir a autenticação de cada fornecedor.

Foi pensado para duas formas de trabalho:

- Consultar num único sítio as sessões que já abriste com as tuas ferramentas habituais.
- Usá-lo como o teu painel de trabalho local: escolher um repositório, criar uma sessão com **New session** e executar o agente escolhido a partir desse repositório.

## ✨ O que oferece

| | |
| --- | --- |
| 🔌 **Multi-fornecedor** | Codex, Claude Code e Copilot CLI numa só vista, com o respetivo estado de ligação. |
| 🧭 **Sessões próprias e externas** | Lança sessões a partir do dashboard ou descobre as que já existem nos teus históricos locais. |
| ⚖️ **Compare** | Contrasta até quatro sessões reais: modelo, tokens, custo, duração, ferramentas e ficheiros. |
| 📊 **Analytics** | Agregados por repositório, fornecedor, modelo e intervalo de datas. |
| 🔒 **Local-first** | SQLite no teu disco, sem telemetria própria e sem guardar credenciais de fornecedores. |
| 🧪 **R&D Lab** | Matriz de variantes reproduzível com digest SHA-256 (opcional). |

## 📚 Conteúdo

- [Instalação rápida](#instalação-rápida)
- [Ligar ChatGPT/Codex, Claude e Copilot](#ligar-chatgptcodex-claude-e-copilot)
- [Trabalhar com repositórios e New session](#trabalhar-com-repositórios-e-new-session)
- [O que significa Sessions](#o-que-significa-sessions)
- [Comparar prompts, agentes e sessões](#comparar-prompts-agentes-e-sessões)
- [Uso, créditos e custos](#uso-créditos-e-custos)
- [Privacidade e limites dos dados](#privacidade-e-limites-dos-dados)
- [Configuração avançada](#configuração-avançada)
- [Resolução de problemas](#resolução-de-problemas)
- [API local](#api-local)
- [Contribuir](#contribuir)
- [Licença](#licença)

## Instalação rápida

### Requisitos

- Node.js **22.5 ou posterior**. O armazenamento local usa `node:sqlite`.
- Uma ou mais CLIs de agente instaladas e autenticadas se quiseres lançar sessões ou descobrir históricos: Codex, Claude Code ou GitHub Copilot CLI.
- Git é recomendável para registar o ramo e o commit de cada repositório; também é possível registar uma pasta local legível.

### Iniciar o dashboard

A partir desta pasta (`dashboard/`):

```bash
npm install
npm run dev
```

Abre [http://localhost:4173](http://localhost:4173). No macOS também podes abrir `start-dashboard.command`; arranca na sua própria janela de Terminal e mantém-se disponível enquanto essa janela estiver aberta.

Comandos úteis:

```bash
npm test
npm run build
npm start
```

O dashboard começa sem dados de demonstração. Para desenvolvimento visual isolado podes usar:

```bash
NOSTRAXIS_SEED=1 npm run dev
```

## Ligar ChatGPT/Codex, Claude e Copilot

Não há palavras-passe nem chaves de subscrição para configurar dentro da interface. Instala e inicia sessão na CLI de cada fornecedor com o seu próprio fluxo oficial e abre o dashboard com o mesmo utilizador de macOS/Linux/Windows. Ao arrancar, o Nostraxis deteta os executáveis disponíveis e os históricos locais.

| Fornecedor | Para lançar uma sessão a partir do dashboard | Histórico externo descoberto | O que verificar se não aparecer |
| --- | --- | --- | --- |
| ChatGPT / Codex | Codex CLI autenticada com a tua conta ChatGPT/Codex | `~/.codex/sessions` | Que `codex` esteja na `PATH` e que tenhas criado pelo menos uma sessão local. |
| Claude | Claude Code autenticado | `~/.claude/projects` | Que `claude auth status --json` indique uma sessão válida e que `claude` esteja na `PATH`. |
| GitHub Copilot | GitHub Copilot CLI autenticada | `~/.copilot/session-state` | Que `copilot` esteja na `PATH`; para a quota da conta, inicia sessão também com `gh auth login`. |

Abre **Settings** para verificar as fontes detetadas e o estado de cada adaptador. Em **Sessions**, usa o botão de sincronização para forçar de imediato uma nova leitura dos históricos. O observador também atualiza automaticamente as fontes locais a cada poucos segundos.

Se o executável não estiver na variável `PATH`, indica-o apenas para o processo do dashboard:

```bash
export NOSTRAXIS_CODEX_BIN='/caminho/absoluto/para/codex'
export NOSTRAXIS_CLAUDE_BIN='/caminho/absoluto/para/claude'
export NOSTRAXIS_COPILOT_BIN='/caminho/absoluto/para/copilot'
npm run dev
```

### Copilot: quota da conta

O cartão do Copilot pode ler o plano, o limite mensal, o consumo, o saldo e a data de reinício que o GitHub expõe à conta ativa do GitHub CLI. Não reutiliza nem guarda a credencial do `gh`. Se essa sessão não existir na máquina, podes fornecer um token de curta duração apenas ao processo que inicia o dashboard:

```bash
export NOSTRAXIS_COPILOT_TOKEN='token-do-github-com-acesso-ao-copilot'
npm run dev
```

O token não é persistido. Em organizações Business ou Enterprise, o dado mostrado é o orçamento pessoal quando o GitHub o expõe; os relatórios de faturação de toda a organização continuam a exigir as suas próprias permissões.

## Trabalhar com repositórios e New session

Podes usar o Nostraxis como a tua superfície de trabalho local para qualquer um dos três agentes. O dashboard executa a CLI selecionada na pasta do repositório: não clona o código nem move o projeto para outro sítio.

1. Vai a **Repos**.
2. Cola o caminho absoluto da tua pasta local, por exemplo `/Users/ana/code/a-minha-api`, e carrega em **Register repository**. Se for um repositório Git, também são guardados o ramo e o `HEAD` atuais.
3. Volta a **Sessions** e carrega em **+ New session**.
4. Escolhe o repositório registado, o fornecedor e, se aplicável, o modelo.
5. Atribui um nome, escreve o objetivo e decide se permites comandos e alterações de ficheiros.
6. Carrega em **Create session**. A sessão executa a partir dessa pasta e fica registada no dashboard.

Isto permite trabalhar com Codex, Claude ou Copilot mantendo um único painel para o contexto, a saída, os comandos, os ficheiros tocados e as métricas que o fornecedor tenha reportado. A opção de permitir escritas só afeta as sessões criadas a partir do Nostraxis; revê-a antes de iniciar uma tarefa que vá modificar o teu checkout.

## O que significa Sessions

**Sessions** é o histórico operacional do dashboard. Cada linha representa uma execução ou conversa detetada e é etiquetada por projeto, fornecedor, modelo, estado e origem.

| Tipo de sessão | Origem | O que podes fazer |
| --- | --- | --- |
| **Dashboard** | Criada com **New session** | Ver o stream, a conversa, comandos, ficheiros, contexto, métricas e cancelar uma execução ainda em curso. |
| **External** | Descoberta nos históricos locais de Codex, Claude ou Copilot | Consultar e filtrar os dados observados. Mantém-se em apenas leitura: deves continuar ou cancelar essa conversa na ferramenta original. |

Usa os separadores para alternar entre sessões ativas, recentes e todas; os filtros permitem restringir por projeto, fornecedor, modelo, estado, origem, atividade, custo e cache. O agrupamento por projeto ou por estado facilita acompanhar várias tarefas abertas ao mesmo tempo.

Ao selecionar uma sessão, o painel central mostra a sua cronologia e, quando a fonte o expõe, tokens, custo, créditos, duração e eventos. O inspetor lateral guarda o repositório, ramo, commit, prompt, ferramentas e ficheiros relacionados. Um valor **Not reported** significa que o fornecedor não o entregou: nunca equivale a zero nem é estimado em silêncio.

## Comparar prompts, agentes e sessões

A vista **Compare** serve para contrastar até quatro sessões reais. É útil tanto para rever prompts diferentes como para executar o mesmo prompt várias vezes e avaliar agentes, modelos ou permissões diferentes.

### Fluxo recomendado para um teste controlado

1. Regista o mesmo repositório e fixa um ramo ou commit estável.
2. Cria uma sessão por variante em **New session**. Para comparar agentes, usa o mesmo objetivo em Codex, Claude e/ou Copilot. Para comparar prompts, muda apenas o texto que queres avaliar.
3. Evita alterações nos ficheiros de partida entre execuções, ou regista explicitamente a diferença.
4. Vai a **Compare**, procura as sessões por projeto, modelo ou data e seleciona-as.
5. Interpreta os resultados junto com o `Context digest`, o output e os ficheiros/ferramentas usados; uma diferença de contexto ou de tarefa pode invalidar uma comparação de custo ou velocidade.

A matriz mostra modelo, tokens de entrada/saída, custo estimado, créditos do fornecedor, duração, cache, raciocínio, avaliação, ferramentas, ficheiros, digest de contexto e resposta final quando existem. A partir de cada coluna podes abrir o detalhe da sessão. Os campos não fornecidos pelo fornecedor permanecem como **Not reported**.

Para relatórios de uso, **Analytics** agrega as sessões por repositório, fornecedor, modelo e intervalo de datas. Inclui desagregação por modelo, relação custo/tokens, série temporal e acesso ao detalhe de cada execução. Esta é a vista adequada para responder, por exemplo, que agente consumiu mais num repositório ou como evoluiu o custo numa semana.

### Experiências reproduzíveis (opcional)

O **R&D Lab** cria uma matriz de variantes com uma tarefa comum e conserva o prompt renderizado, o contexto, o `HEAD` do repositório e um digest SHA-256 para facilitar a repetição. Ativa-o ao iniciar o dashboard:

```bash
NOSTRAXIS_EXPERIMENTS_ENABLED=1 npm run dev
```

As estratégias disponíveis são `raw-repo`, `knowledge-base` e `llm-wiki`. Desativa a variável ou usa um valor diferente de `1` para voltar a ocultar esta função.

## Uso, créditos e custos

No canto superior direito há três cartões: **Codex / ChatGPT**, **Claude** e **GitHub Copilot**. Carrega num cartão para abrir o detalhe da fonte, o modelo conhecido, o estado de ligação e a última atualização. Assim podes consultar num único sítio o que cada fornecedor permite observar.

| Fornecedor | Dados centralizados quando estão disponíveis | Âmbito correto |
| --- | --- | --- |
| Codex / ChatGPT | Janelas de limite de uso, créditos/saldo e tokens da sessão Codex mais recente. | Os limites mostrados são os que o Codex regista localmente; não são uma fatura consolidada do ChatGPT. |
| Claude | Estado de autenticação, dados da sessão observada e tokens/créditos que o Claude reporte. | O Claude pode não expor uma quota total de subscrição nos dados locais; nesse caso é mostrado como indisponível. |
| Copilot | Plano, créditos ou pedidos premium mensais, usado, disponível, data de reinício e consumo observado por intervalo de datas. | A quota da conta e a soma dos chats locais são fontes distintas e não se misturam. |

O dashboard distingue três conceitos que não devem ser confundidos:

- **Limite ou quota de subscrição:** contador e data de reinício fornecidos pelo fornecedor.
- **Créditos do fornecedor:** unidades próprias, como AI credits ou premium requests do Copilot. Não são dólares nem são comparáveis entre fornecedores.
- **Custo estimado:** valor em USD calculado apenas quando configuras preços por modelo e há tokens suficientes. Não substitui a fatura do fornecedor.

Para ativar o custo estimado, define preços em USD por milhão de tokens antes de iniciar o servidor:

```bash
export NOSTRAXIS_PRICING_JSON='{"model-id":{"inputPerMillion":1.25,"cachedInputPerMillion":0.25,"outputPerMillion":10}}'
npm run dev
```

## Privacidade e limites dos dados

O Nostraxis é local-first. A sua base SQLite fica por omissão em `.nostraxis/dashboard.sqlite` dentro do projeto do dashboard. Podes mudar essa localização com `NOSTRAXIS_DATA_DIR`.

O observador importa prompts e respostas visíveis, metadados de ferramentas e uso que a fonte tenha reportado. Não importa prompts de sistema nem raciocínio oculto. As sessões externas são de observação; não assume o controlo delas.

O Copilot lançado a partir do Nostraxis ativa o exportador oficial OpenTelemetry para um JSONL isolado em `.nostraxis/copilot-otel`, com a captura de conteúdo das mensagens desativada. Se quiseres enriquecer sessões Copilot externas com telemetria que já tenhas, indica o ficheiro ou diretório:

```bash
export NOSTRAXIS_COPILOT_OTEL_PATH='/caminho/absoluto/copilot-otel.jsonl'
```

Para históricos montados ou partilhados, substitui a lista de fontes e ajusta os limites de descoberta:

```bash
export NOSTRAXIS_SESSION_ROOTS_JSON='[{"provider":"codex","root":"/caminho/absoluto/codex-sessions"}]'
export NOSTRAXIS_SESSION_MAX_FILES=200
export NOSTRAXIS_SESSION_MAX_AGE_DAYS=30
```

## Configuração avançada

| Variável | Finalidade |
| --- | --- |
| `NOSTRAXIS_DATA_DIR` | Diretório que conterá a base SQLite e dados próprios do dashboard. |
| `NOSTRAXIS_CODEX_BIN` | Caminho para o executável do Codex quando não está na `PATH`. |
| `NOSTRAXIS_CLAUDE_BIN` | Caminho para o executável do Claude quando não está na `PATH`. |
| `NOSTRAXIS_COPILOT_BIN` | Caminho para o executável do Copilot quando não está na `PATH`. |
| `NOSTRAXIS_COPILOT_TOKEN` | Token de curta duração para consultar a quota pessoal do Copilot se não se usar `gh auth login`. Não é guardado. |
| `NOSTRAXIS_PRICING_JSON` | Tabela de preços por modelo para estimar USD. |
| `NOSTRAXIS_EXPERIMENTS_ENABLED=1` | Ativa o R&D Lab e a sua API de experiências. |
| `NOSTRAXIS_SESSION_ROOTS_JSON` | Substitui as localizações de histórico observadas. |
| `NOSTRAXIS_SESSION_MAX_FILES` | Máximo de ficheiros de histórico inspecionados. |
| `NOSTRAXIS_SESSION_MAX_AGE_DAYS` | Antiguidade máxima dos históricos descobertos. |
| `NOSTRAXIS_COPILOT_OTEL_PATH` | Caminho para telemetria OpenTelemetry existente do Copilot. |

## Resolução de problemas

| Problema | Verificação e solução |
| --- | --- |
| Não vejo sessões de um fornecedor | Abre **Settings**, confirma que o caminho de histórico aparece como detetado, cria uma sessão com essa CLI e carrega em sincronizar em **Sessions**. |
| O fornecedor aparece como indisponível | Verifica que o seu executável responde no mesmo Terminal com que arrancaste o dashboard. Se estiver noutra localização, define a variável `*_BIN` correspondente. |
| Não consigo criar uma sessão | Regista primeiro um repositório em **Repos** e seleciona um em **New session**. O objetivo não pode estar vazio. |
| Não aparecem custos | Configura `NOSTRAXIS_PRICING_JSON`; sem preços ou sem tokens reportados, o custo mantém-se indisponível. |
| Não vejo a quota do Copilot | Executa `gh auth login` com uma conta que tenha Copilot ou fornece o token temporário ao processo. A visibilidade depende do que o GitHub expõe para o teu plano. |
| Faltam campos em Compare ou Analytics | O dashboard não preenche métricas ausentes. Consulta o detalhe da sessão e compara apenas dimensões que ambas as fontes tenham reportado. |

## API local

| Método | Rota | Finalidade |
| --- | --- | --- |
| `GET` | `/api/dashboard` | Dados iniciais: repositórios, sessões, analítica, experiências e estado dos fornecedores. |
| `GET` | `/api/runs/:id` | Linha temporal, contexto e detalhe de uma execução. |
| `POST` | `/api/runs` | Cria uma sessão local com um fornecedor. |
| `POST` | `/api/runs/:id/cancel` | Cancela uma execução do dashboard que continue ativa. |
| `POST` | `/api/session-sources/sync` | Força a descoberta de sessões externas. |
| `GET` | `/api/analytics` | Agregados filtrados e séries temporais. |
| `GET` | `/api/compare?ids=...` | Dados comparáveis das sessões escolhidas. |
| `POST` | `/api/experiments` | Guarda uma experiência com as suas variantes e contexto exato. |
| `POST` | `/api/experiments/:id/run` | Executa as variantes de uma experiência. |
| `GET` | `/api/stream` | Atualizações em tempo real através de Server-Sent Events. |

Consulta [architecture.md](docs/architecture.md) para a arquitetura, os adaptadores e o fluxo interno de dados.

## Contribuir

As contribuições são bem-vindas: relatos de erro, adaptadores de novos fornecedores, traduções e melhorias de documentação.

1. Faz um fork e cria um ramo descritivo.
2. Executa `npm test` antes de abrir o pull request.
3. Descreve que fornecedor, vista ou variável de ambiente a tua alteração afeta.

Se alterares este README, replica a alteração nas cinco traduções (`README.md`, `README.es.md`, `README.fr.md`, `README.pt.md`, `README.it.md`).

## Licença

Distribuído sob a licença MIT. Consulta [LICENSE](LICENSE) para o texto completo.

<div align="center">

[Español](README.es.md) · [English](README.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Italiano](README.it.md)

</div>
