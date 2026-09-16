<div align="center">

# 🔭 Nostraxis Dashboard

**Un unico pannello locale per osservare, avviare e confrontare il lavoro svolto con gli agenti di programmazione.**

ChatGPT/Codex · Claude Code · GitHub Copilot CLI — senza inviare la tua cronologia a nessun servizio esterno.

[![License: MIT](https://img.shields.io/badge/License-MIT-1f6feb.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2022.5-5fa04e?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-58c4dc?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-6-646cff?style=flat-square&logo=vite&logoColor=white)](https://vite.dev)
[![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003b57?style=flat-square&logo=sqlite&logoColor=white)](https://nodejs.org/api/sqlite.html)
[![Local-first](https://img.shields.io/badge/local--first-senza%20telemetria-2ea043?style=flat-square)](#privacy-e-limiti-dei-dati)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4?style=flat-square)](#contribuire)

[![Stars](https://img.shields.io/github/stars/DaniBelmonte/Nostraxis?style=flat-square&logo=github)](https://github.com/DaniBelmonte/Nostraxis/stargazers)
[![Issues](https://img.shields.io/github/issues/DaniBelmonte/Nostraxis?style=flat-square&logo=github)](https://github.com/DaniBelmonte/Nostraxis/issues)
[![Last commit](https://img.shields.io/github/last-commit/DaniBelmonte/Nostraxis?style=flat-square&logo=github)](https://github.com/DaniBelmonte/Nostraxis/commits)

### 🌐 Lingua

[Español](README.es.md) · [English](README.md) · [Français](README.fr.md) · [Português](README.pt.md) · **Italiano**

</div>

---

Nostraxis è una dashboard locale per osservare, avviare e confrontare il lavoro svolto con gli agenti di programmazione. Riunisce le sessioni di **ChatGPT/Codex**, **Claude Code** e **GitHub Copilot CLI** in un'unica vista, senza inviare la cronologia a un servizio di Nostraxis e senza sostituire l'autenticazione di ciascun fornitore.

È pensata per due modi di lavorare:

- Consultare da un unico punto le sessioni già aperte con i tuoi strumenti abituali.
- Usarla come superficie di lavoro locale: scegliere un repository, creare una sessione con **New session** ed eseguire l'agente scelto da quel repository.

## ✨ Cosa offre

| | |
| --- | --- |
| 🔌 **Multi-fornitore** | Codex, Claude Code e Copilot CLI in un'unica vista, con il loro stato di connessione. |
| 🧭 **Sessioni proprie ed esterne** | Avvia sessioni dalla dashboard o scopri quelle già presenti nelle tue cronologie locali. |
| ⚖️ **Compare** | Confronta fino a quattro sessioni reali: modello, token, costo, durata, strumenti e file. |
| 📊 **Analytics** | Aggregati per repository, fornitore, modello e intervallo di date. |
| 🔒 **Local-first** | SQLite sul tuo disco, nessuna telemetria propria e nessuna custodia delle credenziali dei fornitori. |
| 🧪 **R&D Lab** | Matrice di varianti riproducibile con digest SHA-256 (opzionale). |

## 📚 Contenuti

- [Installazione rapida](#installazione-rapida)
- [Collegare ChatGPT/Codex, Claude e Copilot](#collegare-chatgptcodex-claude-e-copilot)
- [Lavorare con i repository e New session](#lavorare-con-i-repository-e-new-session)
- [Cosa significa Sessions](#cosa-significa-sessions)
- [Confrontare prompt, agenti e sessioni](#confrontare-prompt-agenti-e-sessioni)
- [Utilizzo, crediti e costi](#utilizzo-crediti-e-costi)
- [Privacy e limiti dei dati](#privacy-e-limiti-dei-dati)
- [Configurazione avanzata](#configurazione-avanzata)
- [Risoluzione dei problemi](#risoluzione-dei-problemi)
- [API locale](#api-locale)
- [Contribuire](#contribuire)
- [Licenza](#licenza)

## Installazione rapida

### Requisiti

- Node.js **22.5 o successivo**. L'archiviazione locale usa `node:sqlite`.
- Una o più CLI di agente installate e autenticate se vuoi avviare sessioni o scoprire cronologie: Codex, Claude Code o GitHub Copilot CLI.
- Git è consigliato per registrare il branch e il commit di ogni repository; si può registrare anche una cartella locale leggibile.

### Avviare la dashboard

Da questa cartella (`dashboard/`):

```bash
npm install
npm run dev
```

Apri [http://localhost:4173](http://localhost:4173). Su macOS puoi anche aprire `start-dashboard.command`; si avvia in una propria finestra di Terminale e resta disponibile finché quella finestra è aperta.

Comandi utili:

```bash
npm test
npm run build
npm start
```

La dashboard parte senza dati dimostrativi. Per uno sviluppo visivo isolato puoi usare:

```bash
NOSTRAXIS_SEED=1 npm run dev
```

## Collegare ChatGPT/Codex, Claude e Copilot

Non ci sono password né chiavi di abbonamento da configurare nell'interfaccia. Installa ed effettua l'accesso alla CLI di ciascun fornitore con il suo flusso ufficiale e apri la dashboard con lo stesso utente macOS/Linux/Windows. All'avvio, Nostraxis rileva gli eseguibili disponibili e le cronologie locali.

| Fornitore | Per avviare una sessione dalla dashboard | Cronologia esterna rilevata | Cosa controllare se non compare |
| --- | --- | --- | --- |
| ChatGPT / Codex | Codex CLI autenticata con il tuo account ChatGPT/Codex | `~/.codex/sessions` | Che `codex` sia nel `PATH` e che tu abbia creato almeno una sessione locale. |
| Claude | Claude Code autenticato | `~/.claude/projects` | Che `claude auth status --json` indichi una sessione valida e che `claude` sia nel `PATH`. |
| GitHub Copilot | GitHub Copilot CLI autenticata | `~/.copilot/session-state` | Che `copilot` sia nel `PATH`; per la quota dell'account accedi anche con `gh auth login`. |

Apri **Settings** per verificare le fonti rilevate e lo stato di ogni adattatore. In **Sessions**, usa il pulsante di sincronizzazione per forzare subito una nuova lettura delle cronologie. L'osservatore aggiorna inoltre automaticamente le fonti locali ogni pochi secondi.

Se l'eseguibile non è nella variabile `PATH`, indicalo solo per il processo della dashboard:

```bash
export NOSTRAXIS_CODEX_BIN='/percorso/assoluto/a/codex'
export NOSTRAXIS_CLAUDE_BIN='/percorso/assoluto/a/claude'
export NOSTRAXIS_COPILOT_BIN='/percorso/assoluto/a/copilot'
npm run dev
```

### Copilot: quota dell'account

La scheda di Copilot può leggere il piano, il limite mensile, il consumo, il saldo e la data di reset che GitHub espone all'account attivo di GitHub CLI. Non riutilizza né salva la credenziale di `gh`. Se quella sessione non esiste sulla macchina, puoi fornire un token di breve durata solo al processo che avvia la dashboard:

```bash
export NOSTRAXIS_COPILOT_TOKEN='token-github-con-accesso-a-copilot'
npm run dev
```

Il token non viene persistito. Nelle organizzazioni Business o Enterprise il dato mostrato è il budget personale quando GitHub lo espone; i report di fatturazione dell'intera organizzazione richiedono comunque i loro permessi.

## Lavorare con i repository e New session

Puoi usare Nostraxis come superficie di lavoro locale per ognuno dei tre agenti. La dashboard esegue la CLI selezionata nella cartella del repository: non clona il codice né sposta il progetto altrove.

1. Vai su **Repos**.
2. Incolla il percorso assoluto della tua cartella locale, ad esempio `/Users/ana/code/mia-api`, e premi **Register repository**. Se è un repository Git vengono salvati anche il branch e l'`HEAD` correnti.
3. Torna su **Sessions** e premi **+ New session**.
4. Scegli il repository registrato, il fornitore e, se pertinente, il modello.
5. Assegna un nome, scrivi l'obiettivo e decidi se consentire comandi e modifiche ai file.
6. Premi **Create session**. La sessione viene eseguita da quella cartella e resta tracciata nella dashboard.

Questo permette di lavorare con Codex, Claude o Copilot mantenendo un unico pannello per contesto, output, comandi, file toccati e metriche riportate dal fornitore. L'opzione che consente le scritture riguarda solo le sessioni create da Nostraxis; verificala prima di avviare un'attività che modificherà il tuo checkout.

## Cosa significa Sessions

**Sessions** è la cronologia operativa della dashboard. Ogni riga rappresenta un'esecuzione o una conversazione rilevata ed è etichettata per progetto, fornitore, modello, stato e origine.

| Tipo di sessione | Origine | Cosa puoi fare |
| --- | --- | --- |
| **Dashboard** | Creata con **New session** | Vedere lo stream, la conversazione, i comandi, i file, il contesto, le metriche e annullare un'esecuzione ancora in corso. |
| **External** | Rilevata nelle cronologie locali di Codex, Claude o Copilot | Consultare e filtrare i dati osservati. Resta in sola lettura: devi proseguire o annullare quella conversazione dal suo strumento originale. |

Usa le schede per passare tra sessioni attive, recenti e tutte; i filtri permettono di restringere per progetto, fornitore, modello, stato, origine, attività, costo e cache. Il raggruppamento per progetto o per stato facilita il monitoraggio di più attività aperte contemporaneamente.

Selezionando una sessione, il pannello centrale mostra la sua cronologia e, quando la fonte lo espone, token, costo, crediti, durata ed eventi. L'ispettore laterale conserva repository, branch, commit, prompt, strumenti e file correlati. Un valore **Not reported** significa che il fornitore non lo ha fornito: non equivale mai a zero e non viene mai stimato in silenzio.

## Confrontare prompt, agenti e sessioni

La vista **Compare** serve a confrontare fino a quattro sessioni reali. È utile sia per esaminare prompt diversi sia per eseguire lo stesso prompt più volte e valutare agenti, modelli o permessi differenti.

### Flusso consigliato per un test controllato

1. Registra lo stesso repository e fissa un branch o un commit stabile.
2. Crea una sessione per variante in **New session**. Per confrontare agenti, usa lo stesso obiettivo su Codex, Claude e/o Copilot. Per confrontare prompt, cambia solo il testo da valutare.
3. Evita modifiche ai file di partenza tra un'esecuzione e l'altra, oppure annota esplicitamente la differenza.
4. Vai su **Compare**, cerca le sessioni per progetto, modello o data e selezionale.
5. Interpreta i risultati insieme al `Context digest`, all'output e ai file/strumenti usati; una differenza di contesto o di attività può invalidare un confronto di costo o velocità.

La matrice mostra modello, token di input/output, costo stimato, crediti del fornitore, durata, cache, ragionamento, valutazione, strumenti, file, digest del contesto e risposta finale quando presenti. Da ogni colonna puoi aprire il dettaglio della sessione. I campi non forniti dal fornitore restano **Not reported**.

Per i report d'uso, **Analytics** aggrega le sessioni per repository, fornitore, modello e intervallo di date. Include la suddivisione per modello, il rapporto costo/token, una serie temporale e l'accesso al dettaglio di ogni esecuzione. È la vista adatta per rispondere, ad esempio, a quale agente ha consumato di più in un repository o come è evoluto il costo in una settimana.

### Esperimenti riproducibili (opzionale)

Il **R&D Lab** crea una matrice di varianti con un'attività comune e conserva il prompt renderizzato, il contesto, l'`HEAD` del repository e un digest SHA-256 per facilitare la ripetizione. Attivalo all'avvio della dashboard:

```bash
NOSTRAXIS_EXPERIMENTS_ENABLED=1 npm run dev
```

Le strategie disponibili sono `raw-repo`, `knowledge-base` e `llm-wiki`. Rimuovi la variabile o usa un valore diverso da `1` per nascondere di nuovo questa funzione.

## Utilizzo, crediti e costi

In alto a destra ci sono tre schede: **Codex / ChatGPT**, **Claude** e **GitHub Copilot**. Premi una scheda per aprire il dettaglio della fonte, il modello noto, lo stato di connessione e l'ultimo aggiornamento. Così puoi consultare da un unico punto ciò che ogni fornitore consente di osservare.

| Fornitore | Dati centralizzati quando disponibili | Ambito corretto |
| --- | --- | --- |
| Codex / ChatGPT | Finestre di limite d'uso, crediti/saldo e token della sessione Codex più recente. | I limiti mostrati sono quelli che Codex registra localmente; non sono una fattura consolidata di ChatGPT. |
| Claude | Stato di autenticazione, dati della sessione osservata e token/crediti riportati da Claude. | Claude può non esporre una quota di abbonamento totale nei dati locali; in tal caso viene mostrata come non disponibile. |
| Copilot | Piano, crediti o richieste premium mensili, usato, disponibile, data di reset e consumo osservato per intervallo di date. | La quota dell'account e la somma delle chat locali sono fonti distinte e non vengono mescolate. |

La dashboard distingue tre concetti da non confondere:

- **Limite o quota di abbonamento:** contatore e data di reset forniti dal fornitore.
- **Crediti del fornitore:** unità proprie, come gli AI credits o le premium request di Copilot. Non sono dollari e non sono comparabili tra fornitori.
- **Costo stimato:** importo in USD calcolato solo quando configuri i prezzi per modello e i token sono sufficienti. Non sostituisce la fattura del fornitore.

Per abilitare il costo stimato, definisci i prezzi in USD per milione di token prima di avviare il server:

```bash
export NOSTRAXIS_PRICING_JSON='{"model-id":{"inputPerMillion":1.25,"cachedInputPerMillion":0.25,"outputPerMillion":10}}'
npm run dev
```

## Privacy e limiti dei dati

Nostraxis è local-first. Il suo database SQLite si trova per impostazione predefinita in `.nostraxis/dashboard.sqlite` all'interno del progetto della dashboard. Puoi cambiare quella posizione con `NOSTRAXIS_DATA_DIR`.

L'osservatore importa prompt e risposte visibili, metadati degli strumenti e l'utilizzo riportato dalla fonte. Non importa prompt di sistema né ragionamento nascosto. Le sessioni esterne sono di sola osservazione; non ne assume il controllo.

Copilot avviato da Nostraxis abilita l'esportatore ufficiale OpenTelemetry verso un JSONL isolato in `.nostraxis/copilot-otel`, con la cattura del contenuto dei messaggi disattivata. Se vuoi arricchire sessioni Copilot esterne con telemetria già disponibile, indica il file o la directory:

```bash
export NOSTRAXIS_COPILOT_OTEL_PATH='/percorso/assoluto/copilot-otel.jsonl'
```

Per cronologie montate o condivise, sostituisci l'elenco delle fonti e regola i limiti di scoperta:

```bash
export NOSTRAXIS_SESSION_ROOTS_JSON='[{"provider":"codex","root":"/percorso/assoluto/codex-sessions"}]'
export NOSTRAXIS_SESSION_MAX_FILES=200
export NOSTRAXIS_SESSION_MAX_AGE_DAYS=30
```

## Configurazione avanzata

| Variabile | Scopo |
| --- | --- |
| `NOSTRAXIS_DATA_DIR` | Directory che conterrà il database SQLite e i dati propri della dashboard. |
| `NOSTRAXIS_CODEX_BIN` | Percorso dell'eseguibile Codex quando non è nel `PATH`. |
| `NOSTRAXIS_CLAUDE_BIN` | Percorso dell'eseguibile Claude quando non è nel `PATH`. |
| `NOSTRAXIS_COPILOT_BIN` | Percorso dell'eseguibile Copilot quando non è nel `PATH`. |
| `NOSTRAXIS_COPILOT_TOKEN` | Token di breve durata per consultare la quota personale di Copilot se non si usa `gh auth login`. Non viene salvato. |
| `NOSTRAXIS_PRICING_JSON` | Tabella prezzi per modello per stimare gli USD. |
| `NOSTRAXIS_EXPERIMENTS_ENABLED=1` | Attiva il R&D Lab e la sua API di esperimenti. |
| `NOSTRAXIS_SESSION_ROOTS_JSON` | Sostituisce le posizioni di cronologia osservate. |
| `NOSTRAXIS_SESSION_MAX_FILES` | Numero massimo di file di cronologia ispezionati. |
| `NOSTRAXIS_SESSION_MAX_AGE_DAYS` | Anzianità massima delle cronologie rilevate. |
| `NOSTRAXIS_COPILOT_OTEL_PATH` | Percorso di una telemetria OpenTelemetry Copilot esistente. |

## Risoluzione dei problemi

| Problema | Verifica e soluzione |
| --- | --- |
| Non vedo le sessioni di un fornitore | Apri **Settings**, verifica che il percorso della cronologia risulti rilevato, crea una sessione con quella CLI e premi sincronizza in **Sessions**. |
| Il fornitore risulta non disponibile | Controlla che il suo eseguibile risponda nello stesso Terminale da cui hai avviato la dashboard. Se si trova altrove, definisci la variabile `*_BIN` corrispondente. |
| Non riesco a creare una sessione | Registra prima un repository in **Repos** e selezionane uno in **New session**. L'obiettivo non può essere vuoto. |
| Non compaiono i costi | Configura `NOSTRAXIS_PRICING_JSON`; senza prezzi o senza token riportati, il costo resta non disponibile. |
| Non vedo la quota di Copilot | Esegui `gh auth login` con un account che ha Copilot oppure fornisci il token temporaneo al processo. La visibilità dipende da ciò che GitHub espone per il tuo piano. |
| Mancano campi in Compare o Analytics | La dashboard non riempie le metriche assenti. Consulta il dettaglio della sessione e confronta solo le dimensioni riportate da entrambe le fonti. |

## API locale

| Metodo | Percorso | Scopo |
| --- | --- | --- |
| `GET` | `/api/dashboard` | Dati iniziali: repository, sessioni, analitica, esperimenti e stato dei fornitori. |
| `GET` | `/api/runs/:id` | Linea temporale, contesto e dettaglio di un'esecuzione. |
| `POST` | `/api/runs` | Crea una sessione locale con un fornitore. |
| `POST` | `/api/runs/:id/cancel` | Annulla un'esecuzione della dashboard ancora attiva. |
| `POST` | `/api/session-sources/sync` | Forza la scoperta di sessioni esterne. |
| `GET` | `/api/analytics` | Aggregati filtrati e serie temporali. |
| `GET` | `/api/compare?ids=...` | Dati comparabili delle sessioni scelte. |
| `POST` | `/api/experiments` | Salva un esperimento con le sue varianti e il contesto esatto. |
| `POST` | `/api/experiments/:id/run` | Esegue le varianti di un esperimento. |
| `GET` | `/api/stream` | Aggiornamenti in tempo reale tramite Server-Sent Events. |

Consulta [architecture.md](docs/architecture.md) per l'architettura, gli adattatori e il flusso interno dei dati.

## Contribuire

I contributi sono benvenuti: segnalazioni di bug, adattatori per nuovi fornitori, traduzioni e miglioramenti alla documentazione.

1. Effettua un fork e crea un branch descrittivo.
2. Esegui `npm test` prima di aprire la pull request.
3. Descrivi quale fornitore, vista o variabile d'ambiente riguarda la tua modifica.

Se modifichi questo README, replica la modifica nelle cinque traduzioni (`README.md`, `README.es.md`, `README.fr.md`, `README.pt.md`, `README.it.md`).

## Licenza

Distribuito con licenza MIT. Consulta [LICENSE](LICENSE) per il testo completo.

<div align="center">

[Español](README.es.md) · [English](README.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Italiano](README.it.md)

</div>
