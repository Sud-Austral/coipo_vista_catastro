# Implementación SEO para buscadores, asistentes de IA y vistas previas

> **Para quién es esto.** Para un agente de IA (Claude Code u otro) que tiene que hacer que un
> sitio de la flota —u otro proyecto— sea **legible, citable y compartible** por:
> - buscadores (Google, Bing);
> - asistentes de IA (ChatGPT, Claude, Perplexity, Copilot, Gemini);
> - vistas previas de redes (WhatsApp, Facebook, X, LinkedIn, Telegram).
>
> Está destilado de la implementación completa en `Sud-Austral/coipo_boton_rojo` (PR #16, rama
> `p7-medicion`, medida E9, DECISIONES §AL), incluidos los errores que aparecieron en el camino. Si
> tienes acceso a ese repositorio, **lee su código**: aquí van los patrones y las plantillas; allá,
> la versión probada.
>
> Léela entera antes de tocar nada. El orden de las fases importa, y la sección 2 lista decisiones
> que **no te corresponde tomar a ti**.

---

## Índice

0. [Cómo trabajar con esta guía](#0-cómo-trabajar-con-esta-guía)
1. [El problema, en una página](#1-el-problema-en-una-página)
2. [Decisiones que toma una persona, no el agente](#2-decisiones-que-toma-una-persona-no-el-agente)
3. [Fase 0 — Diagnóstico en vivo](#3-fase-0--diagnóstico-en-vivo)
4. [Fase 1 — Rastreo y metadatos](#4-fase-1--rastreo-y-metadatos)
5. [Fase 2 — Texto fijo en el HTML (prerender)](#5-fase-2--texto-fijo-en-el-html-prerender)
6. [Fase 3 — Páginas por entidad, generadas con los datos del día](#6-fase-3--páginas-por-entidad-generadas-con-los-datos-del-día)
7. [Fase 4 — Servirlas: nginx, SSI y la prueba de comportamiento](#7-fase-4--servirlas-nginx-ssi-y-la-prueba-de-comportamiento)
8. [Fase 5 — Tarjetas PNG para la vista previa](#8-fase-5--tarjetas-png-para-la-vista-previa)
9. [Fase 6 — Botón «Compartir»](#9-fase-6--botón-compartir)
10. [Fase 7 — Medición en tres etapas](#10-fase-7--medición-en-tres-etapas)
11. [Gobernanza y registro](#11-gobernanza-y-registro)
12. [Trampas reales: síntoma, causa y arreglo](#12-trampas-reales-síntoma-causa-y-arreglo)
13. [Lista de aceptación final](#13-lista-de-aceptación-final)
14. [Adaptar a otras arquitecturas](#14-adaptar-a-otras-arquitecturas)
15. [Fuentes primarias](#15-fuentes-primarias)

---

## 0. Cómo trabajar con esta guía

1. **Lee primero las reglas del repositorio de destino**: `CLAUDE.md`, `DECISIONES.md` o su
   equivalente, el plan vigente y el CI. Las reglas de ese repositorio mandan sobre esta guía.
   En la flota coipo, algunas se repiten:
   - toda decisión se registra con la cifra y el comando que la reproduce;
   - toda guarda tiene un control negativo;
   - las escrituras son atómicas;
   - el contrato de datos lleva versión;
   - cada push a `main` despliega.
2. **Haz la Fase 0 antes de proponer nada.** El diagnóstico cambia el plan. En el Botón Rojo, el
   hallazgo más grave —Google no veía las cifras— no estaba en el pedido original.
3. **Pregunta lo de la sección 2 antes de escribir código** que dependa de ello.
4. **Un paso, un commit, y cada commit pasa la compuerta por sí solo.**
   - **Abre los PR contra `main`**, no apilados. En el Botón Rojo, una pila de PR terminó con lo
     mezclado en ramas intermedias y nada llegó a producción.
   - Si el repo mezcla con *squash*, retargetear una pila es aún peor.
5. **Verifica en local lo que el CI no pueda verificar.** Si Actions está caído (facturación, cuota),
   levanta el mismo nginx en local (sección 7.6) y corre el recorrido en navegador.
6. **Consejo operativo para agentes.** Para ediciones con escapes (`\n`, `<`, regex), no metas
   Python ni sed dentro de un heredoc de bash: los escapes se pierden y rompen el archivo. Escribe el
   script de edición en un archivo aparte, o usa la herramienta de edición.
   - Conserva los finales de línea: `DECISIONES.md` y similares suelen ser CRLF.
   - Después de editar, cuenta `\r\n` y `\n` sueltos.

---

## 1. El problema, en una página

Hay tres clases de lectores automáticos, y ninguno ve lo que ve una persona:

| Lector | ¿Ejecuta JS? | Qué lee | Qué necesita |
|---|---|---|---|
| **Googlebot** (también alimenta AI Overviews y AI Mode) | Sí, en diferido | El DOM renderizado, **si puede bajar los datos** | Que `robots.txt` no bloquee lo que la app carga; canonical; sitemap |
| **Rastreadores de asistentes**: OAI-SearchBot, Claude-SearchBot, PerplexityBot, y los *-User que leen por encargo de una persona | **No** | Solo el HTML que llega | Texto útil **en el HTML**: qué es, las cifras con su fecha y la fuente |
| **Vistas previas**: WhatsApp, facebookexternalhit, Twitterbot, LinkedInBot, TelegramBot | **No** | Las `og:*` y `twitter:*` del `<head>` | Etiquetas por URL, imagen absoluta de 1200×630 de menos de 300 kB, y **fecha visible** (se cachean durante días) |

**El caso típico de la flota:** una SPA de React y Vite cuyo `index.html` trae `<div id="root"></div>`
y nada más. Los datos llegan por `fetch` desde un volumen (`/datos/`) que escribe un ETL, y el HTML
se hornea en la imagen con cada commit. Consecuencias:

- **Los asistentes ven solo `<title>` y `description`.** Comprobado con un lector de IA: no pudo
  responder «¿hay riesgo en Vallenar mañana?».
- **Si `robots.txt` bloquea `/datos/`, Googlebot renderiza la página de error**, porque no puede
  bajar los JSON.
- **Compartir `/?entidad=X` muestra la vista previa genérica**, y Facebook consolida el enlace en `/`.
- **No se pueden escribir las cifras del día en `index.html`.** Se hornea al construir y quedaría
  anunciando la cifra del día del commit durante semanas.

**La arquitectura de la solución, en tres capas**, cada una donde vive su dato:

| Capa | Cuándo se genera | Qué lleva | Cómo llega al HTML |
|---|---|---|---|
| **Fija** | Al construir la imagen | Qué es el sistema, cómo leerlo, estado de publicación | Prerender dentro de `#root` |
| **Del día, en la portada** | Con cada corrida del ETL | Frase citable nacional y vista previa del día | nginx con **SSI** mete fragmentos que escribe el ETL |
| **Páginas del día** | Con cada corrida del ETL | Una página por entidad, más una índice, con frase, tabla, JSON-LD y vista previa propia | HTML estático en el volumen, servido por nginx |

**La medición, en tres etapas**, cada una con su fuente:

| Etapa | Pregunta | Fuente |
|---|---|---|
| Rastreo | ¿Los bots vienen y leen? | Logs de nginx, por User-Agent |
| Cita | ¿Los asistentes nos citan? | Bing Webmaster → AI Performance; Search Console → informe de IA generativa |
| Clic | ¿Alguien llega desde un asistente? | Umami: referentes de asistentes y `utm_source` |

---

## 2. Decisiones que toma una persona, no el agente

**Pregúntalas** (AskUserQuestion o equivalente), con una opción recomendada, y **regístralas** con
nombre y fecha. Todas son decisiones institucionales o de riesgo.

1. **¿Se indexa?**
   - Si el sistema está en validación o marcha blanca, puede que el plan del repo pida `noindex`.
   - Opciones:
     - a) indexar ya, con el estado dentro de cada frase citable (lo que se eligió en el Botón Rojo);
     - b) preparar todo e indexar al corte;
     - c) mixto: se indexa la explicación y las cifras llevan `noindex`.
   - No combines `Disallow: /` con `noindex`: se anulan. Un rastreador que obedece `Disallow` nunca
     lee el `noindex`.
2. **¿Bots de entrenamiento?** (GPTBot, ClaudeBot, CCBot, Applebot-Extended, meta-externalagent,
   Bytespider)
   - Si la licencia de los datos es no comercial, o no está resuelta, se recomienda bloquearlos
     hasta resolverla.
   - Bloquearlos **no** impide que los asistentes citen el sitio: eso lo hacen los bots de búsqueda
     y los *-User.
   - Google-Extended controla también el anclaje de Gemini, así que decide por separado.
3. **¿Cómo se identifica el sitio en una frase citable?**
   - Si hay un sistema oficial que publica cifras distintas: «según la réplica en validación de X
     (Unidad), que todavía no reemplaza a X operativo», con un enlace al operativo.
   - No te presentes como la fuente oficial si no lo eres.
4. **¿Qué dice la página de una entidad sin datos o sin alerta?**
   - Riesgo de **falso negativo**: un asistente citará «no hay riesgo en X».
   - Opciones: con advertencia e indexable; con advertencia y `noindex`; o sin página.
   - La frase nunca afirma ausencia de riesgo. Dice «esta réplica no marca…; eso no significa…».
5. **¿La portada muestra las cifras del día al compartirla?**
   - Con SSI la portada lleva cifras del día, pero Facebook y LinkedIn cachean la vista previa días.
   - Sin SSI queda atemporal, y lo del día se comparte desde las páginas del día.
6. **¿Imagen propia por entidad?**
   - Con tarjetas PNG por entidad hay que agregar Pillow u otra dependencia.
   - La alternativa es solo texto por entidad, con imagen genérica.
7. **¿IndexNow?** Es un envío diario a un servicio externo. Recomendado: implementarlo **apagado**,
   encendido por una variable de entorno del servidor.
8. **Cuentas de Search Console y Bing:** una **cuenta funcional** de la unidad, con dos
   responsables nombrados. Nunca una personal.
9. **Paso 0 si el CI está en rojo por otra causa:** ¿lo arreglas primero? Recomendado: sí, en su
   propio PR.

---

## 3. Fase 0 — Diagnóstico en vivo

Todo es de solo lectura. Guarda el resultado en el plan: es la línea base.

### 3.1 Qué recibe cada lector

```bash
S=https://SITIO.example
declare -A UA=(
 [navegador]="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
 [Googlebot]="Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
 [bingbot]="Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"
 [OAI-SearchBot]="Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot"
 [ChatGPT-User]="Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot"
 [GPTBot]="Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot"
 [Claude-SearchBot]="Mozilla/5.0 (compatible; Claude-SearchBot/1.0)"
 [Claude-User]="Mozilla/5.0 (compatible; Claude-User/1.0)"
 [ClaudeBot]="Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)"
 [PerplexityBot]="Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)"
 [Perplexity-User]="Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0)"
 [WhatsApp]="WhatsApp/2.23.20.0"
 [facebookexternalhit]="facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
 [Twitterbot]="Twitterbot/1.0"
 [LinkedInBot]="LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)"
 [TelegramBot]="TelegramBot (like TwitterBot)"
)
printf "%-20s %-5s %-8s %s\n" BOT HTTP BYTES robots.txt
for k in "${!UA[@]}"; do
  r=$(curl -sS -o /dev/null --max-time 20 -A "${UA[$k]}" -w "%{http_code} %{size_download}" $S/)
  rb=$(curl -sS -o /dev/null --max-time 20 -A "${UA[$k]}" -w "%{http_code}" $S/robots.txt)
  printf "%-20s %-5s %-8s %s\n" "$k" ${r% *} ${r#* } "$rb"
done
```

- Si todos reciben 200 y los mismos bytes, no hay filtro por User-Agent.
- Esto **no descarta un filtro por IP** (WAF, balanceador). Eso lo confirma la Inspección de URL
  de Search Console.

### 3.2 Qué hay en el HTML sin JavaScript

```bash
curl -s $S/ | sed -n '/<body/,/<\/body>/p' | sed -e 's/<script[^>]*>.*<\/script>//g' -e 's/<[^>]*>//g' | tr -s ' \n'
curl -sI $S/ | grep -iE 'x-robots-tag|content-type|cache-control'
curl -s $S/robots.txt; curl -s $S/sitemap.xml
curl -s "$S/?entidad=X" | grep -oE '<meta property="og:(title|url)"[^>]*>'   # ¿vista previa por entidad?
curl -sI http://SITIO.example/ | head -3                                     # ¿301 o 307 a https?
```

Anota:
- ¿el `<body>` está vacío?
- ¿hay `canonical`?
- ¿`og:url` apunta a la raíz desde cualquier URL?
- ¿`robots.txt` bloquea la ruta de la que la app carga sus datos? **Ese es el error más caro:**
  Googlebot renderiza entonces la página de error.

### 3.3 Qué ve un asistente

Pide a una herramienta de lectura web (WebFetch o similar) que describa la página y responda una
pregunta concreta con ella, del tipo «¿qué dice sobre la entidad X mañana?». Si no puede, es el
síntoma.

### 3.4 La analítica: ¿cuenta a quien vuelve?

Si el sitio tiene service worker y la analítica se inyecta en el nginx del host con `sub_filter`
(como Umami en la flota):

```bash
curl -s -H 'Accept: text/html' -H 'Accept-Encoding: gzip' $S/ | gunzip | grep -c conaf.js   # 1
curl -s -H 'Accept: */*'       -H 'Accept-Encoding: gzip' $S/ | gunzip | grep -c conaf.js   # 0 = defecto
```

Si la segunda da 0, el service worker está escondiendo a quien vuelve (sección 4.5).

### 3.5 Presencia en índices

- `site:SITIO` en google.com y bing.com, a mano. Las consultas automatizadas a Bing o DuckDuckGo
  suelen devolver basura o nada.
- Search Console y Bing Webmaster lo dicen con certeza, pero hay que verificar la propiedad.

### 3.6 Dónde están los logs

- En la flota, el vhost del **host** escribe el log duradero; el nombre puede venir heredado de
  otra aplicación.
- El del contenedor va a json-file de Docker y se pierde en cada despliegue.
- Si delante hay un balanceador, `$remote_addr` es el balanceador: los bots solo se identifican
  por User-Agent.

---

## 4. Fase 1 — Rastreo y metadatos

### 4.1 `robots.txt`

```text
# <Sitio> — <Unidad>. Se indexa CON AVISO (DECISIONES §<x>).
# Los que ENTRENAN no pasan hasta que se resuelva la licencia. Bloquearlos no impide que los
# asistentes citen el sitio: eso lo hacen OAI-SearchBot, Claude-SearchBot, PerplexityBot y los *-User.
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: CCBot
User-agent: Applebot-Extended
User-agent: meta-externalagent
User-agent: Bytespider
Disallow: /

# Todos los demás. Un bot con grupo propio deja de leer este (RFC 9309 §2.2.1).
# NO bloquear la ruta de la que la app carga sus datos: Googlebot la necesita para renderizar.
# Que un JSON no salga como resultado suelto lo resuelve `X-Robots-Tag: noindex` en nginx.
User-agent: *
Allow: /
Disallow: /health

Sitemap: https://SITIO.example/sitemap.xml
Sitemap: https://SITIO.example/sitemap-entidades.xml
```

Reglas:
- **URL absolutas** en `Sitemap:`; pueden ser varias líneas.
- **Nunca** `Disallow: /` junto con `noindex`.
- `ChatGPT-User` y `Perplexity-User` declaran que pueden no respetar `robots.txt`. No cuentes con
  bloquearlos ahí.

### 4.2 La guarda de `robots.txt`, leída como un rastreador (RFC 9309)

No uses `urllib.robotparser` ni una lectura de «la primera regla que casa». RFC 9309 dice:
- el grupo propio desplaza a `*`;
- entre las reglas que casan, gana la de **ruta más larga**, y en empate gana `Allow`;
- `*` es comodín y `$` ancla el final.

Con `Allow: /` antes de `Disallow: /x/`, `robotparser` dice «permitido» y Google bloquea.

Plantilla en JS, para `prebuild`:

```js
function grupos(texto) {
  const salida = []; let actual = null; let enReglas = false
  for (const cruda of texto.split(/\r?\n/)) {
    const m = cruda.replace(/#.*/, '').trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
    if (!m) continue
    const c = m[1].toLowerCase(), v = m[2].trim()
    if (c === 'user-agent') {
      if (!actual || enReglas) { actual = { agentes: [], reglas: [] }; salida.push(actual); enReglas = false }
      actual.agentes.push(v.toLowerCase())
    } else if ((c === 'allow' || c === 'disallow') && actual) {
      enReglas = true
      if (v) actual.reglas.push({ permite: c === 'allow', ruta: v })
    }
  }
  return salida
}
function coincide(patron, ruta) {
  const ancla = patron.endsWith('$')
  const cuerpo = (ancla ? patron.slice(0, -1) : patron).split('*')
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${cuerpo}${ancla ? '$' : ''}`).test(ruta)
}
export function permitido(texto, agente, ruta) {
  const todos = grupos(texto)
  const propio = todos.filter((g) => g.agentes.includes(agente.toLowerCase()))
  const aplicables = propio.length ? propio : todos.filter((g) => g.agentes.includes('*'))
  let mejor = null
  for (const r of aplicables.flatMap((g) => g.reglas)) {
    if (!coincide(r.ruta, ruta)) continue
    if (!mejor || r.ruta.length > mejor.ruta.length || (r.ruta.length === mejor.ruta.length && r.permite)) mejor = r
  }
  return mejor ? mejor.permite : true
}
```

La guarda:
- exige que `CITAN` (Googlebot, Bingbot, OAI-SearchBot, ChatGPT-User, Claude-SearchBot,
  Claude-User, PerplexityBot, Perplexity-User, más los de vista previa) lean `/`, las páginas del
  día y la ruta de datos;
- exige que `ENTRENAN` no lean `/`, que nadie lea `/health`, y que los `Sitemap` sean absolutos;
- **primero corre sus negativas**, con muestras rotas que tiene que cazar:
  - bloquear la ruta de datos;
  - `Disallow: /`;
  - un grupo propio que bloquee a un asistente;
  - un bot de entrenamiento sin bloquear;
  - `/health` abierto;
  - un `Disallow` largo después de `Allow: /`;
  - un `Sitemap` relativo.

Si alguna negativa pasa, el comprobador está roto y sale con código 1.

### 4.3 `X-Robots-Tag: noindex` en la ruta de datos (nginx)

En **cada** `location` de datos: `add_header` no se hereda entre `location`.

```nginx
add_header X-Robots-Tag "noindex" always;
```

### 4.4 `index.html`: estado, canonical y una sola fuente del estado

- **El estado al PRINCIPIO del `<title>`.** Google corta hacia los 60 caracteres:
  `<title>Sitio (marcha blanca, en validación) — qué hace | Organización</title>`
- **El estado también en la `description`**, y `<link rel="canonical" href="https://SITIO/" />`.
- **El texto del estado en un solo módulo**, por ejemplo `src/nucleo/estado.js`, con
  `ESTADO_PUBLICACION` y `ESTADOS[x].corto`, `.quien` y la URL del sistema operativo.
- **Una guarda de `prebuild` hace fallar la construcción** si `index.html` no dice el texto del
  estado vigente, o si en «producción» sigue diciendo «marcha blanca». Con negativas.
- **Si el backend escribe frases** (Fase 3), el mismo texto va duplicado en su lenguaje, y una
  prueba lee el módulo JS como texto y exige que coincidan. Es duplicación deliberada, porque las
  imágenes de los dos lados no se ven entre sí.

### 4.5 Service worker: conservar `Accept`

`new Request(req.url, {...})` descarta las cabeceras; `fetch` manda `Accept: */*`. En la flota, el
nginx del host solo pide HTML sin comprimir, que necesita para insertar Umami con `sub_filter`,
cuando `Accept` dice `text/html`. Resultado: quien vuelve al sitio con el service worker instalado
no queda contado.

```js
function aRed(req) {
  const accept = req.headers.get('Accept')
  return new Request(req.url, {
    cache: 'no-store', credentials: 'same-origin', redirect: 'follow',
    headers: accept ? { Accept: accept } : undefined,
  })
}
```

Ojo: no escribas `*/*` dentro de un comentario `/* … */`, porque lo cierra. Usa comentarios `//`.

---

## 5. Fase 2 — Texto fijo en el HTML (prerender)

### 5.1 Qué entra y qué no

- **Entra solo lo que no depende de los datos del día**: cabecera, `<h1>`, aclaración («no hay
  incendios declarados…»), estado de publicación con enlace al sistema operativo, y el capítulo
  «qué es».
- **Más un marcador** donde nginx meterá la frase del día (SSI, Fase 4).
- **Nada de cifras**: se construye con cada commit.

### 5.2 No uses `vite-prerender-plugin` con Vite 8. Construcción SSR aparte

Con Vite 8 y rolldown, `vite-prerender-plugin` 0.5.13:
- agrega el guion de prerender como entrada del paquete del navegador y parte el cliente en trozos
  compartidos;
- deja `react-dom/server` (~200 kB) y el guion en `dist/assets/`;
- deja el proceso **colgado para siempre**: `server.browser` agenda con `MessageChannel` y mantiene
  vivo a Node.

La solución es una construcción SSR **separada** con la API de Vite, sin dependencias nuevas:

```js
// scripts/prerender.mjs — "build": "vite build && node scripts/prerender.mjs"
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SALIDA = resolve(RAIZ, '.prerender')            // en .gitignore
const INDEX = resolve(RAIZ, 'dist', 'index.html')
const VACIO = '<div id="root"></div>'

await build({
  root: RAIZ, configFile: resolve(RAIZ, 'vite.config.js'), logLevel: 'warn',
  build: { ssr: resolve(RAIZ, 'src', 'prerender.jsx'), outDir: SALIDA, emptyOutDir: true,
           copyPublicDir: false, rollupOptions: { output: { entryFileNames: 'prerender.mjs' } } },
})
try {
  const { render } = await import(pathToFileURL(resolve(SALIDA, 'prerender.mjs')).href)
  const cuerpo = render()
  const html = await readFile(INDEX, 'utf8')
  if (html.split(VACIO).length !== 2) throw new Error('tiene que haber exactamente un #root vacío')
  // Reemplazo de TEXTO, no reparseo: los comentarios de index.html (y las directivas SSI) quedan intactos.
  await writeFile(`${INDEX}.tmp`, html.replace(VACIO, `<div id="root">${cuerpo}</div>`), 'utf8')
  await rename(`${INDEX}.tmp`, INDEX)
} finally {
  await rm(SALIDA, { recursive: true, force: true })
}
```

```jsx
// src/prerender.jsx
import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import Cabecera from './componentes/Cabecera.jsx'
import PortadaFija from './componentes/PortadaFija.jsx'
import { MARCA_PORTADA, SSI_PORTADA } from './nucleo/fragmentos.js'

export function render() {
  const html = renderToString(<StrictMode><Cabecera /><PortadaFija /></StrictMode>)
  if (!html.includes(MARCA_PORTADA)) throw new Error('falta la marca de la frase del día')
  return html.replace(MARCA_PORTADA, SSI_PORTADA)    // React no dibuja comentarios: marca → directiva
}
```

### 5.3 Reglas de los componentes que se prerenderizan

- **No leer `window`, `document`, `localStorage` ni `matchMedia` al renderizar.** Hay que proteger
  las funciones que lo hagan: por ejemplo, un `temaActual()` que devuelva `'claro'` cuando
  `typeof document === 'undefined'`.
- **Extraer lo fijo** a componentes puros (`QueEs.jsx`, `Cabecera.jsx`, `PortadaFija.jsx`). Si un
  capítulo mezcla texto fijo con estado de la URL, se separa.
- **Ningún atributo `style=`** si la CSP no tiene `'unsafe-inline'` en `style-src`: el navegador lo
  ignora en el HTML horneado.
- **`createRoot`, no `hydrateRoot`.** Lo horneado se reemplaza y no hay desajuste de hidratación.
- **La rama de carga de la app dibuja los mismos componentes** que el prerender, así no hay salto
  al montar.
- **Rescatar lo que metió nginx antes de montar.** `createRoot` borra `#root`, incluida la frase
  que metió el SSI:

  ```js
  // src/nucleo/fragmentos.js
  let frase = null
  export function rescatarFraseDelDia() {
    if (typeof document !== 'undefined') frase = document.querySelector('[data-frase-dia]')?.outerHTML ?? null
  }
  export const fraseRescatada = () => frase
  // main.jsx: rescatarFraseDelDia() ANTES de createRoot(...)
  // PortadaFija: <div data-ssi="portada" dangerouslySetInnerHTML={{ __html: fraseRescatada() }} />  (si hay)
  ```

### 5.4 La guarda de `postbuild`: `validar-html.mjs`

Sobre `dist/index.html` exige:
- **dentro de `#root`**: `<h1>`, el capítulo fijo, el texto del estado, la directiva SSI de la
  portada con su `stub`, y ningún ` style=`;
- que todo `src="/assets/…"` citado exista en `dist/`. La construcción SSR calcula por su cuenta
  la URL con hash del logo, y podría no calzar;
- **en `<head>`**: exactamente una directiva SSI de la vista previa, con su bloque `stub`;
- **ninguna** `property="og:` escrita a mano: van por SSI, y duplicadas se contradicen.

Con negativas para cada punto. Como `postbuild` corre dentro de `npm run build`, rompe el CI y el
Dockerfile.

---

## 6. Fase 3 — Páginas por entidad, generadas con los datos del día

### 6.1 Dónde corre el generador

- En el **backend o ETL**, porque ahí están los datos. En la flota es Python, sin Node en el
  contenedor. Lo que genera es HTML estático con biblioteca estándar (`html`, `json`,
  `unicodedata`): no hace falta Jinja.
- **Lee lo publicado, no la salida cruda**: lo que apunta `ultima.json`. Las páginas tienen que
  decir lo mismo que el visor.
- **Módulos puros** (`textos.py`: frases, fechas, slug, regiones; `paginas.py`: HTML), más un CLI
  (`web.py`) que lee y escribe.
- **Paso *best effort* después de publicar**, igual que un histórico: si falla, la corrida ya está
  publicada y las páginas de ayer dicen su fecha. **No** lo metas en el manifiesto de la corrida si
  el CI compara productos byte a byte: movería la compuerta. Pruébalo aparte (6.8).
- **Si el proyecto tiene una regla «el backend calcula, el visor dibuja»**, esto no calcula:
  formatea cifras ya calculadas. Regístralo como excepción o reversión parcial si una decisión
  anterior descartó generar HTML en el backend.

### 6.2 Qué escribe (en el volumen publicado, `web/`)

```
web/
  tarjetas/<fecha>-<sello12>/<slug>.png, nacional.png, sin-condiciones.png   # Fase 5 — PRIMERO
  entidad/<slug>/index.html          # una por entidad del catálogo
  entidades/index.html               # la nacional o índice, con la frase del día y el Dataset
  fragmentos/portada.html            # la frase del día para #root de la portada (SSI)
  fragmentos/cabeza.html             # la vista previa del día para <head> de la portada (SSI)
  fragmentos/cabeza-<id>.html        # la vista previa de la portada cuando llega ?id=<id>
  sitemap-entidades.xml
  indice.json                        # {esquema, fecha_base, tarjetas, entidades: {id: slug}} — el ÚLTIMO
```

- **Orden de escritura:** tarjetas → páginas → fragmentos → sitemap → **índice al final**. El
  índice es la señal de «terminado».
- **Cada archivo se escribe con `.tmp` y `replace`, y queda con `chmod 0644`.** Un fragmento
  ilegible por nginx es un 403, y el SSI lo convierte en un error dentro de la portada.

### 6.3 La frase citable: reglas

Un asistente cita **una frase suelta**. Cada frase lleva dentro:
- el nombre explícito de la entidad (nunca «esta comuna»);
- la **región o jurisdicción con su nombre oficial** (una tabla en el código, con una prueba que
  cubra todo el catálogo y excluya los pseudo-valores como «Internacional»);
- **quién lo dice y en qué estado** («según la réplica en validación de X (Unidad), que todavía no
  reemplaza a X operativo, en su corrida del 16 de septiembre de 2026 (marcha blanca, en
  validación)»);
- la **fecha con año** («jueves 17 de septiembre de 2026»), escrita sin depender del locale, con
  tablas de días y meses;
- el **plazo** (pronóstico o tendencia) y el **alcance**: si es la unión de 5 días, «entre el 16 y
  el 20 de septiembre de 2026». El rango repite el mes y el año cuando cambian: «entre el 29 y el
  3 de octubre» diría que empieza el 29 de OCTUBRE;
- **todos** los días o valores relevantes, no solo el primero;
- **solo enteros ya redondeados** por el backend: los decimales pueden variar con el CPU;
- «estimación» si la cifra lo es.

Lo que **no** hace:
- **No atribuye el máximo a todo.** «31.831 ha en 3 de las 5 revisiones» dice que TODA la
  superficie estuvo 3 revisiones. La forma buena es «31.831 ha en algún momento de la tarde y, en
  parte de esa superficie, hasta 3 de las R revisiones». Hay que tener una prueba negativa con una
  regex que detecte la forma mala.
- **No afirma ausencia de riesgo.** «X no marca condiciones…; eso no significa que no haya
  riesgo: ante la duda, manda el sistema operativo».
- **No inventa categorías** que los datos no traen.

Ejemplo real:

> Vallenar (Región de Atacama): según la réplica en validación del Botón Rojo (UIA-CONAF), que
> todavía no reemplaza al Botón Rojo operativo, en su corrida del 16 de septiembre de 2026 (marcha
> blanca, en validación), hay condiciones para que un incendio forestal se propague rápido el
> jueves 17 de septiembre de 2026 (pronóstico), en 31.831 ha en algún momento de la tarde y, en
> parte de esa superficie, hasta 3 de las 5 revisiones; y el sábado 19 de septiembre de 2026
> (tendencia), en 83.948 ha y hasta 3 de las 5 revisiones. Las superficies por comuna son una
> estimación.

### 6.4 Slug

```python
def slug(nombre):
    s = unicodedata.normalize("NFKD", nombre)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace("'", "").replace("’", "")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")        # Ñuñoa→nunoa, O'Higgins→ohiggins
```

- Se calcula **solo en el backend**. El frontend lo lee de `indice.json` y no lo recalcula.
- Hay una prueba de que todos los slugs del catálogo son únicos y encajan en
  `[a-z0-9]+(?:-[a-z0-9]+)*`.

### 6.5 Metadatos de cada página (una prueba los exige todos)

```html
<!doctype html><html lang="es-CL"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>X en <Entidad> (<Región>): corrida del <fecha> (marcha blanca, en validación)</title>
<meta name="description" content="<resumen corto con nombre, fecha y estado>">
<link rel="canonical" href="https://SITIO/entidad/<slug>/">
<link rel="stylesheet" href="/paginas.css">                <!-- CSS propio, nombre estable -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="...">
<meta property="og:locale" content="es_CL">
<meta property="og:url" content="https://SITIO/entidad/<slug>/?d=<fecha>">   <!-- con fecha -->
<meta property="og:title" content="..."><meta property="og:description" content="...">
<meta property="og:image" content="https://SITIO/tarjetas/<carpeta>/<slug>.png">
<meta property="og:image:secure_url" content="(la misma)">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="...">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" ...><meta name="twitter:description" ...><meta name="twitter:image" ...>
<script type="application/ld+json">{...}</script>
</head>
```

- **`og:url` con `?d=<fecha>` y `canonical` sin fecha.** Cada corrida es un objeto nuevo para
  Facebook y LinkedIn, que cachean por URL, y el buscador ve una sola dirección.
- **En el cuerpo:**
  - el aviso de estado con enlace al operativo;
  - `<h1>`;
  - la frase en `<p class="cita" data-frase-dia>`;
  - una **tabla con `<caption>`, `<th scope="col">` y `<th scope="row"><time datetime>`**;
  - «qué significa», con los umbrales tomados de las constantes del backend y no escritos a mano;
  - un enlace al visor interactivo;
  - un pie con fuente, contacto y «cómo citar».
- **CSS propio** (`public/paginas.css`): el del visor lleva hash y el backend no lo conoce. Usa
  los tokens de color copiados del visor, sin fuentes web.

### 6.6 JSON-LD

- **Página índice o nacional:** un solo `Dataset`, con `name`; `description` de 50 a 5000
  caracteres; `creator` (Organization); `temporalCoverage` (`AAAA-MM-DD/AAAA-MM-DD`);
  `spatialCoverage`; `isAccessibleForFree`; `dateModified`; e `@id` `…/entidades/#dataset`. **Sin
  `license`** mientras no esté resuelta.
- **Página de entidad:** `WebPage` con `about` (`AdministrativeArea` o `Place` con `containedInPlace`
  y `geo`), `dateModified`, `isPartOf: {"@id": …#dataset}` y `publisher`.
- **Solo lo visible:** es la política de Google.
- **Escapado:**
  `json.dumps(obj, ensure_ascii=False, sort_keys=True).replace("<","\\u003c").replace(">","\\u003e").replace("&","\\u0026")`.
  No uses `&lt;`: el contenido de `<script>` no decodifica entidades.
- **Lo que no esperar:** el JSON-LD no hace aparecer en los asistentes; sirve para Dataset Search.

### 6.7 Sitemap

- Todas las páginas del día con `<loc>` absoluto y `<lastmod>` = fecha de la corrida, sin la hora.
- Se declara en `robots.txt` con URL absoluta.

### 6.8 Pruebas (pytest o equivalente)

- **Determinismo:** dos ejecuciones dan exactamente los mismos archivos, sin `now()`, con
  `sort_keys` y en orden estable. `web.py` deja todo, sin `.tmp` residuales, e `indice.json` al
  final.
- **Catálogo:** N entidades; exclusión explícita de pseudo-valores; regiones cubiertas; slugs
  únicos.
- **Rango de fechas:** mismo mes, cambio de mes, cambio de año.
- **Cifras:** leídas del resumen **por un camino propio** en la prueba, no copiadas de un documento.
- **Contenido de toda frase:** estado y «réplica».
- **Negativas:**
  - A-01, con la regex de la forma mala y un control de que la regex caza el caso malo;
  - «no significa que no haya riesgo» en las entidades sin datos;
  - sin decimales.
- **Metadatos absolutos:** `og:url` = canonical + `?d=`, y `og:image` https.
- **JSON-LD:**
  - se parsea y no contiene `<` ni `>`;
  - un Dataset con descripción de 50 a 5000 caracteres;
  - **una entidad con nombre `</script><script>alert(1)</script>`** sale escapada.
- **Estado y dirección:**
  - el estado es igual al del módulo JS, con negativa;
  - `BASE_URL` es igual al canonical de `index.html`.
- **Vista previa por entidad:** cada `cabeza-<id>.html` existe y trae el estado; compara contra el
  nombre **escapado** (`O'Higgins` → `O&#x27;Higgins`).
- **CI:** un paso que corre el generador **dos veces sobre la corrida de referencia** y hace
  `diff -r`, más una cuenta de páginas esperadas.

### 6.9 Ciclo de vida (operación)

| Cuándo | Qué pasa |
|---|---|
| **Tras publicar** | *Best effort*, en la envoltura diaria (`correr_diario.py` o equivalente). |
| **Al arrancar el contenedor** | `python ETL/web.py \|\| echo AVISO…`: un despliegue que cambia la plantilla no espera a mañana. |
| **Reintentos (`--solo-si-falta`)** | Si la corrida está completa pero `web/indice.json` es de otra fecha, se relanza **solo** el generador. |
| **Estado para la vigilancia** | `web: {fecha_base, esquema}` se **deriva del disco** (`web/indice.json`) en cada pasada del vigilante. No se arrastra: la envoltura diaria reescribe el estado desde cero. |
| **Publicación a mano** | Hay que correr el generador a mano. Documéntalo. |

---

## 7. Fase 4 — Servirlas: nginx, SSI y la prueba de comportamiento

### 7.1 `index.html`: la vista previa sale del archivo y entra por SSI

```html
<!-- sin og: escritas aquí -->
<!--# block name="sin_cabeza" --><!--# endblock -->
<!--# include virtual="/_fragmentos/${cabeza}" stub="sin_cabeza" -->
```

Y dentro de `#root`, vía el prerender:

```html
<!--# block name="sin_frase" --><!--# endblock --><!--# include virtual="/_fragmentos/portada.html" stub="sin_frase" -->
```

- **El `stub` es obligatorio.** Sin él, si la subpetición da 404 o 403, nginx **mete su página de
  error** («404 Not Found», con un segundo `<title>`) dentro de la portada. `ssi_silent_errors` no lo
  evita: solo calla el «[an error occurred…]».
- En `npm run dev` Vite no procesa SSI y las directivas quedan como comentarios. Es inocuo.

### 7.2 El bloque de nginx (contenedor)

```nginx
# Vista previa por entidad según el enlace. Solo dígitos: $arg_x es texto del visitante y termina en una ruta.
map $arg_ficha $cabeza {
    default                  "cabeza.html";
    "~^(?<cut>[0-9]{4,5})$"  "cabeza-$cut.html";
}

server {
    # … (lo existente)

    location = / {
        ssi on; ssi_silent_errors on; etag off; if_modified_since off;   # SOLO aquí y en = /index.html
        try_files /index.html =404;
        # + las cabeceras de seguridad repetidas (add_header no se hereda)
    }
    location = /index.html { ssi on; ssi_silent_errors on; etag off; if_modified_since off; # + cabeceras
    }

    # Fragmentos: solo para SSI. Primero el del volumen; si no, el genérico horneado en la imagen.
    # ENTRE COMILLAS: sin ellas nginx lee la «{» de {4,5} como el comienzo de un bloque.
    location ~ "^/_fragmentos/(?<frag>cabeza(?:-[0-9]{4,5})?\.html)$" {
        internal;
        root /usr/share/nginx/html;
        default_type text/html;
        try_files /datos/web/fragmentos/$frag /datos/web/fragmentos/cabeza.html /_fragmentos/cabeza.html =404;
    }
    location = /_fragmentos/portada.html {
        internal; root /usr/share/nginx/html; default_type text/html;
        try_files /datos/web/fragmentos/portada.html /_fragmentos/portada.html =404;
    }
    # REGEX y DESPUÉS: un prefijo `^~ /_fragmentos/` gana antes de mirar las regex y taparía la de arriba.
    location ~ ^/_fragmentos/ { return 404; }

    # Páginas del día. Regex + try_files explícito, SIN `index` (su redirección interna no casa y da 404).
    location ~ ^/entidad/(?<slug>[a-z0-9]+(?:-[a-z0-9]+)*)/$ {
        root /usr/share/nginx/html/datos/web; default_type text/html; charset utf-8;
        try_files /entidad/$slug/index.html =404;
        # + Cache-Control no-cache y las cabeceras de seguridad (CSP, HSTS, nosniff, X-Frame, Referrer)
    }
    location ~ ^/entidad/(?<slug>[a-z0-9]+(?:-[a-z0-9]+)*)$ { return 301 /entidad/$slug/; }  # relativo con absolute_redirect off
    location = /entidades { return 301 /entidades/; }
    location = /entidades/ {
        root /usr/share/nginx/html/datos/web; default_type text/html; charset utf-8;
        try_files /entidades/index.html =404;   # + cabeceras
    }
    location = /sitemap-entidades.xml {
        root /usr/share/nginx/html/datos/web; default_type application/xml; charset utf-8;
        try_files $uri =404; add_header Cache-Control "no-cache" always; add_header X-Content-Type-Options "nosniff" always;
    }
    location ~ "^/tarjetas/(?<carpeta>[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f]{12})/(?<png>[a-z0-9]+(?:-[a-z0-9]+)*\.png)$" {
        root /usr/share/nginx/html/datos/web;
        try_files /tarjetas/$carpeta/$png =404;
        add_header Cache-Control "public, max-age=31536000, immutable";   # SIN always: un 404 no se cachea un año
        add_header X-Content-Type-Options "nosniff" always;
    }
    location = /indexnow.txt {   # solo si se usa IndexNow
        root /usr/share/nginx/html/datos/web; default_type text/plain; try_files $uri =404;
        add_header Cache-Control "no-cache" always;
    }
    # Lo que el backend escribe en web/ no se sirve por /datos/ (saldría como octet-stream y duplicado).
    location ^~ /datos/web/ { return 404; }
    location = /datos/web/indice.json {
        default_type application/json; try_files $uri =404;
        add_header Cache-Control "no-cache" always; add_header X-Content-Type-Options "nosniff" always;
        add_header X-Robots-Tag "noindex" always;
    }
    # `location ~ /\.` (deny dotfiles) y `location /` (try_files $uri $uri/ =404) quedan como estaban.
}
```

Verifica:
- que el volumen esté montado donde apunta `root`;
- que la CSP permita `/paginas.css` (`style-src 'self'`);
- que `og:image` no pasa por `img-src`, así que no hace falta abrirlo.

### 7.3 Por qué SSI y no otra cosa

| Opción | Por qué no, o cuándo sí |
|---|---|
| Hornear en `index.html` | Cifras del día del commit. Descartado. |
| SSR (Node en ejecución) | Otra pieza en el contenedor. SSI es un módulo estándar de nginx y el backend solo escribe archivos. |
| Que el backend reescriba `index.html` | No conoce los nombres con hash de los assets, y la imagen no es suya. |

Si el proxy no es nginx, busca el equivalente: *templates* de Caddy, *includes* de Apache
(`mod_include`) o un *edge worker*.

### 7.4 El nginx del host y la analítica

- Si el host inyecta la analítica con `sub_filter`, actúa sobre cualquier `text/html`, así que las
  páginas nuevas se miden solas.
- `sub_filter` no reescribe respuestas comprimidas. Por eso el host pide HTML sin comprimir, y por
  eso importa el `Accept` del service worker (4.5).

### 7.5 La prueba de comportamiento (`scripts/probar_nginx.py`)

`nginx -t` solo prueba la sintaxis. Este arnés en Python, con biblioteca estándar, recibe
`--url` y `--volumen`, y hace dos cosas:
- **escribe sus propios fragmentos con marcas** (`VOL-PORTADA`, `VOL-CABEZA`, `VOL-CABEZA-3301`,
  una página `VOL-COMUNA ñ`, una tarjeta y una clave), para no confundir un fallo del backend con
  uno de nginx;
- comprueba lo de la tabla y **sale con 1 al primer fallo**.

| Qué | Cómo |
|---|---|
| `/health` | 200 sin redirección |
| Portada | 200; `VOL-PORTADA` en `#root`; `VOL-CABEZA` dentro de `<head>`; **una directiva `<!--# echo var="host" -->` dentro de un fragmento NO se ejecuta**; ninguna `<!--# include` sin procesar; sin «404 Not Found» ni «an error occurred»; una sola `og:title`; CSP y HSTS; sin ETag ni Last-Modified; con gzip la frase sigue; `/index.html` también pasa por SSI |
| `?ficha=` | Con fragmento, la de la entidad; con id sin fragmento, la del día; con valor inválido (`../x`), la del día |
| Fragmentos sueltos | 404 en `/_fragmentos/*` y en `/datos/web/*`, salvo `indice.json` |
| Páginas | 200 `text/html; charset=utf-8` con CSP; sin barra, 301 con `Location` relativa; slug inexistente, 404; `/entidad/`, 404; `/entidad/x/index.html`, 404 |
| Tarjetas | 200 `image/png` inmutable; una que falta da 404 **sin** `immutable`; carpeta mal formada o `.tmp`, 404 |
| Datos | `X-Robots-Tag: noindex` en `/datos/…` |
| Respaldos | Sin fragmentos en el volumen: 200, sin página de error, con la vista previa genérica. Con `--sin-respaldo`, la imagen sin `public/_fragmentos`: el `stub` vacío |

**En el CI**, en el job de nginx:
- `docker build` de la **imagen real**, que además prueba el Dockerfile;
- `docker run -v $VOL:/usr/share/nginx/html/datos:ro`, el arnés, y otra vez con
  `-v $VACIO:/usr/share/nginx/html/_fragmentos:ro --sin-respaldo`;
- **las mutaciones que tienen que ponerlo ROJO**: `sed 's/ssi on;/ssi off;/'` y
  `sed 's/^        internal;$//'`, montadas sobre `/etc/nginx/conf.d/default.conf`. Antes de
  aplicarlas, `cmp` comprueba que cada mutación cambie de verdad el archivo; si no, el control no
  se ejerce.

### 7.6 Probar nginx sin Docker (Windows)

- nginx.org publica `nginx-1.30.x.zip` para Windows. Trae SSI y PCRE2: compruébalo con
  `nginx.exe -V`, donde no debe aparecer `--without-http_ssi_module`.
- Copia `dist/` a `html/`, crea `html/datos/` como volumen y adapta la configuración con `sed`:
  `/usr/share/nginx/html` → la ruta local; `listen 8000` → `127.0.0.1:8123`; `/dev/stdout` →
  `logs/access.log`.
- Envuélvela en un `nginx.conf` mínimo:

  ```
  worker_processes 1; error_log logs/error.log warn; pid logs/nginx.pid;
  events { worker_connections 64; }
  http { include mime.types; default_type application/octet-stream; include default.conf; }
  ```

- `nginx.exe -p <prefijo>/ -c conf/nginx.conf -t`, luego arráncalo en segundo plano y usa
  `-s reload` o `-s quit`.
- **Diferencia real:** nginx para Windows compila las regex **sin distinguir mayúsculas**
  (`NGX_HAVE_CASELESS_FILESYSTEM`). `/entidad/Vallenar/` responde en Windows y da 404 en Linux. No
  metas casos con mayúsculas en el arnés.
- El **recorrido en navegador** (Chrome sin interfaz) contra ese nginx es lo más parecido a
  producción que se puede levantar en local.

---

## 8. Fase 5 — Tarjetas PNG para la vista previa

### 8.1 Diseño

- **Formato:** 1200×630, PNG, **menos de 300 kB**. Con colores planos salen de 50 a 85 kB.
- **Arriba**, en versalitas: «SISTEMA · RÉPLICA EN VALIDACIÓN (UNIDAD)».
- **Título grande**: el nombre de la entidad, que se achica hasta caber. Prueba con el nombre más
  largo del catálogo.
- **Debajo**: la región, un encabezado y un renglón por día con dato («jue 17 sep (pronóstico):
  31.831 ha, hasta 3 de 5 revisiones»), con el mismo cuidado de A-01.
- **Franja inferior de color**: «MARCHA BLANCA, EN VALIDACIÓN · CORRIDA DEL 16-09-2026». La fecha y
  el estado van en grande, porque la plataforma guardará la imagen días. **La URL va aparte, encima
  de la franja**: juntas se montan.
- **Tres clases**: por entidad con datos; nacional («16 comunas de 4 regiones»); y una común «sin
  condiciones» que no afirma ausencia de riesgo. Las entidades no evaluadas usan la genérica.
- **La genérica** (`public/og.png`) sale **del mismo generador** (`--og-estatico`), con el estado y
  sin fecha.
- **Colores:** los tokens del visor, con sus contrastes medidos.
- **Viñetas:** **dibújalas** (`draw.rectangle`). La tipografía puede no traer `▪` y sale un cuadro
  vacío. Mira siempre la imagen generada.

### 8.2 Técnica (Pillow)

```python
from functools import lru_cache
from PIL import Image, ImageDraw, ImageFont

@lru_cache(maxsize=None)
def letra(tamano, peso=400):
    f = ImageFont.truetype(str(FUENTE_TTF), tamano)       # .ttf variable
    f.set_variation_by_axes([peso])                       # eje wght (200–800)
    return f

def que_quepa(texto, tamano, peso, ancho, minimo=40):
    while tamano > minimo and letra(tamano, peso).getlength(texto) > ancho:
        tamano -= 4
    return letra(tamano, peso)

def png(img):
    b = io.BytesIO(); img.save(b, format="PNG", optimize=True); return b.getvalue()
    # al escribir a disco: bytes → .tmp → replace (Pillow no infiere el formato de «x.png.tmp»)
```

- **Tipografía:** el `.ttf` en los insumos versionados del backend (`datos_base/fuentes/`), **no**
  el `.woff2` del frontend, que la imagen del backend no trae. Bájala del repositorio de Google
  Fonts **fijado a un commit**, con su licencia (OFL); regístrala en el catálogo de insumos con
  sha256; márcala como `binary` o `-text` en `.gitattributes`.
- **Pillow** va fijado en los **dos** archivos de dependencias, si el repo separa desarrollo y
  ejecución. Comprueba que exista la rueda para la plataforma del contenedor:
  `pip download pillow==X --only-binary=:all: --python-version 3.13 --platform manylinux_2_28_x86_64`.
- **Dockerfile:** una prueba de humo que **dibuje una tarjeta**, porque `import PIL` no carga
  freetype, y que compruebe la firma PNG. Va **después** de copiar los insumos.

### 8.3 Carpeta, caché y poda

- **Ruta:** `tarjetas/<fecha>-<sha256(resumen canónico)[:12]>/`. Una corrida relanzada el mismo día
  con otras cifras cae en otra carpeta, y la anterior sigue siendo inmutable.
- **Escribe las tarjetas ANTES que las páginas que las citan.**
- **nginx:** `immutable` por un año, **sin `always`**.
- **Poda:** el mismo cupo que las corridas, y **nunca** la carpeta que cita `indice.json`, aunque
  sea vieja: las páginas pueden ir atrasadas. Prueba con negativa: sin protección, esa carpeta sí
  estaría en el plan de borrado.

### 8.4 Pruebas

- Cada tarjeta es un PNG de 1200×630 y menos de 300 kB.
- Determinismo en la misma máquina. **No compares bytes entre sistemas operativos**: el suavizado
  de la letra puede variar.
- **Cada `og:image` citada existe y cada tarjeta escrita se cita.**
- La carpeta cambia si cambia una cifra y no si no cambia.
- La fuente coincide con su sha catalogado.
- `public/og.png` es de 1200×630.

---

## 9. Fase 6 — Botón «Compartir»

```jsx
export function enlaceDeEntidad(origen, id, indice) {          // puro, con pruebas
  const slug = indice?.esquema === 1 ? indice.entidades?.[String(id)] : null
  return slug ? `${origen}/entidad/${slug}/` : `${origen}/?ficha=${id}`   // el respaldo también tiene vista previa (SSI)
}

export default function BotonCompartir({ entidad }) {
  const [indice, setIndice] = useState(null)
  const [aviso, setAviso] = useState('')
  useEffect(() => { let vivo = true; cargarIndiceWeb().then((i) => vivo && setIndice(i)); return () => { vivo = false } }, [])
  async function compartir() {
    const url = enlaceDeEntidad(window.location.origin, entidad.id, indice)
    try {
      if (navigator.share) { await navigator.share({ title: `Sistema en ${entidad.nombre}`, url }); return }
      await navigator.clipboard.writeText(url); setAviso('Enlace copiado')
    } catch (e) { if (e?.name !== 'AbortError') setAviso(url) }   // último recurso: mostrar el enlace
  }
  return (
    <p className="ficha-compartir">
      <button type="button" onClick={compartir} data-umami-event="compartir" data-umami-event-entidad={entidad.nombre}>
        Compartir
      </button>
      {aviso && <span role="status"> {aviso}</span>}
    </p>
  )
}
```

- **Fuente de datos:** `cargarIndiceWeb()` pasa por la única puerta de E/S del visor y devuelve
  `null` ante un 404, porque el índice puede no existir todavía.
- **Enlace de vuelta:** desde el pie del visor, `<a href="/entidades/">…</a>`, para llegar navegando
  a las páginas del día.
- **Impresión:** si el CSS de impresión oculta los botones, verifica que este también se oculte.
- **Recorrido en navegador:** el botón existe; al pulsarlo aparece «Enlace copiado» o el enlace; la
  ficha sigue abierta. En Chrome sin interfaz no hay menú de compartir ni portapapeles, y lo que se
  prueba es el aviso. Córrelo contra el servidor de desarrollo (StrictMode monta los efectos dos
  veces) **y** contra el nginx con la construcción real.

---

## 10. Fase 7 — Medición en tres etapas

### 10.1 Rastreo: `scripts/bots_en_logs.py`

- **Qué lee:** logs `combined` de nginx, incluidos los `.gz` rotados. Por omisión, el log del vhost
  del host.
- **Familias**, cada una con una lectura distinta:

  | Familia | Bots | Qué significa |
  |---|---|---|
  | `buscador` | Googlebot, bingbot, Applebot, YandexBot, DuckDuckBot | Indexan para su buscador. Googlebot también alimenta AI Overviews |
  | `busqueda-ia` | OAI-SearchBot, Claude-SearchBot, PerplexityBot | Indexan para las respuestas de un asistente |
  | `por-encargo` | ChatGPT-User, Claude-User, Perplexity-User | **Un asistente leyendo porque alguien le preguntó: el mejor indicio de que una respuesta se armó con el sitio** |
  | `entrenamiento` | GPTBot, ClaudeBot, CCBot, Applebot-Extended, meta-externalagent, Bytespider | Si aparecen leyendo páginas, no respetan `robots.txt` |
  | `vista-previa` | facebookexternalhit, WhatsApp, Twitterbot, LinkedInBot, TelegramBot, Slackbot, Discordbot | Arman la tarjeta de un enlace |

- **Coincidencia del nombre COMPLETO:**
  `(?<![A-Za-z-])NOMBRE(?![A-Za-z-])`, sin distinguir mayúsculas. «Applebot» no debe casar con
  «Applebot-Extended», ni «ClaudeBot» con «Claude-User».
- **Qué cuenta:** por día × (familia, bot), por bot × tipo de ruta (portada, entidad, índice,
  tarjeta, datos, rastreo, otros) y los códigos 4xx y 5xx. Tiene salida `--json` y `--desde`.
- **Pruebas:** cada bot en su familia; una persona con Chrome no cuenta; líneas rotas y fechas
  imposibles se ignoran; lee plano y `.gz`.
- **Advertencia escrita en la salida:** es User-Agent declarado. Sin la IP real del visitante no se
  puede verificar contra los rangos publicados (`openai.com/searchbot.json`,
  `claude.com/crawling/bots.json`, `perplexity.com/perplexitybot.json`).

### 10.2 Vigilancia externa: regla `indexable`

- **Dónde corre:** en el vigilante que corre fuera de la infraestructura (en la flota, un runner de
  GitHub que abre un issue por regla).
- **Qué lee:** `robots.txt`, la portada y `/entidades/`. Su evaluación es **pura**, sin E/S, para
  poder probarla.
- **Cuándo falla:**
  - `robots.txt`, leído **según RFC 9309** (el lector de 4.2 portado a Python), no deja a CITAN leer
    `/`, `/entidades/` o `/entidad/x/`;
  - la portada trae `<!--# include` sin procesar (falta `ssi on`);
  - la portada no trae `data-frase-dia`;
  - `/entidades/` no responde 200;
  - pasada la hora de corte, `web.fecha_base` no es igual a `publicada` en el estado de salud.
- **Casos negativos**, uno por causa, más «visible y al día» y «antes del corte no alarma».
- **La prueba de que toda regla tiene un caso que la gatilla** tiene que mirar **todos** los juegos
  de casos.
- **Una prueba lee el `robots.txt` del repo con el mismo lector de la vigilancia**, más otra que
  demuestra que `urllib.robotparser` da la respuesta equivocada en el caso `Allow: /` seguido de
  un `Disallow` más largo.

### 10.3 Cita: Search Console y Bing Webmaster

- **Cuenta:** funcional de la unidad, con dos responsables registrados.
- **Search Console:**
  - propiedad «prefijo de URL» verificada con un **archivo HTML** en `frontend/public/` (el DNS
    del dominio raíz suele ser de otra área);
  - envía los dos sitemaps;
  - **Inspección de URL** sobre `/` y una entidad: el HTML rastreado tiene que traer la frase;
  - **Rendimiento → IA generativa**: impresiones en AI Overviews y AI Mode, sin clics ni consultas,
    y solo con volumen suficiente;
  - el ajuste «Search generative AI» viene en «Incluir». Excluir el sitio es una decisión de la
    sección 2.
- **Bing:**
  - importa la propiedad desde Search Console;
  - **AI Performance**: citas en Copilot y en los resúmenes de Bing, más *grounding queries*.
    No mide ChatGPT, Claude ni Perplexity.

### 10.4 Clic: Umami (u otra analítica)

- **Referentes:** `chatgpt.com`, `perplexity.ai`, `claude.ai`, `copilot.microsoft.com`,
  `gemini.google.com`.
- **Parámetro `utm_source=chatgpt.com`:** comportamiento observado, no documentado; las apps
  móviles suelen borrar el referente.
- **Evento `compartir`.**
- **Comprueba que la configuración no excluya la cadena de consulta.** En la flota,
  `data-exclude-search="true"` en la inyección del host la apagaría. Contrasta lo desplegado (el
  HTML servido) con lo versionado.

### 10.5 IndexNow (opcional, APAGADO por omisión)

- **Qué hace:** `POST https://api.indexnow.org/indexnow` con
  `{host, key, keyLocation, urlList}`. La clave tiene de 8 a 128 caracteres `[A-Za-z0-9-]`. Bing,
  Yandex, Seznam y Naver lo aceptan; Google no, porque lee el sitemap.
- **Cómo se enciende:** con una variable de entorno del servidor (`BR_INDEXNOW_CLAVE`); **sin ella
  no sale nada**, y una prueba lo exige haciendo fallar cualquier llamada de red.
- **La clave:** el backend la escribe en el volumen (`web/indexnow.txt`) y nginx la sirve en
  `/indexnow.txt`. **Nunca va en el repositorio.** Se valida su forma y que todas las URL sean del
  host.
- **Modos:** `--simular` muestra el aviso sin mandarlo. En la corrida diaria corre como paso
  *best effort*.

### 10.6 La guía para las personas (`docs/visibilidad.md`)

Qué se publica y dónde; las cinco comprobaciones tras cada despliegue (sección 13); los depuradores
(Facebook Sharing Debugger con «Scrape again», LinkedIn Post Inspector, `@WebpageBot` de Telegram,
un envío real por WhatsApp, Rich Results Test, validator.schema.org); Search Console; Bing; Umami;
los logs; cómo encender IndexNow; y qué hacer con cada causa de la regla `indexable`.

---

## 11. Gobernanza y registro

- **Decisiones:** una sección nueva en el registro de decisiones con:
  - la decisión de indexar, con nombre, **cargo** y fecha, y **pendiente de ratificación** si el
    plan asigna esa decisión a otra instancia (en el Botón Rojo, la Jefatura UIA con GEPRIF);
  - los bots de entrenamiento y su relación con la licencia;
  - la identidad («réplica») y el trato de las entidades sin datos;
  - la analítica, si no estaba registrada;
  - cada fase con **lo medido**: el diagnóstico en vivo con sus cifras y los defectos que encontró
    la prueba local.
- **Plan:** una **medida nueva** con su criterio de término. Las medidas que proponían `noindex` se
  **enmiendan tachando, no borrando** (`~~…~~` y *Enmendado el AAAA-MM-DD: …*), en la tabla
  índice, en la viñeta y en el criterio. Actualiza los contadores (N medidas, jornadas).
- **Excepciones:** si una decisión anterior descartó generar HTML en el backend, se registra como
  **reversión parcial** con su motivo nuevo, no como «enmienda de alcance».
- **Pendientes que no son código**, escritos como ABIERTOS:
  - cuentas de Search Console y Bing;
  - licencia;
  - enlaces entrantes desde el sitio institucional y los municipios;
  - publicación en un portal de datos abiertos (datos.gob.cl u otro), que exige licencia;
  - dominio definitivo (si cambia sin 301, se pierde lo indexado);
  - redirección http→https **301 o 308**, no 307;
  - el libro o planilla de seguimiento.

---

## 12. Trampas reales: síntoma, causa y arreglo

Todas pasaron en el Botón Rojo.

| # | Síntoma | Causa | Arreglo |
|---|---|---|---|
| 1 | Google «ve» la página, pero sin datos (página de error) | `robots.txt` bloquea la ruta de la que la SPA carga los JSON | Quitar el `Disallow`; `X-Robots-Tag: noindex` en esas respuestas |
| 2 | Umami no cuenta a quien vuelve | El service worker rehace la petición con `new Request(url)`, sin `Accept`; el host no descomprime y `sub_filter` no inyecta | Conservar `Accept` en el service worker |
| 3 | La construcción no termina, con procesos `vite build` colgados | `vite-prerender-plugin` + Vite 8: el `MessageChannel` de `react-dom/server` en su versión de navegador | Construcción SSR aparte con la API de Vite |
| 4 | Trozos nuevos y `server.browser-*.js` en `dist/assets` | Lo mismo: el guion de prerender entra como entrada del cliente | Ídem |
| 5 | `vite build` muere con «Zone Allocation failed» o «memory allocation failed» con poco heap | La memoria virtual comprometible del equipo está agotada (otras aplicaciones abiertas) | Revisar `FreeVirtualMemory`; cerrar aplicaciones; no es el código |
| 6 | La frase del día aparece y desaparece al cargar | `createRoot` borra `#root`, incluido lo que metió el SSI | Rescatar `[data-frase-dia]` antes de montar y redibujarlo en la rama de carga |
| 7 | React no emite la directiva SSI | React no dibuja comentarios HTML | Marca vacía y reemplazo de texto tras `renderToString` |
| 8 | `nginx -t`: «pcre2_compile() failed: missing closing parenthesis» | Una regex con `{n,m}` sin comillas: nginx toma `{` como bloque | Poner la regex entre comillas |
| 9 | El SSI siempre recibe 404 | `location ^~ /_fragmentos/` gana antes que las regex | La regex «todo lo demás, 404» va DESPUÉS y como regex |
| 10 | `/entidades/` da 404 aunque el archivo existe | `index` hace una redirección interna a `/entidades/index.html` que ya no casa con `= /entidades/` | `try_files /entidades/index.html =404` explícito, sin `index` |
| 11 | «404 Not Found» dentro del `<head>` de la portada | Subpetición SSI fallida, sin `stub` | `<!--# block name="x" --><!--# endblock -->` y `stub="x"` en cada include |
| 12 | Una tarjeta que se escribió después sigue en 404 para siempre | `Cache-Control: immutable` con `always` también en el 404 | Sin `always` en esa cabecera |
| 13 | La prueba del slug en mayúsculas pasa en Windows y no en Linux | nginx para Windows compila regex sin distinguir mayúsculas | No probar mayúsculas en el arnés |
| 14 | Una frase citable exagera | Atribuye el máximo (revisiones) a toda la cifra (hectáreas) | «N en algún momento; en parte, hasta K de R», con prueba negativa |
| 15 | Un asistente podría citar «no hay riesgo en X» | La réplica no marca algo que el oficial sí marca | La frase nunca afirma ausencia de riesgo y remite al operativo |
| 16 | Una frase se lee como la cifra oficial | Dice «según el sistema X de la Organización» siendo una réplica | «La réplica en validación de X (Unidad), que todavía no reemplaza a X operativo» |
| 17 | El protocolo rechaza el sitemap | `Sitemap: /sitemap.xml` relativo | URL absoluta |
| 18 | JSON-LD inyectable o roto | Nombres con `</script>`; o se escapó con entidades HTML | `<`, `>`, `&` dentro del JSON |
| 19 | Un cuadro vacío en la tarjeta | La tipografía no trae `▪` | Dibujar la viñeta |
| 20 | Texto montado en la franja de la tarjeta | Estado, fecha y URL en la misma línea | La URL encima de la franja; mirar SIEMPRE el PNG |
| 21 | Facebook muestra la vista previa de otro día | Cachea por URL (`og:url`) durante días | `og:url` con `?d=<fecha>` y `canonical` sin fecha; fecha visible en la tarjeta |
| 22 | La prueba falla con `O'Higgins` | El nombre sale escapado (`&#x27;`) en el HTML, y eso es correcto | Comparar contra `html.escape(nombre)` |
| 23 | `urllib.robotparser` dice «permitido» y Google bloquea | Usa la primera regla que casa, no la más larga | Lector RFC 9309 propio |
| 24 | PR «mezclados» que no llegan a `main` | PR apilados: cada uno apunta a la rama del anterior, y el primero ya estaba mezclado | PR contra `main`; si ya pasó, un PR de integración desde la última rama (`git merge-tree` antes, para ver conflictos) |
| 25 | Todos los jobs del CI en rojo con 0 pasos | Facturación o cuota de Actions de la organización («The job was not started because recent account payments have failed…») | No es el código: lo resuelve el dueño de la organización. Mientras, verificar en local |
| 26 | Un guion de edición rompe el archivo (salto de línea literal en una cadena, `\s` inválido) | Python o sed dentro de un heredoc de bash: los escapes se pierden | El guion en un archivo aparte, o la herramienta de edición |
| 27 | Diferencias de CRLF en documentos | El archivo es CRLF y el editor escribió LF | Editar con `newline=''` y restituir `\r\n`; contar después |
| 28 | La licencia de la tipografía cambia su sha en otro clon | La conversión automática de finales de línea en Windows | `-text` en `.gitattributes` para los insumos con sha |
| 29 | Un comentario `/* … */` rompe el service worker | Contenía `*/*` | Comentarios `//` |
| 30 | `pip install` de requirements.lock no reproduce la imagen | Pines duplicados en dos archivos | Fijar en los dos y comprobar la paridad (en la flota, `verificar_despliegue.py`) |

---

## 13. Lista de aceptación final

### En local

- [ ] Suite de pruebas del backend completa, con las nuevas (frases, metadatos, JSON-LD, slug,
      tarjetas, poda, logs, vigilancia, IndexNow apagado).
- [ ] `npm run lint && npm run prueba && npm run build`, con las guardas `estado`, `robots` y
      `validar-html` en verde y sus negativas rojas.
- [ ] `dist/index.html`: texto en `#root`, directiva SSI en `<head>` y en `#root` con su `stub`, y
      ninguna `og:`.
- [ ] El generador corre dos veces sobre la corrida de referencia con `diff -r` vacío; y una vez
      sobre la corrida publicada real.
- [ ] `probar_nginx.py` verde contra nginx local; **rojo** con `ssi off` y sin `internal`; verde con
      `--sin-respaldo`.
- [ ] Recorrido en navegador verde contra el servidor de desarrollo **y** contra nginx con la
      construcción real.
- [ ] Escáner de secretos y verificador de despliegue en verde.

### En el CI

- [ ] Todos los jobs, incluido el de nginx: imagen real, arnés y mutaciones.

### En vivo, tras desplegar

```sh
S=https://SITIO
curl -s -A 'OAI-SearchBot/1.4' $S/ | grep -o 'data-frase-dia><p>[^<]\{0,160\}'     # frase con la fecha publicada
curl -s -A 'WhatsApp/2.23' $S/ | grep -oE 'og:(title|image)" content="[^"]+'        # tarjeta del día
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' $S/entidad/<slug>/        # 200 text/html; charset=utf-8
curl -sI $S/datos/ultima.json | grep -i x-robots-tag                               # noindex
curl -s -H 'Accept: */*' -H 'Accept-Encoding: gzip' $S/ | gunzip | grep -c <script-analitica>   # 1
```

- [ ] Depurador de Facebook («Scrape again»), LinkedIn Post Inspector, Telegram y un envío real por
      WhatsApp.
- [ ] Rich Results Test y validator.schema.org sobre `/entidades/` y una entidad.
- [ ] Search Console: la Inspección de URL muestra la frase en el HTML rastreado.
- [ ] La regla `indexable` de la vigilancia no abre un issue.
- [ ] `bots_en_logs.py` en el servidor, a los pocos días: aparecen `busqueda-ia` y `vista-previa`.

---

## 14. Adaptar a otras arquitecturas

| Si el proyecto… | Entonces |
|---|---|
| Es un sitio de **contenido estático** (sin datos diarios) | Basta con la Fase 1 y un prerender de **todas** las rutas al construir. No hacen falta SSI ni generador. Las vistas previas pueden ser estáticas por ruta. |
| Usa **Next.js / Astro / Remix** | Usa SSG o ISR del framework para las páginas por entidad y `generateMetadata` o equivalente para las `og:`. Las reglas de las frases (6.3), las tarjetas (8) y la medición (10) siguen iguales. Las tarjetas pueden salir de `@vercel/og` o satori si hay Node en ejecución. |
| Tiene los datos en una **API**, no en archivos | Un cron o una tarea programada genera `web/` desde la API, o nginx hace SSI contra un *endpoint* interno que devuelve el fragmento (`include virtual` a una `location` con `proxy_pass`). Mantén los fragmentos idempotentes y cacheados. |
| No tiene **nginx** | Caddy (`templates`), Apache (`mod_include`, `Options +Includes`), Cloudflare o un *edge worker* que reescriba el `<head>`. La prueba de comportamiento (7.5) se adapta igual: marcas en el volumen y peticiones HTTP. |
| No tiene **backend en Python** | El generador es pequeño: portarlo a Node, Go u otro. Conserva la pureza, el determinismo, la escritura atómica, el índice al final y las pruebas de 6.8. Para las tarjetas en Node: `@resvg/resvg-js` + satori, o `canvas`. |
| No tiene **entidades** (una sola página) | Solo la capa fija y la vista previa del día de la portada (SSI) y su tarjeta. |
| Es de la **flota coipo** (vm2, Alteon, nginx del host, Umami) | Todo lo de aquí aplica tal cual. El log duradero es el del host. El dominio lo fija la medida de reemplazo o publicación. La analítica se inyecta en el host. `/health` tiene que seguir 2xx sin redirección, porque un juez de la flota lo exige. |

---

## 15. Fuentes primarias

Verificadas el 2026-09-25. Vuelve a verificarlas si pasó tiempo.

- **Google**
  - Funciones de IA y el sitio: «There are no additional requirements to appear in AI Overviews or
    AI Mode». <https://developers.google.com/search/docs/appearance/ai-features>
  - Guía de optimización para IA generativa: no hace falta escribir distinto ni `llms.txt`.
    <https://developers.google.com/search/docs/fundamentals/ai-optimization-guide>
  - Rastreadores (Google-Extended no afecta a Search).
    <https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers>
  - Controles de IA generativa en Search Console.
    <https://support.google.com/webmasters/answer/16908024>
  - Informe de rendimiento de IA generativa. <https://support.google.com/webmasters/answer/16984139>
  - JavaScript y el prerender. <https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics>
  - No bloquear lo que la página necesita. <https://developers.google.com/search/docs/crawling-indexing/robots/intro>
  - Dataset. <https://developers.google.com/search/docs/appearance/structured-data/dataset>
  - Políticas de datos estructurados (solo lo visible).
    <https://developers.google.com/search/docs/appearance/structured-data/sd-policies>
- **OpenAI** (OAI-SearchBot, GPTBot, ChatGPT-User): <https://developers.openai.com/api/docs/bots>
- **Anthropic** (ClaudeBot, Claude-User, Claude-SearchBot): <https://support.claude.com/en/articles/8896518>
- **Perplexity** (PerplexityBot, Perplexity-User): <https://docs.perplexity.ai/guides/bots>
- **Vercel/MERJ**: los rastreadores de IA no ejecutan JavaScript. <https://vercel.com/blog/the-rise-of-the-ai-crawler>
- **RFC 9309** (Robots Exclusion Protocol): <https://www.rfc-editor.org/rfc/rfc9309.html>
- **Protocolo de sitemaps**: <https://www.sitemaps.org/protocol.html>
- **Bing Webmaster**, AI Performance: <https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview>
- **IndexNow**: <https://www.indexnow.org/documentation>
- **nginx**
  - SSI (`stub`, `ssi_silent_errors`, variables en `include virtual`): <https://nginx.org/en/docs/http/ngx_http_ssi_module.html>
  - `location`, `try_files`, `internal`: <https://nginx.org/en/docs/http/ngx_http_core_module.html>
- **Open Graph**: <https://ogp.me/>
- **Facebook** (compartir y caché): <https://developers.facebook.com/docs/sharing/webmasters>
