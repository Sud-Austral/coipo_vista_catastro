# Visibilidad del visor: buscadores, asistentes de IA y vistas previas

Guía de operación. Explica qué publica el visor para que lo lean quienes no ejecutan JavaScript,
cómo se comprueba después de cada despliegue y qué falta hacer fuera de este repositorio.

- **Por qué cada cosa es como es:** `DECISIONES.md` §M.
- **La guía de origen:** `implementacion_ceo.md`, destilada de Botón Rojo.

---

## 1. Qué se publica y dónde

Todo cuelga de `https://sud-austral.github.io/coipo_vista_catastro/`.

| Qué | Dónde | Lo genera |
|---|---|---|
| Portada con texto horneado: título, frase citable con las cifras nacionales, «qué es», tabla de usos y enlaces a las regiones | `/` (`dist/index.html`) | `npm run build` → `scripts/prerender.mjs` |
| Descripción, canonical, vista previa (`og:*`, `twitter:*`) de la portada | `<head>` de `/` | ídem, con los datos del manifest |
| Índice: todas las regiones y comunas, datos publicados y Metodología, con JSON-LD `Dataset` | `/regiones/` | `npm run build:web` → `scripts/web.mjs` |
| Una página por región (16) | `/region/<slug>/` | ídem |
| Una página por comuna (343) | `/comuna/<slug>/` | ídem |
| Mapa del sitio (361 URL) | `/sitemap.xml` | ídem |
| Qué página corresponde a cada código (lo usa Compartir) | `/web/indice.json` | ídem |
| Tarjeta de vista previa por región y comuna (1200×630) | `/tarjetas/<sello>/{region,comuna}-<slug>.png` | `python scripts/tarjetas.py` |
| Tarjeta genérica (portada e índice) | `/og.png` | `python scripts/tarjetas.py --generica` (versionada) |
| `robots.txt` que cuenta | `https://sud-austral.github.io/robots.txt` | **otro repositorio** (§3) |

Tres reglas no se ven a simple vista:

- **Las cifras de las páginas son las del panel.** Salen de las mismas funciones que usa el visor.
  `validar-paginas` las recalcula por otro camino antes de publicar.
- **Una URL publicada no desaparece.** El registro es `frontend/scripts/slugs-publicados.json`,
  sólo de alta. Si una comuna cambia de nombre, su URL vieja pasa a ser un alias. Una URL nueva
  exige `node scripts/web.mjs --registrar` y commitear el registro.
- **Nada de esto se commitea, salvo `og.png` y el registro.** Se genera en el CI con cada
  despliegue.

---

## 2. Después de cada despliegue

El job `humo` de `.github/workflows/deploy.yml` ya comprueba lo siguiente:

- que Pages sirva el build nuevo;
- la portada, el manifest y el `.bin`;
- el sitemap, con la cuenta derivada del manifest;
- una muestra de páginas y sus tarjetas;
- la redirección sin barra final;
- Umami;
- el `robots.txt` raíz.

A mano, cuando se quiera mirar lo publicado:

```sh
S=https://sud-austral.github.io/coipo_vista_catastro
# Lo que lee un asistente: la frase citable de la portada, con cifras
curl -s -A 'OAI-SearchBot/1.4' $S/ | grep -o 'data-frase[^>]*>[^<]\{0,200\}'
# La vista previa de una comuna, como la arma WhatsApp
curl -s -A 'WhatsApp/2.23' $S/comuna/panguipulli/ | grep -oE '(og:title|og:url|og:image)" content="[^"]+'
# Una página, su redirección sin barra y el sitemap
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' $S/regiones/                  # 200 text/html; charset=utf-8
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' $S/comuna/panguipulli          # 301 → …/panguipulli/
curl -s $S/sitemap.xml | grep -c '<loc>'                                              # 361 = 2 + regiones + comunas
# El robots.txt de la organización
curl -s -o /dev/null -w '%{http_code}\n' https://sud-austral.github.io/robots.txt      # 200 cuando exista (§3)
```

Además hay que revisar la vista previa en cada red y los datos estructurados. Conviene hacerlo
con la portada, una región y una comuna:

- **Facebook:** Sharing Debugger (<https://developers.facebook.com/tools/debug/>), con
  **«Scrape again»**. Facebook guarda la tarjeta días por URL, y `og:url` lleva `?v=<versión>`
  justo para que una tarjeta nueva no quede tapada por la vieja.
- **LinkedIn:** Post Inspector (<https://www.linkedin.com/post-inspector/>).
- **Telegram:** `@WebpageBot`, mandándole el enlace.
- **WhatsApp:** un envío real a alguien.
- **Datos estructurados:** Rich Results Test (<https://search.google.com/test/rich-results>) y
  <https://validator.schema.org> sobre `/regiones/` (Dataset) y una comuna (WebPage).

---

## 3. Pendientes que no son código

Cada uno queda ABIERTO hasta que alguien lo haga. Van con quién puede hacerlo.

### 3.1 El `robots.txt` de la organización

**Lo hace un admin de la organización** (Luis Monsalve lo es). Decisión: DECISIONES §M.2.

En GitHub Pages el único `robots.txt` que leen los rastreadores es el de la raíz del host. Ese
host es de la organización y hoy da 404: cualquier bot, incluidos los que entrenan modelos, puede
leer el visor. El humo lo avisa en cada despliegue.

1. Crear el repositorio público `Sud-Austral/sud-austral.github.io`.
2. Copiar `docs/robots-raiz.txt` como `robots.txt` en su raíz, y commitear en `main`.
3. En *Settings → Pages*: *Deploy from a branch*, `main`, `/ (root)`.
4. **No agregar CNAME**: movería los 68 sitios de la organización a otro dominio.
5. **No agregar `404.html`**: Pages lo serviría como página de error de todos los sitios que no
   tengan una propia.
6. Comprobarlo:
   ```sh
   node frontend/scripts/robots.mjs --url https://sud-austral.github.io/robots.txt
   ```
   Tiene que decir que los 14 lectores pasan y los 6 de entrenamiento no.

**Si más adelante se cambia**, se cambian juntos `docs/robots-raiz.txt` y el del repositorio de la
organización. El humo lee el publicado con el mismo lector, RFC 9309.

### 3.2 El identificador de Umami

**Lo hace un admin de Umami** (`coipo_umami`). Decisión: DECISIONES §M.5 y §M.11.

1. En Umami, *Configuración → Sitios web → Añadir*, dominio `sud-austral.github.io`.
2. Copiar el *website-id* en `UMAMI.id` de `frontend/src/web/sitio.js`: una línea, un commit.
3. Con el identificador puesto, las guardas exigen una etiqueta por página. En la portada va con
   `data-auto-track="false"`, porque la app cuenta a mano; en las páginas, con el rastreo
   automático.
4. En `coipo_umami`, anotar que este sitio lleva la URL de Umami escrita en su HTML. Su
   `ops/nginx-host/analitica-sitios.conf` se declara «el único lugar de la flota» con esa URL, y
   al cambiar el dominio de Umami hay que cambiar también `sitio.js`.
5. **[VERIFICAR]** el aviso por la Ley 21.719 que `coipo_umami/DEUDA.md` deja pendiente.

**Qué se mide, en Umami:**

- las visitas por página, con el ámbito y los filtros y sin el encuadre del mapa;
- el evento `compartir`, con `destino` = `vista` o `pagina`;
- los referentes: `chatgpt.com`, `perplexity.ai`, `claude.ai`, `copilot.microsoft.com`,
  `gemini.google.com`;
- `utm_source=chatgpt.com` y las demás `utm_*`, en la **primera** visita: la app las conserva al
  registrarla aunque después las borre de la barra al escribir su estado.

### 3.3 Search Console y Bing Webmaster

**Lo hace la Unidad**, con una **cuenta funcional** de la UIA y dos responsables nombrados.
Nunca una cuenta personal.

- **Search Console:**
  1. Propiedad de **prefijo de URL**: `https://sud-austral.github.io/coipo_vista_catastro/`.
  2. Verificación con el **archivo HTML** que entrega Google. Se copia en `frontend/public/` y
     se commitea; el DNS del dominio no es nuestro.
  3. *Sitemaps* → enviar `https://sud-austral.github.io/coipo_vista_catastro/sitemap.xml`.
  4. *Inspección de URL* sobre `/` y sobre una comuna. El **HTML renderizado** tiene que traer la
     frase citable, y así lo exige V-69 aunque Googlebot no baje el `.bin`.
  5. *Rendimiento → IA generativa*: las impresiones en AI Overviews y AI Mode, cuando haya
     volumen.
- **Bing Webmaster:**
  1. Importar la propiedad desde Search Console.
  2. *AI Performance*: las citas en Copilot y en los resúmenes de Bing. No mide ChatGPT, Claude
     ni Perplexity.

### 3.4 Lo demás

- **Licencia de los datos.** Los términos de uso están pendientes de definir por CONAF. Hasta
  entonces, el `Dataset` va sin `license` y el entrenamiento sigue bloqueado.
- **La redacción de los ceros** (DECISIONES §M.9, propuesta). Hay que confirmarla con la Unidad.
- **Grafías en disputa** (`ETL/homologacion/14_REVISAR.csv`). Si CONAF resuelve alguna, los
  alias de URL son automáticos.
- **Dominio definitivo.** Un cambio de dominio sin redirección 301 pierde lo indexado, y Pages no
  redirige entre dominios.
- **Enlaces entrantes** desde `conaf.cl` y la publicación en un portal de datos abiertos (exige
  licencia).
- **Seguimiento mensual:** Search Console, Bing AI Performance y Umami, en una planilla.

---

## 4. Cuando algo falla

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El humo espera 10 minutos y falla con «Pages sigue sin servir el build» | Pages no terminó de publicar, o se publicó otro commit encima | Relanzar el job; si persiste, mirar la pestaña *Deployments* |
| `validar-html` falla en `npm run build` | La portada horneada o su `<head>` cambiaron de forma | Leer el problema: cada regla dice qué exige |
| `build:web` falla con «URL sin registrar» | Apareció una comuna o cambió un nombre | `node scripts/web.mjs --registrar` y commitear `scripts/slugs-publicados.json` |
| `build:web` falla con «repositorio superficial» | El checkout se hizo con `fetch-depth: 1` | En el CI, `fetch-depth: 0`; en local, `git fetch --unshallow` |
| `tarjetas.py` se niega por la versión de Pillow | Otra versión dibuja otros píxeles con el mismo sello | `pip install -r frontend/scripts/requirements.txt` en un venv |
| El humo avisa «robots.txt no existe» | Falta el repositorio de la organización | §3.1 |
| Facebook enseña una tarjeta vieja | Guarda la tarjeta por URL durante días | Sharing Debugger → «Scrape again» |
