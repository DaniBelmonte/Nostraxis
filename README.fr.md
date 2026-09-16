<div align="center">

# 🔭 Nostraxis Dashboard

**Un seul panneau local pour observer, lancer et comparer le travail réalisé avec des agents de programmation.**

ChatGPT/Codex · Claude Code · GitHub Copilot CLI — sans envoyer votre historique à un service externe.

[![License: MIT](https://img.shields.io/badge/License-MIT-1f6feb.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2022.5-5fa04e?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-58c4dc?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-6-646cff?style=flat-square&logo=vite&logoColor=white)](https://vite.dev)
[![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003b57?style=flat-square&logo=sqlite&logoColor=white)](https://nodejs.org/api/sqlite.html)
[![Local-first](https://img.shields.io/badge/local--first-sans%20t%C3%A9l%C3%A9m%C3%A9trie-2ea043?style=flat-square)](#confidentialité-et-limites-des-données)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4?style=flat-square)](#contribuer)

[![Stars](https://img.shields.io/github/stars/DaniBelmonte/Nostraxis?style=flat-square&logo=github)](https://github.com/DaniBelmonte/Nostraxis/stargazers)
[![Issues](https://img.shields.io/github/issues/DaniBelmonte/Nostraxis?style=flat-square&logo=github)](https://github.com/DaniBelmonte/Nostraxis/issues)
[![Last commit](https://img.shields.io/github/last-commit/DaniBelmonte/Nostraxis?style=flat-square&logo=github)](https://github.com/DaniBelmonte/Nostraxis/commits)

### 🌐 Langue

[Español](README.es.md) · [English](README.md) · **Français** · [Português](README.pt.md) · [Italiano](README.it.md)

</div>

---

Nostraxis est un tableau de bord local permettant d'observer, de lancer et de comparer le travail réalisé avec des agents de programmation. Il réunit les sessions **ChatGPT/Codex**, **Claude Code** et **GitHub Copilot CLI** dans une même vue, sans envoyer l'historique à un service Nostraxis et sans remplacer l'authentification propre à chaque fournisseur.

Il est conçu pour deux façons de travailler :

- Consulter depuis un seul endroit les sessions déjà ouvertes avec vos outils habituels.
- L'utiliser comme votre surface de travail locale : choisir un dépôt, créer une session avec **New session** et exécuter l'agent choisi depuis ce dépôt.

## ✨ Ce qu'il apporte

| | |
| --- | --- |
| 🔌 **Multi-fournisseur** | Codex, Claude Code et Copilot CLI dans une seule vue, avec leur état de connexion. |
| 🧭 **Sessions propres et externes** | Lancez des sessions depuis le tableau de bord ou découvrez celles déjà présentes dans vos historiques locaux. |
| ⚖️ **Compare** | Comparez jusqu'à quatre sessions réelles : modèle, tokens, coût, durée, outils et fichiers. |
| 📊 **Analytics** | Agrégats par dépôt, fournisseur, modèle et plage de dates. |
| 🔒 **Local-first** | SQLite sur votre disque, aucune télémétrie propre et aucune conservation des identifiants des fournisseurs. |
| 🧪 **R&D Lab** | Matrice de variantes reproductible avec empreinte SHA-256 (optionnel). |

## 📚 Sommaire

- [Installation rapide](#installation-rapide)
- [Connecter ChatGPT/Codex, Claude et Copilot](#connecter-chatgptcodex-claude-et-copilot)
- [Travailler avec des dépôts et New session](#travailler-avec-des-dépôts-et-new-session)
- [Ce que signifie Sessions](#ce-que-signifie-sessions)
- [Comparer prompts, agents et sessions](#comparer-prompts-agents-et-sessions)
- [Utilisation, crédits et coûts](#utilisation-crédits-et-coûts)
- [Confidentialité et limites des données](#confidentialité-et-limites-des-données)
- [Configuration avancée](#configuration-avancée)
- [Dépannage](#dépannage)
- [API locale](#api-locale)
- [Contribuer](#contribuer)
- [Licence](#licence)

## Installation rapide

### Prérequis

- Node.js **22.5 ou version ultérieure**. Le stockage local utilise `node:sqlite`.
- Une ou plusieurs CLI d'agent installées et authentifiées si vous voulez lancer des sessions ou découvrir des historiques : Codex, Claude Code ou GitHub Copilot CLI.
- Git est recommandé pour enregistrer la branche et le commit de chaque dépôt ; un dossier local lisible peut aussi être enregistré.

### Démarrer le tableau de bord

Depuis ce dossier (`dashboard/`) :

```bash
npm install
npm run dev
```

Ouvrez [http://localhost:4173](http://localhost:4173). Sur macOS, vous pouvez aussi ouvrir `start-dashboard.command` ; il démarre dans sa propre fenêtre de Terminal et reste disponible tant que cette fenêtre est ouverte.

Commandes utiles :

```bash
npm test
npm run build
npm start
```

Le tableau de bord démarre sans données de démonstration. Pour un développement visuel isolé, vous pouvez utiliser :

```bash
NOSTRAXIS_SEED=1 npm run dev
```

## Connecter ChatGPT/Codex, Claude et Copilot

Aucun mot de passe ni clé d'abonnement à configurer dans l'interface. Installez et connectez-vous à la CLI de chaque fournisseur via son propre flux officiel, puis ouvrez le tableau de bord avec le même utilisateur macOS/Linux/Windows. Au démarrage, Nostraxis détecte les exécutables disponibles et les historiques locaux.

| Fournisseur | Pour lancer une session depuis le tableau de bord | Historique externe découvert | Que vérifier s'il n'apparaît pas |
| --- | --- | --- | --- |
| ChatGPT / Codex | Codex CLI authentifiée avec votre compte ChatGPT/Codex | `~/.codex/sessions` | Que `codex` soit dans le `PATH` et que vous ayez créé au moins une session locale. |
| Claude | Claude Code authentifié | `~/.claude/projects` | Que `claude auth status --json` indique une session valide et que `claude` soit dans le `PATH`. |
| GitHub Copilot | GitHub Copilot CLI authentifiée | `~/.copilot/session-state` | Que `copilot` soit dans le `PATH` ; pour le quota du compte, connectez-vous aussi avec `gh auth login`. |

Ouvrez **Settings** pour vérifier les sources détectées et l'état de chaque adaptateur. Dans **Sessions**, utilisez le bouton de synchronisation pour forcer immédiatement une nouvelle lecture des historiques. L'observateur actualise également les sources locales toutes les quelques secondes.

Si l'exécutable n'est pas dans le `PATH`, indiquez-le uniquement pour le processus du tableau de bord :

```bash
export NOSTRAXIS_CODEX_BIN='/chemin/absolu/vers/codex'
export NOSTRAXIS_CLAUDE_BIN='/chemin/absolu/vers/claude'
export NOSTRAXIS_COPILOT_BIN='/chemin/absolu/vers/copilot'
npm run dev
```

### Copilot : quota du compte

La carte Copilot peut lire le plan, la limite mensuelle, la consommation, le solde et la date de réinitialisation que GitHub expose au compte GitHub CLI actif. Elle ne réutilise ni ne conserve l'identifiant de `gh`. Si cette session n'existe pas sur la machine, vous pouvez fournir un jeton de courte durée uniquement au processus qui démarre le tableau de bord :

```bash
export NOSTRAXIS_COPILOT_TOKEN='jeton-github-avec-acces-copilot'
npm run dev
```

Le jeton n'est pas conservé. Dans les organisations Business ou Enterprise, la donnée affichée est le budget personnel lorsque GitHub l'expose ; les rapports de facturation de toute l'organisation exigent toujours leurs propres permissions.

## Travailler avec des dépôts et New session

Vous pouvez utiliser Nostraxis comme surface de travail locale pour chacun des trois agents. Le tableau de bord exécute la CLI sélectionnée dans le dossier du dépôt : il ne clone pas le code et ne déplace pas le projet ailleurs.

1. Allez dans **Repos**.
2. Collez le chemin absolu de votre dossier local, par exemple `/Users/ana/code/mon-api`, et cliquez sur **Register repository**. S'il s'agit d'un dépôt Git, la branche et le `HEAD` actuels sont également enregistrés.
3. Revenez dans **Sessions** et cliquez sur **+ New session**.
4. Choisissez le dépôt enregistré, le fournisseur et, le cas échéant, le modèle.
5. Donnez un nom, écrivez l'objectif et décidez si vous autorisez les commandes et les modifications de fichiers.
6. Cliquez sur **Create session**. La session s'exécute depuis ce dossier et reste tracée dans le tableau de bord.

Cela permet de travailler avec Codex, Claude ou Copilot tout en gardant un seul panneau pour le contexte, la sortie, les commandes, les fichiers touchés et les métriques rapportées par le fournisseur. L'option d'autoriser les écritures ne concerne que les sessions créées depuis Nostraxis ; vérifiez-la avant de lancer une tâche qui modifiera votre checkout.

## Ce que signifie Sessions

**Sessions** est l'historique opérationnel du tableau de bord. Chaque ligne représente une exécution ou une conversation détectée, étiquetée par projet, fournisseur, modèle, état et origine.

| Type de session | Origine | Ce que vous pouvez faire |
| --- | --- | --- |
| **Dashboard** | Créée avec **New session** | Voir le flux, la conversation, les commandes, les fichiers, le contexte, les métriques et annuler une exécution encore en cours. |
| **External** | Découverte dans les historiques locaux de Codex, Claude ou Copilot | Consulter et filtrer les données observées. Elle reste en lecture seule : vous devez poursuivre ou annuler cette conversation depuis son outil d'origine. |

Utilisez les onglets pour alterner entre sessions actives, récentes et toutes ; les filtres permettent de restreindre par projet, fournisseur, modèle, état, origine, activité, coût et cache. Le regroupement par projet ou par état facilite le suivi de plusieurs tâches ouvertes en même temps.

En sélectionnant une session, le panneau central affiche sa chronologie et, quand la source l'expose, les tokens, le coût, les crédits, la durée et les événements. L'inspecteur latéral conserve le dépôt, la branche, le commit, le prompt, les outils et les fichiers associés. Une valeur **Not reported** signifie que le fournisseur ne l'a pas fournie : cela n'équivaut jamais à zéro et n'est jamais estimé en silence.

## Comparer prompts, agents et sessions

La vue **Compare** sert à confronter jusqu'à quatre sessions réelles. Elle est utile aussi bien pour examiner des prompts différents que pour exécuter le même prompt plusieurs fois et évaluer des agents, des modèles ou des permissions différents.

### Flux recommandé pour un test contrôlé

1. Enregistrez le même dépôt et fixez une branche ou un commit stable.
2. Créez une session par variante dans **New session**. Pour comparer des agents, utilisez le même objectif sur Codex, Claude et/ou Copilot. Pour comparer des prompts, ne changez que le texte à évaluer.
3. Évitez de modifier les fichiers de départ entre deux exécutions, ou consignez explicitement la différence.
4. Allez dans **Compare**, cherchez les sessions par projet, modèle ou date, et sélectionnez-les.
5. Interprétez les résultats avec le `Context digest`, la sortie et les fichiers/outils utilisés ; une différence de contexte ou de tâche peut invalider une comparaison de coût ou de rapidité.

La matrice affiche le modèle, les tokens d'entrée/sortie, le coût estimé, les crédits du fournisseur, la durée, le cache, le raisonnement, l'évaluation, les outils, les fichiers, l'empreinte de contexte et la réponse finale lorsqu'ils existent. Depuis chaque colonne, vous pouvez ouvrir le détail de la session. Les champs non fournis par le fournisseur restent **Not reported**.

Pour des rapports d'usage, **Analytics** agrège les sessions par dépôt, fournisseur, modèle et plage de dates. Cela inclut une répartition par modèle, le rapport coût/tokens, une série temporelle et l'accès au détail de chaque exécution. C'est la vue adaptée pour répondre, par exemple, à la question de savoir quel agent a le plus consommé dans un dépôt ou comment le coût a évolué sur une semaine.

### Expériences reproductibles (optionnel)

Le **R&D Lab** crée une matrice de variantes avec une tâche commune et conserve le prompt rendu, le contexte, le `HEAD` du dépôt et une empreinte SHA-256 pour faciliter la répétition. Activez-le au démarrage du tableau de bord :

```bash
NOSTRAXIS_EXPERIMENTS_ENABLED=1 npm run dev
```

Les stratégies disponibles sont `raw-repo`, `knowledge-base` et `llm-wiki`. Retirez la variable ou utilisez une valeur différente de `1` pour masquer à nouveau cette fonction.

## Utilisation, crédits et coûts

En haut à droite se trouvent trois cartes : **Codex / ChatGPT**, **Claude** et **GitHub Copilot**. Cliquez sur une carte pour ouvrir le détail de la source, le modèle connu, l'état de connexion et la dernière mise à jour. Vous consultez ainsi depuis un seul endroit ce que chaque fournisseur permet d'observer.

| Fournisseur | Données centralisées quand elles sont disponibles | Portée exacte |
| --- | --- | --- |
| Codex / ChatGPT | Fenêtres de limite d'usage, crédits/solde et tokens de la session Codex la plus récente. | Les limites affichées sont celles que Codex enregistre localement ; ce n'est pas une facture consolidée de ChatGPT. |
| Claude | État d'authentification, données de la session observée et tokens/crédits rapportés par Claude. | Claude peut ne pas exposer un quota d'abonnement total dans les données locales ; il est alors indiqué comme indisponible. |
| Copilot | Plan, crédits ou requêtes premium mensuelles, consommé, disponible, date de réinitialisation et usage observé par plage de dates. | Le quota du compte et la somme des chats locaux sont des sources distinctes et ne sont pas mélangées. |

Le tableau de bord distingue trois notions à ne pas confondre :

- **Limite ou quota d'abonnement :** compteur et date de réinitialisation fournis par le fournisseur.
- **Crédits du fournisseur :** unités propres, comme les AI credits ou les premium requests de Copilot. Ce ne sont pas des dollars et ils ne sont pas comparables entre fournisseurs.
- **Coût estimé :** montant en USD calculé uniquement lorsque vous configurez des prix par modèle et que les tokens sont suffisants. Il ne remplace pas la facture du fournisseur.

Pour activer le coût estimé, définissez les prix en USD par million de tokens avant de démarrer le serveur :

```bash
export NOSTRAXIS_PRICING_JSON='{"model-id":{"inputPerMillion":1.25,"cachedInputPerMillion":0.25,"outputPerMillion":10}}'
npm run dev
```

## Confidentialité et limites des données

Nostraxis est local-first. Sa base SQLite se trouve par défaut dans `.nostraxis/dashboard.sqlite` à l'intérieur du projet du tableau de bord. Vous pouvez changer cet emplacement avec `NOSTRAXIS_DATA_DIR`.

L'observateur importe les prompts et réponses visibles, les métadonnées d'outils et l'usage rapporté par la source. Il n'importe pas les prompts système ni le raisonnement masqué. Les sessions externes relèvent de l'observation ; il n'en prend pas le contrôle.

Copilot lancé depuis Nostraxis active l'exportateur officiel OpenTelemetry vers un JSONL isolé dans `.nostraxis/copilot-otel`, avec la capture du contenu des messages désactivée. Si vous voulez enrichir des sessions Copilot externes avec une télémétrie déjà disponible, indiquez le fichier ou le répertoire :

```bash
export NOSTRAXIS_COPILOT_OTEL_PATH='/chemin/absolu/copilot-otel.jsonl'
```

Pour des historiques montés ou partagés, remplacez la liste des sources et ajustez les limites de découverte :

```bash
export NOSTRAXIS_SESSION_ROOTS_JSON='[{"provider":"codex","root":"/chemin/absolu/codex-sessions"}]'
export NOSTRAXIS_SESSION_MAX_FILES=200
export NOSTRAXIS_SESSION_MAX_AGE_DAYS=30
```

## Configuration avancée

| Variable | Finalité |
| --- | --- |
| `NOSTRAXIS_DATA_DIR` | Répertoire contenant la base SQLite et les données propres au tableau de bord. |
| `NOSTRAXIS_CODEX_BIN` | Chemin vers l'exécutable Codex lorsqu'il n'est pas dans le `PATH`. |
| `NOSTRAXIS_CLAUDE_BIN` | Chemin vers l'exécutable Claude lorsqu'il n'est pas dans le `PATH`. |
| `NOSTRAXIS_COPILOT_BIN` | Chemin vers l'exécutable Copilot lorsqu'il n'est pas dans le `PATH`. |
| `NOSTRAXIS_COPILOT_TOKEN` | Jeton de courte durée pour interroger le quota personnel Copilot si `gh auth login` n'est pas utilisé. Non conservé. |
| `NOSTRAXIS_PRICING_JSON` | Table de prix par modèle pour estimer les USD. |
| `NOSTRAXIS_EXPERIMENTS_ENABLED=1` | Active le R&D Lab et son API d'expériences. |
| `NOSTRAXIS_SESSION_ROOTS_JSON` | Remplace les emplacements d'historique observés. |
| `NOSTRAXIS_SESSION_MAX_FILES` | Nombre maximal de fichiers d'historique inspectés. |
| `NOSTRAXIS_SESSION_MAX_AGE_DAYS` | Ancienneté maximale des historiques découverts. |
| `NOSTRAXIS_COPILOT_OTEL_PATH` | Chemin vers une télémétrie OpenTelemetry Copilot existante. |

## Dépannage

| Problème | Vérification et solution |
| --- | --- |
| Je ne vois pas les sessions d'un fournisseur | Ouvrez **Settings**, confirmez que le chemin d'historique apparaît comme détecté, créez une session avec cette CLI et cliquez sur synchroniser dans **Sessions**. |
| Le fournisseur apparaît comme indisponible | Vérifiez que son exécutable répond dans le même Terminal que celui utilisé pour démarrer le tableau de bord. S'il se trouve ailleurs, définissez la variable `*_BIN` correspondante. |
| Je ne peux pas créer de session | Enregistrez d'abord un dépôt dans **Repos** et sélectionnez-en un dans **New session**. L'objectif ne peut pas être vide. |
| Aucun coût n'apparaît | Configurez `NOSTRAXIS_PRICING_JSON` ; sans prix ni tokens rapportés, le coût reste indisponible. |
| Je ne vois pas le quota Copilot | Exécutez `gh auth login` avec un compte disposant de Copilot, ou fournissez le jeton temporaire au processus. La visibilité dépend de ce que GitHub expose pour votre plan. |
| Des champs manquent dans Compare ou Analytics | Le tableau de bord ne complète pas les métriques absentes. Consultez le détail de la session et ne comparez que les dimensions rapportées par les deux sources. |

## API locale

| Méthode | Route | Finalité |
| --- | --- | --- |
| `GET` | `/api/dashboard` | Données initiales : dépôts, sessions, analytique, expériences et état des fournisseurs. |
| `GET` | `/api/runs/:id` | Chronologie, contexte et détail d'une exécution. |
| `POST` | `/api/runs` | Crée une session locale avec un fournisseur. |
| `POST` | `/api/runs/:id/cancel` | Annule une exécution du tableau de bord encore active. |
| `POST` | `/api/session-sources/sync` | Force la découverte des sessions externes. |
| `GET` | `/api/analytics` | Agrégats filtrés et séries temporelles. |
| `GET` | `/api/compare?ids=...` | Données comparables des sessions choisies. |
| `POST` | `/api/experiments` | Enregistre une expérience avec ses variantes et son contexte exact. |
| `POST` | `/api/experiments/:id/run` | Exécute les variantes d'une expérience. |
| `GET` | `/api/stream` | Mises à jour en temps réel via Server-Sent Events. |

Consultez [architecture.md](docs/architecture.md) pour l'architecture, les adaptateurs et le flux interne des données.

## Contribuer

Les contributions sont bienvenues : rapports de bug, adaptateurs de nouveaux fournisseurs, traductions et améliorations de la documentation.

1. Forkez le dépôt et créez une branche descriptive.
2. Exécutez `npm test` avant d'ouvrir la pull request.
3. Décrivez quel fournisseur, quelle vue ou quelle variable d'environnement votre changement affecte.

Si vous modifiez ce README, répercutez le changement sur les cinq traductions (`README.md`, `README.es.md`, `README.fr.md`, `README.pt.md`, `README.it.md`).

## Licence

Distribué sous licence MIT. Voir [LICENSE](LICENSE) pour le texte complet.

<div align="center">

[Español](README.es.md) · [English](README.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Italiano](README.it.md)

</div>
