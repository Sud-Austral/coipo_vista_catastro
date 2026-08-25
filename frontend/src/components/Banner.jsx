import banner from '../assets/banner-conaf-fiscalizacion.jpg'

/**
 * Cabecera institucional: CONAF · Unidad de Información y Análisis · Gerencia de
 * Fiscalización Forestal y Evaluación Ambiental.
 *
 * La UIA construye este visor PARA la Gerencia de Fiscalización, y el asset lo
 * dice: trae las dos marcas. Por eso la atribución del pie nombra a las dos y no
 * hay ningún «desarrollado por» suelto en la interfaz.
 *
 * Un <header> que no está dentro de article/aside/main/nav/section YA es el
 * landmark `banner`, así que role="banner" sobra. El <header> de cada panel no
 * compite: va dentro de un <aside> y ahí no se promueve a landmark.
 *
 * LOS ATRIBUTOS width/height CON LAS MEDIDAS ORIGINALES NO SON DECORATIVOS: le
 * dan al navegador un aspect-ratio con el que reservar el alto ANTES de pedir un
 * solo byte de la imagen. De eso depende que Leaflet mida bien .mapa —el mapa se
 * crea en un efecto que corre después del layout— y que el encuadre por región
 * salga igual en cada carga. Si se quitan, con la imagen bloqueada la banda
 * colapsa y el mapa nace con el alto equivocado.
 *
 * Sin loading="lazy": esto está sobre el pliegue. Sin enlace al inicio: es una
 * sola vista. Sin título ni acciones a la derecha: ahí vive el remate decorativo
 * verde, y sus tonos no alcanzan AA con texto normal.
 *
 * EL ALT NO ES DECORATIVO Y NO SE PUEDE ABREVIAR. Por debajo de 1164,83 px de
 * viewport el asset se pinta a escala 0,38, así que las tres líneas de «Gerencia
 * de fiscalización forestal y evaluación ambiental» quedan en unos 6 px de alto:
 * están en pantalla y NO se leen. Ese texto sólo le llega de verdad a alguien
 * por aquí y por el <title>. Si alguien recorta el alt a «CONAF», la unidad
 * responsable del visor deja de estar declarada en ninguna parte accesible.
 *
 * EL ARCHIVO IMPORTADO NO ES BYTE A BYTE EL DE INSUMO_GRAFICO, y es a propósito.
 * INSUMO_GRAFICO/4_banner_FISCALIZACION.jpg pesa 74.930 B; éste es el mismo
 * pintado reencodeado a quality=95, sin submuestreo de croma (4:4:4), progresivo
 * y optimizado: 38.649 B, o sea la mitad. El original queda intacto en
 * INSUMO_GRAFICO como procedencia, así que no se pierde nada recuperable.
 *
 * MEDIDO, no supuesto:
 *   diferencia máxima por canal      9 de 255
 *   píxeles que difieren más de 4    683 de 536.664 (0,13 %)
 *   campo verde plano                #064928, que es --verde-institucional
 * Si el banner vuelve a cambiar, rehaz el reencodeado: no es un paso del build.
 */
export default function Banner() {
  return (
    <header className="banner">
      <img
        src={banner}
        width={3032}
        height={177}
        alt="CONAF · Unidad de Información y Análisis · Gerencia de Fiscalización Forestal y Evaluación Ambiental"
        fetchPriority="high"
        decoding="async"
        draggable={false}
      />
    </header>
  )
}
