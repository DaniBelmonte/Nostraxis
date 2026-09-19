<div align="center">

# 🔭 Nostraxis Dashboard

**Un único panel local para observar, lanzar y comparar el trabajo hecho con agentes de programación.**

ChatGPT/Codex · Claude Code · GitHub Copilot CLI — sin enviar tu historial a ningún servicio externo.

[![License: MIT](https://img.shields.io/badge/License-MIT-1f6feb.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2022.5-5fa04e?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-58c4dc?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-6-646cff?style=flat-square&logo=vite&logoColor=white)](https://vite.dev)
[![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003b57?style=flat-square&logo=sqlite&logoColor=white)](https://nodejs.org/api/sqlite.html)
[![Local-first](https://img.shields.io/badge/local--first-sin%20telemetr%C3%ADa-2ea043?style=flat-square)](#privacidad-y-límites-de-los-datos)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4?style=flat-square)](#contribuir)

[![Stars](https://img.shields.io/github/stars/DaniBelmonte/Nostraxis?style=flat-square&logo=github)](https://github.com/DaniBelmonte/Nostraxis/stargazers)
[![Issues](https://img.shields.io/github/issues/DaniBelmonte/Nostraxis?style=flat-square&logo=github)](https://github.com/DaniBelmonte/Nostraxis/issues)
[![Last commit](https://img.shields.io/github/last-commit/DaniBelmonte/Nostraxis?style=flat-square&logo=github)](https://github.com/DaniBelmonte/Nostraxis/commits)

### 🌐 Idioma

**Español** · [English](README.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Italiano](README.it.md)

</div>

---

Nostraxis es un dashboard local para observar, lanzar y comparar trabajo hecho con agentes de programación. Reúne sesiones de **ChatGPT/Codex**, **Claude Code** y **GitHub Copilot CLI** en una misma vista, sin enviar el historial a un servicio de Nostraxis ni sustituir la autenticación de cada proveedor.

Está pensado para dos formas de trabajo:

- Consultar desde un único sitio las sesiones que ya has abierto con tus herramientas habituales.
- Usarlo como tu panel de trabajo local: escoger un repositorio, crear una sesión con **New session** y ejecutar el agente elegido desde ese repositorio.

## ✨ Qué ofrece

| | |
| --- | --- |
| 🔌 **Multi-proveedor** | Codex, Claude Code y Copilot CLI en una sola vista, con su estado de conexión. |
| 🧭 **Sesiones propias y externas** | Lanza sesiones desde el dashboard o descubre las que ya existen en tus historiales locales. |
| ⚖️ **Compare** | Contrasta hasta cuatro sesiones reales: modelo, tokens, coste, duración, herramientas y ficheros. |
| 📊 **Analytics** | Agregados por repositorio, proveedor, modelo y rango de fechas. |
| 🔒 **Local-first** | SQLite en tu disco, sin telemetría propia y sin custodiar credenciales de proveedor. |
| 🧪 **R&D Lab** | Matriz de variantes reproducible con digest SHA-256 (opcional). |

## 📚 Contenido

- [Instalación rápida](#instalación-rápida)
- [Conectar ChatGPT/Codex, Claude y Copilot](#conectar-chatgptcodex-claude-y-copilot)
- [Trabajar con repositorios y New session](#trabajar-con-repositorios-y-new-session)
- [Qué significa Sessions](#qué-significa-sessions)
- [Comparar prompts, agentes y sesiones](#comparar-prompts-agentes-y-sesiones)
- [Uso, créditos y costes](#uso-créditos-y-costes)
- [Privacidad y límites de los datos](#privacidad-y-límites-de-los-datos)
- [Configuración avanzada](#configuración-avanzada)
- [Solución de problemas](#solución-de-problemas)
- [API local](#api-local)
- [Contribuir](#contribuir)
- [Licencia](#licencia)

## Instalación rápida

### Requisitos

- Node.js **22.5 o posterior**. El almacenamiento local utiliza `node:sqlite`.
- Una o más CLIs de agente instaladas y autenticadas si quieres lanzar sesiones o descubrir historiales: Codex, Claude Code o GitHub Copilot CLI.
- Git es recomendable para registrar la rama y el commit de cada repositorio; también se puede registrar una carpeta local legible.

### Iniciar el dashboard

Desde esta carpeta (`dashboard/`):

```bash
npm install
npm run dev
```

Abre [http://localhost:4173](http://localhost:4173). En macOS también puedes abrir `start-dashboard.command`; se iniciará en su propia ventana de Terminal y seguirá disponible mientras esa ventana esté abierta.

Comandos útiles:

```bash
npm test
npm run build
npm start
```

El dashboard empieza sin datos de demostración. Para desarrollo visual aislado puedes usar:

```bash
NOSTRAXIS_SEED=1 npm run dev
```

## Conectar ChatGPT/Codex, Claude y Copilot

No hay contraseñas ni claves de suscripción que configurar dentro de la interfaz. Instala e inicia sesión en la CLI de cada proveedor con su propio flujo oficial y abre el dashboard desde el mismo usuario de macOS/Linux/Windows. Al arrancar, Nostraxis detecta los ejecutables disponibles y los historiales locales.

| Proveedor | Para lanzar una sesión desde el dashboard | Historial externo que se descubre | Qué revisar si no aparece |
| --- | --- | --- | --- |
| ChatGPT / Codex | Codex CLI autenticada con tu cuenta de ChatGPT/Codex | `~/.codex/sessions` | Que `codex` esté en `PATH` y que hayas creado al menos una sesión local. |
| Claude | Claude Code autenticado | `~/.claude/projects` | Que `claude auth status --json` indique una sesión válida y que `claude` esté en `PATH`. |
| GitHub Copilot | GitHub Copilot CLI autenticada | Sesiones de Copilot CLI/Agent en `${COPILOT_HOME:-$HOME/.copilot}/session-state`, más sesiones locales de Copilot Chat de VS Code Stable e Insiders en `workspaceStorage` | Revisa por separado la fuente correspondiente en **Settings**; para la cuota de cuenta, inicia sesión también con `gh auth login`. |

Abre **Settings** para comprobar las fuentes detectadas y el estado de cada adaptador. En **Sessions**, usa el botón de sincronización para forzar de inmediato una nueva lectura de los historiales. El observador también actualiza automáticamente las fuentes locales cada pocos segundos.

Que Copilot aparezca conectado solo confirma que su ejecutable o cuenta está disponible; no significa que todas las conversaciones locales usen el mismo almacén. Nostraxis distingue **GitHub Copilot CLI / Agent** y **VS Code Copilot Chat**. El adaptador de VS Code reconstruye los diarios locales `chatSessions`, importa únicamente mensajes visibles y tokens o créditos AI reportados, y los asocia con la carpeta indicada por el `workspace.json` contiguo. Los historiales de otro ordenador no se descargan desde GitHub. SSH remoto, Dev Container, `--user-data-dir` personalizado, VSCodium u otras instalaciones pueden guardar los datos en otro lugar; configura sus raíces locales `workspaceStorage` mediante `NOSTRAXIS_VSCODE_CHAT_ROOTS_JSON`.

Si el ejecutable no está en la variable `PATH`, indícalo solo para el proceso del dashboard:

```bash
export NOSTRAXIS_CODEX_BIN='/ruta/absoluta/a/codex'
export NOSTRAXIS_CLAUDE_BIN='/ruta/absoluta/a/claude'
export NOSTRAXIS_COPILOT_BIN='/ruta/absoluta/a/copilot'
npm run dev
```

### Copilot: cuota de cuenta

La tarjeta de Copilot puede leer el plan, el límite mensual, el consumo, el saldo y la fecha de reinicio que GitHub expone a la cuenta activa de GitHub CLI. No reutiliza ni guarda la credencial de `gh`. Si esa sesión no existe en la máquina, puedes proporcionar un token de corta duración únicamente al proceso que inicia el dashboard:

```bash
export NOSTRAXIS_COPILOT_TOKEN='token-de-github-con-acceso-a-copilot'
npm run dev
```

El token no se persiste. En organizaciones Business o Enterprise, el dato mostrado es el presupuesto personal cuando GitHub lo expone; los informes de facturación de toda la organización siguen requiriendo sus permisos propios.

## Trabajar con repositorios y New session

Puedes utilizar Nostraxis como tu superficie de trabajo local para cualquiera de los tres agentes. El dashboard ejecuta la CLI seleccionada en la carpeta del repositorio: no clona el código ni mueve el proyecto a otro lugar.

1. Ve a **Repos**.
2. Pega la ruta absoluta de tu carpeta local, por ejemplo `/Users/ana/code/mi-api`, y pulsa **Register repository**. Si es un repositorio Git, se guardan también la rama y el `HEAD` actual.
3. Vuelve a **Sessions** y pulsa **+ New session**.
4. Elige el repositorio registrado, el proveedor y, si procede, el modelo.
5. Asigna un nombre, escribe el objetivo y decide si permites comandos y cambios de archivos.
6. Pulsa **Create session**. La sesión se ejecuta desde esa carpeta y queda trazada en el dashboard.

Esto permite trabajar con Codex, Claude o Copilot sin dejar de usar un único panel para el contexto, la salida, los comandos, los ficheros tocados y las métricas que el proveedor haya informado. La opción de permitir escrituras solo afecta a las sesiones creadas desde Nostraxis; revísala antes de iniciar una tarea que vaya a modificar tu checkout.

## Qué significa Sessions

**Sessions** es el historial operativo del dashboard. Cada fila representa una ejecución o conversación detectada y se etiqueta por proyecto, proveedor, modelo, estado y origen.

| Tipo de sesión | Origen | Qué puedes hacer |
| --- | --- | --- |
| **Dashboard** | Creada con **New session** | Ver el stream, la conversación, comandos, ficheros, contexto, métricas y cancelar una ejecución que siga en curso. |
| **External** | Descubierta en los historiales locales de Codex, Claude o Copilot | Consultar y filtrar los datos observados. Se mantiene en solo lectura: debes continuar o cancelar esa conversación desde su herramienta original. |

Usa las pestañas para alternar entre sesiones activas, recientes y todas; los filtros permiten acotar por proyecto, proveedor, modelo, estado, origen, actividad, coste y caché. La agrupación por proyecto o por estado facilita seguir varias tareas abiertas a la vez.

Al seleccionar una sesión, el panel central muestra su cronología y, cuando la fuente lo expone, tokens, coste, créditos, duración y eventos. La duración es el **tiempo activo**: los intervalos en los que el agente estaba reportando trabajo, medidos con las marcas de tiempo reales de los eventos. El tiempo previo a cada acción del usuario y los silencios largos quedan fuera, de modo que una conversación retomada al día siguiente no se lee como un día de ejecución. Junto a él aparecen el **intervalo de la conversación** y el **último turno**, para poder medir la última interacción por separado. El inspector lateral conserva el repositorio, rama, commit, prompt, herramientas y ficheros relacionados. Un valor **Not reported** o **No reportado** significa que el proveedor no lo entregó: nunca equivale a cero ni se estima silenciosamente.

## Comparar prompts, agentes y sesiones

La vista **Compare** sirve para contrastar hasta cuatro sesiones reales. Es útil tanto para revisar prompts distintos como para ejecutar el mismo prompt varias veces y evaluar agentes, modelos o permisos diferentes.

### Flujo recomendado para una prueba controlada

1. Registra el mismo repositorio y fija una rama o commit estable.
2. Crea una sesión por variante en **New session**. Para comparar agentes, usa el mismo objetivo en Codex, Claude y/o Copilot. Para comparar prompts, cambia solo el texto que quieres evaluar.
3. Evita cambios entre ejecuciones en los ficheros de partida, o registra explícitamente la diferencia.
4. Ve a **Compare**, busca las sesiones por proyecto, modelo o fecha y selecciónalas.
5. Interpreta los resultados junto con el `Context digest`, el output y los ficheros/herramientas usados; una diferencia de contexto o de tarea puede invalidar una comparación de coste o velocidad.

La matriz muestra modelo, tokens de entrada/salida, coste estimado, créditos del proveedor, duración, caché, razonamiento, evaluación, herramientas, ficheros, digest de contexto y respuesta final cuando existen. Desde cada columna puedes abrir el detalle de la sesión. Los campos no proporcionados por el proveedor permanecen como **Not reported**.

Para reportes de uso, **Analytics** agrega las sesiones por repositorio, proveedor, modelo y rango de fechas. Incluye desglose por modelo, relación coste/tokens, serie temporal y acceso al detalle de cada ejecución. Esta es la vista adecuada para responder, por ejemplo, qué agente ha consumido más en un repositorio o cómo ha evolucionado el coste de una semana.

### Experimentos reproducibles (opcional)

El **R&D Lab** crea una matriz de variantes con una tarea común y conserva el prompt renderizado, el contexto, el `HEAD` del repositorio y un digest SHA-256 para facilitar la repetición. Actívalo al iniciar el dashboard:

```bash
NOSTRAXIS_EXPERIMENTS_ENABLED=1 npm run dev
```

Las estrategias disponibles son `raw-repo`, `knowledge-base` y `llm-wiki`. Desactiva la variable o usa un valor distinto de `1` para ocultar de nuevo esta función.

## Uso, créditos y costes

En la parte superior derecha hay tres tarjetas: **Codex / ChatGPT**, **Claude** y **GitHub Copilot**. Pulsa una tarjeta para abrir el detalle de la fuente, el modelo conocido, el estado de conexión y la última actualización. Así puedes consultar desde un único sitio lo que cada proveedor permite observar.

| Proveedor | Datos centralizados cuando están disponibles | Alcance correcto |
| --- | --- | --- |
| Codex / ChatGPT | Ventanas de límite de uso, créditos/saldo y tokens de la sesión Codex más reciente. | Los límites mostrados son los que Codex registra localmente; no son una factura consolidada de ChatGPT. |
| Claude | Estado de autenticación, datos de la sesión observada y tokens/créditos que Claude informe. | Claude puede no exponer una cuota de suscripción total en los datos locales; en ese caso se muestra como no disponible. |
| Copilot | Plan, créditos o solicitudes premium mensuales, usado, disponible, fecha de reinicio y consumo observado por intervalo de fechas. | La cuota de cuenta y la suma de chats locales son fuentes distintas y no se mezclan. |

El dashboard distingue tres conceptos que no deben confundirse:

- **Límite o cuota de suscripción:** contador y fecha de reinicio que proporciona el proveedor.
- **Créditos del proveedor:** unidades propias, como AI credits o premium requests de Copilot. No son dólares ni son comparables entre proveedores.
- **Coste estimado:** importe en USD calculado solo cuando configuras precios por modelo y hay tokens suficientes. No sustituye a la factura del proveedor.

Para habilitar coste estimado, define precios en USD por millón de tokens antes de iniciar el servidor:

```bash
export NOSTRAXIS_PRICING_JSON='{"model-id":{"inputPerMillion":1.25,"cachedInputPerMillion":0.25,"outputPerMillion":10}}'
npm run dev
```

## Privacidad y límites de los datos

Nostraxis es local-first. Su base SQLite vive por defecto en `.nostraxis/dashboard.sqlite` dentro del proyecto del dashboard. Puedes cambiar esa ubicación con `NOSTRAXIS_DATA_DIR`.

El observador importa prompts y respuestas visibles, metadatos de herramientas y uso que la fuente haya reportado. No importa prompts de sistema ni razonamiento oculto. Las sesiones externas son de observación; no toma control de ellas.

Para Copilot Chat de VS Code, Nostraxis lee el diario local del editor, pero excluye entradas ocultas, instrucciones del agente, cargas de herramientas y bloques de razonamiento. El formato es interno de VS Code; los registros futuros desconocidos se ignoran en lugar de inferirse.

Copilot lanzado desde Nostraxis habilita el exportador oficial OpenTelemetry a un JSONL aislado en `.nostraxis/copilot-otel`, con captura de contenido de mensajes desactivada. Si quieres enriquecer sesiones Copilot externas con telemetría que ya tengas, indica el fichero o directorio:

```bash
export NOSTRAXIS_COPILOT_OTEL_PATH='/ruta/absoluta/copilot-otel.jsonl'
```

Para historiales montados o compartidos, sustituye la lista de fuentes y ajusta los límites de descubrimiento:

```bash
export NOSTRAXIS_SESSION_ROOTS_JSON='[{"provider":"codex","root":"/ruta/absoluta/codex-sessions"}]'
export NOSTRAXIS_SESSION_MAX_FILES=200
export NOSTRAXIS_SESSION_MAX_AGE_DAYS=30
```

## Configuración avanzada

| Variable | Finalidad |
| --- | --- |
| `NOSTRAXIS_DATA_DIR` | Directorio que contendrá la base SQLite y datos propios del dashboard. |
| `NOSTRAXIS_CODEX_BIN` | Ruta al ejecutable de Codex cuando no está en `PATH`. |
| `NOSTRAXIS_CLAUDE_BIN` | Ruta al ejecutable de Claude cuando no está en `PATH`. |
| `NOSTRAXIS_COPILOT_BIN` | Ruta al ejecutable de Copilot cuando no está en `PATH`. |
| `COPILOT_HOME` | Directorio de configuración y estado de Copilot. Nostraxis lee su subdirectorio `session-state` cuando está definido. |
| `NOSTRAXIS_COPILOT_TOKEN` | Token de corta duración para consultar la cuota personal de Copilot si no se usa `gh auth login`. No se guarda. |
| `NOSTRAXIS_VSCODE_CHAT_ROOTS_JSON` | Array JSON de raíces `workspaceStorage` adicionales o personalizadas de VS Code; reemplaza los valores predeterminados de esta fuente. |
| `NOSTRAXIS_PRICING_JSON` | Tabla de precios por modelo para estimar USD. |
| `NOSTRAXIS_EXPERIMENTS_ENABLED=1` | Activa R&D Lab y su API de experimentos. |
| `NOSTRAXIS_SESSION_ROOTS_JSON` | Reemplaza las ubicaciones de historial que se observan. |
| `NOSTRAXIS_SESSION_MAX_FILES` | Máximo de ficheros de historial que se inspeccionan. |
| `NOSTRAXIS_SESSION_MAX_AGE_DAYS` | Antigüedad máxima de los historiales descubiertos. |
| `NOSTRAXIS_COPILOT_OTEL_PATH` | Ruta a telemetría OpenTelemetry existente de Copilot. |

## Solución de problemas

| Problema | Comprobación y solución |
| --- | --- |
| No veo sesiones de un proveedor | Abre **Settings**, confirma que la ruta de historial aparece como detectada, crea una sesión con esa CLI y pulsa sincronizar en **Sessions**. |
| No veo un chat de Copilot de VS Code | Comprueba que **VS Code Copilot Chat** aparece detectado en **Settings**. Stable e Insiders son automáticos; instalaciones remotas, con datos personalizados o de otros editores requieren `NOSTRAXIS_VSCODE_CHAT_ROOTS_JSON`. |
| El proveedor aparece como no disponible | Comprueba que su ejecutable responde en la misma Terminal con la que arrancaste el dashboard. Si está en otra ubicación, define la variable `*_BIN` correspondiente. |
| No puedo crear una sesión | Primero registra un repositorio en **Repos** y selecciona uno en **New session**. El objetivo no puede estar vacío. |
| No aparecen costes | Configura `NOSTRAXIS_PRICING_JSON`; sin precios o sin tokens reportados, el coste se mantiene como no disponible. |
| No veo la cuota de Copilot | Ejecuta `gh auth login` con una cuenta que tenga Copilot o proporciona el token temporal al proceso. La visibilidad depende de lo que GitHub exponga para tu plan. |
| Faltan campos en Compare o Analytics | El dashboard no rellena métricas ausentes. Consulta el detalle de la sesión y compara solo dimensiones que ambas fuentes hayan reportado. |

## API local

| Método | Ruta | Finalidad |
| --- | --- | --- |
| `GET` | `/api/dashboard` | Datos iniciales: repositorios, sesiones, analítica, experimentos y estado de proveedores. |
| `GET` | `/api/runs/:id` | Línea temporal, contexto y detalle de una ejecución. |
| `POST` | `/api/runs` | Crea una sesión local con un proveedor. |
| `POST` | `/api/runs/:id/cancel` | Cancela una ejecución del dashboard que siga activa. |
| `POST` | `/api/session-sources/sync` | Fuerza el descubrimiento de sesiones externas. |
| `GET` | `/api/analytics` | Agregados filtrados y series temporales. |
| `GET` | `/api/compare?ids=...` | Datos comparables de las sesiones elegidas. |
| `POST` | `/api/experiments` | Guarda un experimento con sus variantes y contexto exacto. |
| `POST` | `/api/experiments/:id/run` | Ejecuta las variantes de un experimento. |
| `GET` | `/api/stream` | Actualizaciones en tiempo real mediante Server-Sent Events. |

Consulta [architecture.md](docs/architecture.md) para la arquitectura, los adaptadores y el flujo interno de datos.

## Contribuir

Las contribuciones son bienvenidas: informes de error, adaptadores de nuevos proveedores, traducciones y mejoras de documentación.

1. Haz un fork y crea una rama descriptiva.
2. Ejecuta `npm test` antes de abrir el pull request.
3. Describe qué proveedor, vista o variable de entorno afecta tu cambio.

Si cambias este README, replica el cambio en las cinco traducciones (`README.md`, `README.es.md`, `README.fr.md`, `README.pt.md`, `README.it.md`).

## Licencia

Distribuido bajo la licencia MIT. Consulta [LICENSE](LICENSE) para el texto completo.

<div align="center">

[Español](README.es.md) · [English](README.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Italiano](README.it.md)

</div>
