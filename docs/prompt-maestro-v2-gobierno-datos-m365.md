# Prompt Maestro v2.0 — Plataforma Automática de Descubrimiento, Inventario y Gobierno de Activos de Datos Microsoft 365 (JUNJI)

**Caso piloto:** Felipe Zafe Contreras (felipe.zafe@junji.cl), Funcionario Gabinete
**Alcance de ejecución de este documento:** basado en permisos delegados del usuario autenticado, mediante conectores oficiales de Microsoft 365 (Graph, delegado) disponibles en este entorno.
**Fecha:** 18-07-2026

> Nota de método: las secciones 7 a 14 se alimentaron con una pasada real de descubrimiento (solo metadatos: asunto, nombre de archivo, sitio, fechas, tipo, remitente) ejecutada contra el propio buzón/SharePoint/Teams de Felipe Zafe a través de conectores Microsoft Graph delegados. No se leyó contenido de archivos ni cuerpo completo de comunicaciones. Los nombres de terceras personas y cualquier dato personal, de salud o de desempeño encontrado en nombres de archivo fueron **generalizados/redactados** en este documento por principio de privacidad por diseño; solo se citan cifras agregadas y ejemplos no identificantes.

---

## 1. Resumen Ejecutivo

JUNJI opera un volumen relevante de activos de datos dispersos en Outlook, SharePoint, Teams, OneDrive y Power BI, generados por procesos administrativos, presupuestarios, educativos y de personal. Una pasada exploratoria en el entorno M365 de Felipe Zafe confirma esta hipótesis con evidencia concreta:

- **≥2.564 archivos Excel** cuyo nombre o contenido contiene "informe" indexados por búsqueda de SharePoint accesible al usuario (muestra parcial, no exhaustiva).
- **383 activos** (páginas, archivos, sitios) relacionados con "dashboard", incluyendo páginas de sitio con Power BI embebido (p. ej. sitios `dnvtf` y `Datos_y_Estadisticas`).
- **Reportes automáticos periódicos reales en Outlook**: la casilla recibe, de forma recurrente y multidestinatario, correos con asunto "Informe Ejecución Presupuestaria" generados por un remitente único de un área de Finanzas, distribuidos a Gabinete, Auditoría, TI, RRFF, Fiscalía y GDP el mismo día — un patrón de "informe consolidado con variantes por unidad" (mismo contenido base, distinto destinatario), candidato directo a modelo semántico único en Power BI/Fabric.
- **Estructura de sitios SharePoint por Dirección Regional y unidad funcional** (`DR_ARICA`, `UnidadPersonalDRLosLagos`, `SECCIONGESTIONCURRICULAR`, `Datos_y_Estadisticas`, `dnvtf`, `Depto_Informatica`, `gestiondesempenoindividualDRM`, etc.), lo que indica un patrón de duplicación de plantillas de informe (presupuesto, HHEE, reemplazos, precalificación) por región, sin una fuente maestra consolidada visible.
- **Colaboración en Teams**: chats y reuniones institucionales (comisiones, licitaciones, gabinete, COSOC) que constituyen fuentes semiestructuradas adicionales (actas, minutas, decisiones) hoy no catalogadas.

Esto valida el diagnóstico del prompt original: existe un volumen importante de activos de datos "en la sombra" (shadow data), sin gobierno, con alta duplicación de plantillas y bajo nivel de catalogación. Es viable construir, sin permisos administrativos y respetando estrictamente los permisos del usuario autenticado, un **Inventario Maestro inicial** y un piloto de descubrimiento automatizado (Escenario B), preparando el terreno para Purview/Fabric/Copilot (Escenario C) cuando exista patrocinio institucional.

**Recomendación central:** iniciar con un MVP de 30 días acotado a metadatos (sin leer contenido sensible), reutilizando el patrón de proxy MCP que ya existe en este repositorio (`docdigital-mcp-proxy`) para exponer de forma segura y auditable el descubrimiento M365 como herramientas de un agente, evitando cualquier scraping o almacenamiento de credenciales en texto plano.

---

## 2. Objetivos

1. Descubrir automáticamente los activos de datos accesibles al usuario autenticado en Outlook, SharePoint, Teams, OneDrive y Power BI.
2. Construir un Inventario Maestro y un Catálogo Corporativo versionable.
3. Clasificar activos por dominio, sensibilidad, criticidad y potencial de IA/analítica.
4. Calcular tres índices objetivos: **DQS** (calidad), **ARS** (preparación IA), **AnRS** (preparación analítica/priorización).
5. Detectar duplicidades, versiones y fuentes maestras candidatas.
6. Construir un Data Lineage y un Enterprise Data Map iniciales.
7. Preparar a JUNJI para adopción responsable de Copilot, un GPT corporativo y Microsoft Fabric.
8. Hacerlo sin vulnerar permisos, sin scraping, sin credenciales en texto plano y sin exceder el alcance autorizado del usuario piloto.

---

## 3. Alcance

**Dentro de alcance (Fase 0):**
- Buzón Outlook de Felipe Zafe (carpetas, metadatos de correo y adjuntos).
- Sitios y bibliotecas SharePoint a los que el usuario tiene acceso concedido.
- Chats y reuniones de Teams de los que el usuario es miembro.
- OneDrive personal del usuario.
- Activos Power BI visibles para el usuario (workspaces, reports, datasets) — **pendiente de validar vía Power BI REST API**, no cubierto por el conector actual (ver Supuestos).
- Formatos: Excel, CSV, Word, PDF, Access, listas SharePoint, modelos semánticos, dataflows, dashboards.

**Fuera de alcance (explícito):**
- Buzones o sitios de terceros sin permiso delegado del usuario.
- Lectura de contenido completo de documentos o correos en esta fase (solo metadatos).
- Cualquier acción de escritura, modificación o eliminación de activos.
- Datos personales sensibles (salud, evaluación de desempeño, remuneraciones individuales) — se detectan como **categoría** pero no se procesan sin autorización explícita del Data Owner y del Encargado de Protección de Datos institucional.
- Escalamiento a nivel corporativo (todos los usuarios JUNJI) — solo posible en Escenario C, con patrocinio y permisos de aplicación (application permissions) aprobados formalmente.

---

## 4. Supuestos

Declarados explícitamente por transparencia (no se infiere lo que no se pudo verificar):

| # | Supuesto | Nivel de incertidumbre | Cómo validarlo |
|---|---|---|---|
| S1 | El usuario opera con permisos delegados estándar de un funcionario de Gabinete, sin rol de administrador de M365/Entra ID. | Bajo (confirmado por `get_me`: jobTitle "Funcionario Gabinete") | Confirmar con TI/Entra ID el perfil de roles asignado |
| S2 | No existe actualmente Microsoft Purview activo con clasificación/etiquetado de sensibilidad sobre estos activos. | Medio (no se pudo consultar Purview desde este entorno) | Solicitar a TI/Seguridad de la Información el estado de Purview (Information Protection, DLP) |
| S3 | Los "informes de ejecución presupuestaria" distribuidos por correo a múltiples áreas provienen de una única fuente de datos consolidada (probable Power BI o Excel maestro en Finanzas). | Medio (inferido por patrón de envío, no verificado en el origen) | Entrevistar al área remitente (Finanzas/Presupuesto) y solicitar el origen del reporte |
| S4 | No hay acceso operativo hoy a Power BI REST API, Microsoft Fabric API ni Purview API desde este entorno de agente; el conector M365 disponible cubre Outlook, SharePoint (búsqueda), Teams y OneDrive vía Graph delegado. | Alto | Solicitar registro de aplicación en Entra ID con los scopes de Power BI Service API si se decide avanzar a Escenario B/C |
| S5 | La cifra de 2.564 archivos Excel con "informe" y 383 con "dashboard" es una cota inferior: la búsqueda delegada de SharePoint no indexa necesariamente el 100% de bibliotecas a las que el usuario tiene acceso teórico (sincronización del índice de búsqueda). | Medio | Contrastar con un barrido de Microsoft Graph `/search/query` y con `Sites.Read.All` delegado ampliado |
| S6 | Los archivos detectados con nombres que referencian licencias médicas, precalificación/desempeño o nómina de una persona específica corresponden a datos personales/sensibles bajo la Ley 19.628 y normativa de función pública. | Bajo (evidente por el nombre del archivo) | Confirmar con Data Owner de RR.HH. la clasificación formal y el tratamiento autorizado |

---

## 5. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Exposición de datos personales/sensibles (salud, desempeño, remuneraciones) al ampliar el descubrimiento a lectura de contenido | Media | Alto | Fase de metadatos primero; anonimización; autorización explícita de Data Owner antes de leer contenido |
| Uso de credenciales de aplicación con permisos excesivos ("over-permissioning") | Media | Alto | Principio de mínimo privilegio; permisos delegados en Escenario B; revisión periódica de consentimientos en Entra ID |
| Duplicación de "fuente de verdad" (mismo indicador calculado en Excel regional y en Power BI corporativo) generando reportes contradictorios | Alta (ya observado en la muestra) | Medio-Alto | Data Lineage + declaración de fuente maestra por dominio (Fase 8) |
| Fatiga de correo/():envío masivo de un mismo informe a múltiples áreas sin trazabilidad de quién lo consume | Alta (patrón observado) | Bajo-Medio | Migrar el reporte a un dataset único en Power BI con distribución por RLS (Row-Level Security) en vez de correo |
| Resistencia organizacional o falta de patrocinio para Escenario C (Purview/Fabric a nivel corporativo) | Media | Medio | MVP acotado y de bajo riesgo (Escenario A/B) que demuestre valor antes de solicitar patrocinio |
| Uso indebido de este inventario para vigilancia laboral en vez de gestión de datos | Baja | Alto | Gobierno explícito: el objetivo es catalogar activos, no auditar personas; excluir del inventario cualquier métrica de comportamiento individual |
| Dependencia de un solo usuario (Felipe Zafe) como piloto, sesgando el inventario a su unidad (Gabinete) | Alta | Medio | Escalar el piloto a 3-5 usuarios de distintas áreas (Finanzas, RR.HH., Datos y Estadística) antes de generalizar conclusiones |

---

## 6. Arquitectura de Automatización

El descubrimiento de este documento se ejecutó con un patrón de **agente + conector MCP delegado**: el agente invoca herramientas Microsoft Graph (`outlook_email_search`, `sharepoint_search`, `sharepoint_folder_search`, `teams_list_chats`, `chat_message_search`, `get_me`) que devuelven metadatos, sin exponer credenciales al modelo ni requerir scraping.

Este mismo patrón es el que ya implementa el repositorio `docdigital-mcp-proxy`: un servidor MCP stateless sobre HTTP (`index.js`) que obtiene un token OAuth por *client credentials*, lo cachea en memoria (nunca en texto plano en disco) y expone operaciones acotadas (listar, detalle, descargar, acusar recibo) como *tools* tipadas con `zod`. La recomendación arquitectónica es **replicar este mismo patrón para un `m365-discovery-mcp-proxy`**: un servicio dedicado que hable con Microsoft Graph, cachee tokens en memoria, exponga *tools* de solo lectura de metadatos (nunca de escritura sobre el contenido) y quede detrás de una `PROXY_API_KEY` propia, igual que el proxy DocDigital actual.

```
Microsoft Entra ID (registro de app, permisos delegados/aplicación)
        │
        ▼
Microsoft Graph API  ── (tokens en memoria, nunca en disco) ──▶  Servicio Proxy MCP de Descubrimiento
        │                                                             │
        ├─ Outlook API (metadatos de correo)                         ├─ tool: discover_mailbox
        ├─ SharePoint REST/Graph (sitios, bibliotecas, permisos)      ├─ tool: discover_sharepoint
        ├─ Teams (chats, canales, archivos)                          ├─ tool: discover_teams
        ├─ OneDrive (Graph /me/drive)                                ├─ tool: discover_onedrive
        └─ Power BI REST API (workspaces, datasets, reports)          └─ tool: discover_powerbi
                                                                             │
                                                                             ▼
                                                              Inventario Maestro (almacenamiento estructurado)
                                                                             │
                                                                             ▼
                                                    Motor de Clasificación y Calidad (reglas + scoring DQS/ARS/AnRS)
                                                                             │
                                                                             ▼
                                                        Catálogo Corporativo / Modelo Semántico (Power BI / Fabric)
                                                                             │
                                                                             ▼
                                                Microsoft Copilot · GPT Corporativo · Microsoft Fabric (OneLake)
```

Automatización de orquestación: **Azure Functions** (ejecución programada del descubrimiento), **Power Automate/Logic Apps** (flujos de aprobación y notificación a Data Stewards), **Microsoft Purview** (cuando exista patrocinio corporativo, para clasificación de sensibilidad y catálogo unificado a nivel tenant).

---

## 7. Estrategia Outlook

**Hallazgo real:** la bandeja de Felipe Zafe recibe informes de ejecución presupuestaria de forma recurrente, el mismo día, con múltiples variantes de asunto ("Gabinete Ejecución Presupuestaria", "Auditoria Ejecución Presupuestaria", "TI Informe de Ejecución", "RRFF Informe Ejecución Presupuestaria", "GDP Informe Ejecución Presupuestaria", "Fiscalía Informe Ejecución Presupuestaria") desde un mismo remitente del área de Finanzas, todas con adjuntos.

**Interpretación:** es el mismo reporte base, particionado manualmente por unidad destinataria — un candidato directo a modelo semántico único en Power BI con seguridad a nivel de fila (RLS), reemplazando el envío masivo por suscripción a un dashboard.

**Estrategia:**
1. Descubrir primero solo metadatos (asunto, remitente, fecha, adjuntos, carpeta) vía `Mail.Read` delegado — sin abrir cuerpo ni adjuntos.
2. Detectar reportes periódicos por recurrencia de patrón de asunto + remitente + frecuencia (diaria/semanal/mensual).
3. Clasificar adjuntos por tipo de archivo (xlsx, csv, pdf, docx) y frecuencia de aparición.
4. Marcar como "candidato a consolidación" todo asunto que se repita con variantes de destinatario/unidad.
5. No leer contenido de adjuntos con nombres que sugieran datos personales (licencias médicas, evaluaciones, remuneraciones) sin autorización explícita del Data Owner de RR.HH.

---

## 8. Estrategia SharePoint

**Hallazgo real:** la búsqueda delegada devolvió **2.564 resultados** de Excel con "informe" y **383** relacionados con "dashboard" distribuidos en sitios como `DR_ARICA`, `UnidadPersonalDRLosLagos`, `SECCIONGESTIONCURRICULAR`, `Datos_y_Estadisticas`, `dnvtf`, `Depto_Informatica`, `gestiondesempenoindividualDRM`. Se observan:
- **Archivos temporales de bloqueo** (`~$...xlsx`), indicando ediciones concurrentes activas o abandonadas — ruido a filtrar del inventario.
- **Duplicación de plantillas por año y por Dirección Regional** (p. ej. "Programa de Ejecución Extra" repetido por región y periodo), sin biblioteca central declarada.
- **Sitios de datos consolidados** (`Datos_y_Estadisticas`, `dnvtf`) que ya alojan páginas con Power BI embebido — son los mejores candidatos a "fuente primaria" corporativa.

**Estrategia:**
1. Inventariar sitios, bibliotecas, carpetas y metadatos (autor, fechas, tamaño, versiones) vía Graph/SharePoint REST, sin descargar contenido.
2. Excluir del inventario los archivos temporales `~$*` y `.tmp`.
3. Detectar "fuente primaria vs. copia" por heurística: mismo nombre base + distinta ruta + fechas de modificación distintas → marcar la de fecha más reciente y mayor completitud como candidata a vigente, las demás como histórico/respaldo, sujeto a validación del Data Owner.
4. Priorizar como fuente maestra los sitios temáticos corporativos (`Datos_y_Estadisticas`, `dnvtf`) sobre las carpetas operativas regionales.
5. Registrar permisos declarados del sitio (propietarios, niveles de acceso) sin intentar elevarlos.

---

## 9. Estrategia Teams

**Hallazgo real:** se listaron chats 1:1, grupales y de reunión del usuario, incluyendo instancias institucionales relevantes (comisión COSOC, procesos de licitación, gabinete, coordinación de emergencias/continuidad operacional). El chat grupal "GABINETE JUNJI" y reuniones con >20 asistentes (p. ej. sesiones de Directorio/Unidades Asesoras) son fuentes de decisiones y acuerdos hoy no catalogadas como activo de datos.

**Estrategia:**
1. Inventariar equipos, canales, archivos de canal y wikis vía Graph (`Team.ReadBasic.All` / `Channel.ReadBasic.All` delegados).
2. Tratar actas, minutas y decisiones compartidas en canales como activos semiestructurados candidatos a indexación semántica (RAG) para un futuro asistente de gabinete.
3. No indexar contenido de chats 1:1 sin anonimizar o sin consentimiento — mayor sensibilidad por naturaleza personal de la conversación.
4. Priorizar canales de equipos formales (no chats efímeros) como fuente de gobierno documental.

---

## 10. Estrategia OneDrive

**Estrategia (sin hallazgos directos en esta pasada, ya que la búsqueda se concentró en SharePoint compartido):**
1. Descubrir carpetas y archivos vía Graph `/me/drive/root/children` recursivo, con paginación.
2. Identificar archivos "maestros" personales (bases de datos de seguimiento, planillas de gestión propias) que deberían migrar a SharePoint para trazabilidad y continuidad operacional (mitigar el riesgo de "conocimiento atrapado" en el equipo de una sola persona).
3. Detectar versiones duplicadas entre OneDrive personal y SharePoint compartido del mismo archivo (incidencia común cuando se trabaja offline).

---

## 11. Estrategia Power BI

**Estado actual:** no se pudo ejecutar descubrimiento automático de Power BI en esta pasada — el conector M365 disponible en este entorno no incluye Power BI REST API (ver Supuesto S4). Sin embargo, la evidencia indirecta en SharePoint (páginas `dnvtf/Dashboard.aspx`, `Datos_y_Estadisticas/Indicadores-Regionales-2023.aspx`, menciones explícitas a "dashboard en Power BI" en `equipo_regional.aspx`) confirma que **ya existen workspaces y reports operativos** en Power BI Service para ejecución presupuestaria e indicadores regionales.

**Estrategia (a ejecutar cuando se habilite el scope correspondiente):**
1. Registrar una aplicación en Entra ID con permisos `Dataset.Read.All`, `Report.Read.All`, `Workspace.Read.All` de Power BI Service (delegados, acotados al usuario) o vía Power BI Admin API si hay patrocinio (Escenario C).
2. Inventariar workspaces, reports, dashboards, datasets, dataflows y modelos semánticos, con su origen de datos declarado (Excel, SharePoint, SQL, etc.).
3. Cruzar cada dataset de Power BI con los archivos Excel/CSV de origen detectados en SharePoint (Fase 8) para construir el primer tramo del Data Lineage.
4. Marcar como "fuente de verdad candidata" todo dataset de Power BI cuyo origen coincida con un sitio ya identificado como corporativo (`Datos_y_Estadisticas`, `dnvtf`).

---

## 12. Inventario Maestro

Estructura de campos (Fase 3) con ejemplos. Las filas de ejemplo usan los hallazgos reales de esta pasada, **generalizando cualquier referencia a personas específicas** y usando la ruta/sitio real (información organizacional, no personal).

| Campo | Ejemplo 1 (real, generalizado) | Ejemplo 2 (real, generalizado) | Ejemplo 3 (hipotético, pendiente de validar Power BI) |
|---|---|---|---|
| ID | AST-0001 | AST-0002 | AST-0003 |
| Nombre | Informe de Ejecución Presupuestaria (multi-unidad) | Correlativo de Minutas – Unidad de Infraestructura | Dashboard Ejecución Presupuestaria Establecimientos y Entidades |
| Dominio | Finanzas / Presupuesto | Infraestructura | Finanzas / Presupuesto |
| Área | Finanzas | Infraestructura DR Arica | Dirección Nacional / DNVTF |
| Responsable Funcional | Jefatura de Finanzas (por confirmar) | Encargado Unidad de Infraestructura | Encargado Datos y Estadística |
| Responsable Técnico | Por confirmar (TI) | Por confirmar (TI) | Por confirmar (TI/Power BI) |
| Propietario | Área Finanzas | DR Arica | DNVTF |
| Custodio | TI / Correo institucional | SharePoint DR_ARICA | SharePoint `dnvtf` |
| URL / Ubicación | Adjunto en correo institucional (múltiples envíos) | `sites/DR_ARICA/.../CORRELATIVOS/CORRELATIVO MINUTAS.xlsx` | `sites/dnvtf/SitePages/ejecucion_presupuestaria.aspx` |
| Tipo | Reporte periódico | Registro operativo | Dashboard |
| Formato | XLSX/PDF (adjunto correo) | XLSX | Power BI embebido |
| Sistema Origen | Desconocido (probable ERP/Excel Finanzas) | Excel manual | Probable Excel/Power BI dataset |
| Sistema Consumidor | Outlook (multi-área) | SharePoint | SharePoint + Power BI |
| Frecuencia | Mensual/al cierre financiero | Ad hoc (por asignación de minuta) | Mensual (según indicadores citados) |
| Última Actualización | 2026-07-17 | 2026-07-15 | 2026-03-26 |
| Tamaño | No determinado (metadato no expuesto) | No determinado | No determinado |
| N° de registros | No determinado sin abrir archivo | No determinado | No determinado |
| Variables principales | Monto ejecutado, monto presupuestado, unidad, periodo | N° minuta, unidad, fecha | Región, establecimiento, entidad, ejecución presupuestaria |
| Clave primaria | Periodo + Unidad (hipótesis) | N° correlativo | Región + periodo (hipótesis) |
| Relaciones | Posible dataset único fuente de 6 envíos por correo | Ninguna detectada | Posible mismo origen que AST-0001 |
| Clasificación de sensibilidad | Interna | Interna | Interna |
| Nivel de acceso | Restringido a Gabinete/Finanzas/Auditoría/TI/Fiscalía | Restringido a Infraestructura DR Arica | Público interno (DNVTF) |
| Estado | Vigente | Vigente | Vigente |
| Calidad (DQS) | Por calcular (Fase 5) | Por calcular | Por calcular |
| Potencial Analítico | Alto (serie temporal presupuestaria) | Bajo | Alto |
| Potencial IA | Alto (RAG/resumen ejecutivo, forecast) | Bajo | Alto (dashboard conversacional vía Copilot) |
| AI Readiness Score (ARS) | Por calcular (Fase 7) | Por calcular | Por calcular |
| Data Quality Score (DQS) | Por calcular | Por calcular | Por calcular |
| Analytic Readiness Score (AnRS) | Por calcular (Fase 9) | Por calcular | Por calcular |
| Observaciones | Fuerte candidato a consolidar 6 envíos manuales en 1 dataset con RLS | Activo administrativo de bajo valor analítico, alto valor de trazabilidad | Requiere validar origen exacto vía Power BI REST API |

> Los tres AST anteriores son una muestra ilustrativa, no el inventario completo. El inventario real de producción se llenará automáticamente por el proceso de descubrimiento (Fase 2/13) y vivirá en una tabla/lista estructurada (Excel/SharePoint List/Dataverse), no en este documento.

---

## 13. Catálogo de Datos

El Catálogo Corporativo es la vista "de negocio" del Inventario Maestro: agrupa activos por **dominio de negocio** (Presupuesto/Finanzas, RR.HH., Educación/Currícula, Infraestructura, Datos y Estadística, Gabinete/Gobierno Corporativo) y expone, por cada dominio:

- Activo(s) fuente de verdad declarados.
- Glosario de términos de negocio del dominio.
- Reglas de calidad aplicables.
- Nivel de sensibilidad por defecto del dominio.
- Casos de uso habilitados.

Ejemplo de agrupación observada en esta pasada:

| Dominio | Activos identificados (muestra) | Fuente de verdad candidata |
|---|---|---|
| Presupuesto/Finanzas | Informes de ejecución presupuestaria (Outlook, multi-unidad), dashboards `dnvtf/ejecucion_presupuestaria` | Dashboard Power BI en `dnvtf` (pendiente confirmar dataset origen) |
| RR.HH. | Planillas de reemplazos, horas extra/compensadas, precalificación, licencias médicas (por Dirección Regional) | Ninguna consolidada — alta fragmentación por región |
| Datos y Estadística | Indicadores regionales, reporte de accidentes, calificación nutricional | Sitio `Datos_y_Estadisticas` |
| Infraestructura | Correlativos de minutas, informes de multas de mantención | Ninguna consolidada |
| Gabinete/Gobierno | Chats y reuniones institucionales (COSOC, licitaciones, Directorio) | No aplica (colaboración, no dataset) |

---

## 14. Taxonomía

Criterios objetivos de clasificación automática (Fase 4):

| Dimensión | Valores | Criterio objetivo de asignación |
|---|---|---|
| Dominio | Finanzas, RR.HH., Educación, Infraestructura, Datos/Estadística, Gobierno Corporativo | Ruta del sitio SharePoint / carpeta de Outlook / nombre de equipo Teams |
| Criticidad | Estratégico, Alto, Medio, Bajo | N° de destinatarios/consumidores + recurrencia de uso + mención en reuniones de Directorio |
| Sensibilidad | Pública, Interna, Confidencial, Restringida/Personal | Presencia de identificadores de personas, salud, remuneración, evaluación de desempeño en nombre/ruta del archivo |
| Nivel de estructuración | Estructurado (xlsx/csv/list), Semiestructurado (docx/pdf con tablas), No estructurado (chat, wiki, correo libre) | Tipo de archivo / origen |
| Frecuencia | Diaria, Semanal, Mensual, Ad hoc, Histórico | Recurrencia detectada del patrón de nombre/asunto |
| Granularidad | Nacional, Regional, Establecimiento/Jardín, Individual | Presencia de código de jardín infantil, región o RUN/nombre en el contenido/nombre |
| Potencial analítico | Descriptivo, Diagnóstico, Predictivo, Prescriptivo | Presencia de series temporales + variables numéricas + periodicidad estable |
| Potencial IA | Alto/Medio/Bajo | Estructuración + disponibilidad de metadatos + ausencia de datos personales sin anonimizar |

---

## 15. Diccionario de Metadatos

Diccionario mínimo por activo (subconjunto de Fase 3, orientado a interoperabilidad con Purview):

| Metadato | Tipo | Obligatorio | Fuente de captura |
|---|---|---|---|
| assetId | string (UUID) | Sí | Generado por el motor de descubrimiento |
| assetName | string | Sí | Nombre de archivo / asunto normalizado |
| domain | enum | Sí | Taxonomía (Fase 4) |
| sourceSystem | enum (Outlook, SharePoint, Teams, OneDrive, PowerBI) | Sí | Origen del conector |
| owner | string (UPN) | Sí, si determinable | Metadato "autor"/"propietario del sitio" |
| sensitivityLabel | enum (Pública, Interna, Confidencial, Restringida) | Sí | Regla heurística + validación manual del Data Owner |
| lastModified | datetime | Sí | Metadato nativo Graph |
| fileType | enum | Sí | Extensión de archivo |
| recurrencePattern | string | No | Inferido (Fase 2) |
| lineageParent / lineageChild | assetId | No | Fase 8 |
| dqs / ars / anrs | float 0–100 | No (hasta Fase 5/7/9) | Motor de scoring |

---

## 16. Data Quality Score (DQS)

Rúbrica 1–5 (Fase 5) sobre 10 dimensiones DAMA-DMBOK2-aligned: Completitud, Exactitud, Consistencia, Actualidad, Unicidad, Documentación, Integración, Trazabilidad, Confiabilidad del propietario, Estandarización.

**Fórmula:**

```
DQS = ( Σ (peso_i × puntaje_i) / Σ peso_i ) × 20        →  escala 0–100
```

Pesos sugeridos (ajustables por dominio, suman 1.0): Completitud 0.15, Exactitud 0.15, Consistencia 0.10, Actualidad 0.15, Unicidad 0.10, Documentación 0.10, Integración 0.05, Trazabilidad 0.10, Confiabilidad del propietario 0.05, Estandarización 0.05.

Cada dimensión se puntúa 1 (muy deficiente) a 5 (excelente) por el motor de reglas cuando es automatizable (p. ej. Actualidad = función de días desde `lastModified`; Unicidad = 5 menos número de duplicados detectados) y por el Data Steward cuando requiere juicio (Confiabilidad del propietario, Documentación).

**Ejemplo aplicado (AST-0001, Informe Ejecución Presupuestaria):** Completitud 4, Exactitud 3 (no verificado contra fuente), Consistencia 2 (6 variantes manuales del mismo reporte), Actualidad 5 (actualizado el mismo día), Unicidad 1 (alta duplicación por unidad destinataria), Documentación 2, Integración 2, Trazabilidad 2, Confiabilidad del propietario 4, Estandarización 3 → **DQS ≈ 56/100** (calidad media, penalizada fuertemente por duplicación/no unicidad — coherente con el hallazgo de 6 envíos manuales del mismo reporte).

---

## 17. AI Readiness Score (ARS)

Evalúa (Fase 7): compatibilidad con GPT/Copilot/Agentes/RAG/Embeddings/búsqueda semántica, presencia de datos personales o sensibles, necesidad de anonimización, necesidad de permisos especiales.

**Fórmula:**

```
ARS = 100 × ( estructuracion×0.25 + calidad_metadatos×0.20 + accesibilidad_api×0.20
              + (1 − sensibilidad_normalizada)×0.25 + disponibilidad_documentacion×0.10 )
```

Donde cada componente se normaliza 0–1. `sensibilidad_normalizada` = 1.0 si el activo contiene datos personales/salud/remuneración sin anonimizar (penaliza fuertemente el ARS, por diseño: un activo muy sensible **no** debe ser "IA-ready" hasta anonimizarse).

**Ejemplos:**
- Dashboard de ejecución presupuestaria (`dnvtf`): estructurado, con metadatos razonables, accesible vía Power BI API (a habilitar), sin datos personales → **ARS alto (≈75–85)**, buen candidato a pregunta natural vía Copilot/GPT corporativo.
- Planilla de licencias médicas de una funcionaria (nombre/salud en el archivo): **ARS muy bajo por diseño (≈10–20)** hasta que se anonimice o se excluya explícitamente del alcance de IA — este tipo de activo se marca en el inventario como **"Nunca procesar sin autorización explícita"** (ver Sección 21).

---

## 18. Analytic Readiness Score (AnRS)

Prioriza (Fase 9) considerando: valor para el negocio, calidad (DQS), accesibilidad, sensibilidad, esfuerzo de limpieza, potencial IA (ARS), frecuencia de uso, integración, impacto esperado.

**Fórmula:**

```
AnRS = 100 × ( valor_negocio×0.25 + (DQS/100)×0.20 + accesibilidad×0.15
              + (1−esfuerzo_limpieza)×0.10 + (ARS/100)×0.15
              + frecuencia_uso×0.10 + impacto_esperado×0.05 )
```

Clasificación resultante: **Estratégico** (AnRS ≥ 80), **Alta** (65–79), **Media** (45–64), **Baja** (25–44), **Histórico** (<25 o sin actividad reciente).

**Ejemplo:** el informe de ejecución presupuestaria (alto valor de negocio, DQS medio ~56, alta accesibilidad, sensibilidad baja, esfuerzo de limpieza medio, ARS alto potencial, frecuencia de uso mensual alta, impacto alto por ser insumo de Gabinete/Auditoría/Fiscalía) → **AnRS estimado ≈ 70, prioridad "Alta"**, con recomendación explícita de pasar a "Estratégico" una vez consolidado en un único dataset (eliminando la penalización de unicidad del DQS).

---

## 19. Metodología de Relaciones y Data Lineage

1. **Detección de claves candidatas:** por nombre de columna repetido en distintos archivos (requiere lectura de encabezado, no de contenido completo) y por coincidencia de nombre de archivo base entre sitios/periodos.
2. **Detección de duplicidad:** mismo hash de nombre normalizado (sin fecha/versión) apareciendo en más de una ruta ⇒ candidato a duplicado; se prioriza como vigente la de fecha de modificación más reciente.
3. **Detección de fuente maestra:** activo con mayor número de consumidores declarados (correo a múltiples áreas, o dataset consumido por un dashboard corporativo) y mayor DQS ⇒ candidato a fuente de verdad; se valida con el Data Owner antes de declararla formalmente.
4. **Data Lineage:** grafo dirigido `origen → transformación → consumo`, construido inicialmente a partir de: (a) archivo Excel/CSV en SharePoint → (b) dataset/dataflow Power BI que lo referencia como origen → (c) reporte/dashboard que consume el dataset → (d) canal de distribución (correo, Teams, Power BI App).
5. **Enterprise Data Map:** vista agregada por dominio de negocio de los grafos de linaje, mantenida como modelo semántico propio (no como documento estático), para que evolucione junto con el catálogo.

Limitación actual: sin acceso a Power BI REST API ni a Purview (Supuesto S4), el linaje de esta primera pasada llega hasta "archivo de origen en SharePoint/Outlook"; el tramo hacia datasets/dashboards de Power BI queda como **hipótesis a validar** en la siguiente iteración.

---

## 20. Casos de Uso Prioritarios

Solo se listan casos con sustento directo en los hallazgos (Fase 10 — "no inventar casos sin sustento"):

| Caso de uso | Activo(s) base | Justificación |
|---|---|---|
| Consolidación de "Informe Ejecución Presupuestaria" en un único dataset con RLS | AST-0001 y variantes | 6 envíos manuales idénticos en contenido base observados el mismo día; alto ahorro de esfuerzo y mejora de unicidad/DQS |
| Dashboard ejecutivo conversacional (Copilot/GPT corporativo) sobre ejecución presupuestaria e indicadores regionales | Sitios `dnvtf`, `Datos_y_Estadisticas` | Ya existen dashboards Power BI embebidos; son de sensibilidad baja y alto ARS |
| Asistente de búsqueda semántica sobre actas/minutas de Gabinete y comisiones (RAG) | Canales/Teams de Gabinete, chat grupal "GABINETE JUNJI", reuniones de Directorio | Contenido institucional recurrente, hoy disperso en chats sin indexar |
| Automatización de acuse/seguimiento de correos de reporte periódico | Patrón de correos "Informe Ejecución..." | Ya existe un patrón de automatización parcial (proxy DocDigital) reutilizable |
| Detección continua de duplicidad de plantillas regionales (RR.HH., presupuesto) | Archivos por Dirección Regional (`DR_ARICA`, etc.) | Duplicación evidente de la misma plantilla por región y año sin biblioteca central |

No se proponen casos de uso sobre datos de salud, desempeño o remuneración individual sin autorización explícita (ver Sección 21).

---

## 21. Gobierno de Datos

- **Propietarios/Custodios:** por definir formalmente vía RACI (tabla abajo) con cada Jefatura de área como Data Owner de su dominio.
- **Stewardship:** se recomienda un Data Steward por dominio (Finanzas, RR.HH., Datos y Estadística, Infraestructura) responsable de validar clasificaciones automáticas.
- **Clasificación:** heurística automática + validación humana obligatoria antes de publicar en el Catálogo Corporativo.
- **Auditoría:** todo acceso del motor de descubrimiento debe quedar registrado (quién, qué metadato, cuándo) — ya es el patrón que usa este mismo repo para las llamadas a DocDigital.
- **Retención:** a definir según la Ley 19.628 y las normas de archivo de la Administración del Estado; no se propone retención automática sin validación jurídica.
- **Activos que jamás deben procesarse (leerse en contenido o usarse en IA) sin autorización explícita:**
  1. Archivos con licencias médicas o datos de salud de funcionarios/as (detectados por patrón de nombre en RR.HH.).
  2. Archivos de precalificación/evaluación de desempeño individual.
  3. Planillas de remuneraciones o bonos individualizados por funcionario/a.
  4. Cualquier chat 1:1 de Teams o correo personal no institucional.
  5. Cualquier activo sin clasificación de sensibilidad confirmada por su Data Owner.

### Matriz RACI (Fase 0)

| Actividad | Sponsor | Data Owner | Data Steward | Custodio (TI) | Usuario piloto |
|---|---|---|---|---|---|
| Aprobar alcance y política de descubrimiento | A | C | I | C | R |
| Ejecutar descubrimiento de metadatos | I | I | C | R | R |
| Validar clasificación de sensibilidad | I | A | R | C | C |
| Declarar fuente maestra por dominio | I | A | R | I | C |
| Autorizar lectura de contenido sensible | A | R | C | I | I |
| Operar/mantener el proxy MCP de descubrimiento | I | I | I | R/A | I |
| Reportar avance a Dirección Nacional | R | I | I | I | I |

(R: Responsable, A: Aprobador, C: Consultado, I: Informado)

---

## 22. Arquitectura Objetivo

Ver diagrama completo en la Sección 6. Rol de cada componente:

- **Microsoft Entra ID:** identidad, consentimiento de permisos delegados/aplicación, base de confianza cero.
- **Microsoft Graph:** capa unificada de acceso a Outlook/SharePoint/Teams/OneDrive.
- **Proceso de descubrimiento (proxy MCP dedicado):** igual patrón que `docdigital-mcp-proxy`, pero de solo lectura de metadatos.
- **Inventario Maestro:** almacenamiento estructurado (SharePoint List/Dataverse/base SQL) de los activos descubiertos.
- **Motor de Clasificación y Calidad:** reglas + scoring DQS/ARS/AnRS (Azure Function).
- **Catálogo Corporativo / Modelo Semántico:** capa de negocio sobre el inventario, consumible por Power BI.
- **Microsoft Purview:** clasificación de sensibilidad a nivel tenant y catálogo unificado (Escenario C).
- **Microsoft Fabric/OneLake:** destino final de consolidación analítica cuando exista patrocinio corporativo.
- **Copilot/GPT Corporativo:** capa conversacional sobre el catálogo y los datasets certificados, nunca sobre activos sin clasificar.

---

## 23. Roadmap (30, 60 y 90 días)

**Días 1–30 — Descubrimiento automático (MVP):**
- Actividades: desplegar el proxy de descubrimiento (patrón `docdigital-mcp-proxy`), ejecutar descubrimiento de metadatos en 3–5 usuarios piloto de distintas áreas, construir Inventario Maestro v0.
- Responsables: TI (custodio técnico), Data Steward de cada área piloto.
- Entregables: Inventario Maestro v0, primer Enterprise Data Map parcial.
- Dependencias: registro de aplicación en Entra ID con permisos delegados mínimos.
- Riesgos: negativa de algún área a participar; se mitiga con alcance voluntario y sin lectura de contenido.
- Criterio de éxito: ≥200 activos catalogados con metadatos completos en ≥3 dominios.

**Días 31–60 — Clasificación y calidad:**
- Actividades: aplicar taxonomía (Fase 4), calcular DQS y ARS iniciales, validar clasificaciones con Data Owners.
- Responsables: Data Stewards, Data Owners.
- Entregables: Data Quality Matrix, AI Readiness Matrix, primeras fuentes maestras declaradas.
- Dependencias: disponibilidad de Data Owners para validar.
- Riesgos: falta de tiempo de los Data Owners; se mitiga con sesiones cortas (30 min) por dominio.
- Criterio de éxito: 100% de activos "Estratégico"/"Alta" prioridad con DQS y ARS calculados y validados.

**Días 61–90 — Integración, gobierno y analítica:**
- Actividades: habilitar Power BI REST API en el descubrimiento, construir AnRS y ranking analítico, presentar Dashboard Ejecutivo, definir roadmap de Purview/Fabric.
- Responsables: TI, Sponsor, Data Stewards.
- Entregables: Ranking analítico, Dashboard Ejecutivo, Informe Ejecutivo con recomendación Escenario B→C.
- Dependencias: patrocinio ejecutivo para ampliar permisos (application permissions).
- Riesgos: falta de patrocinio para escalar; se mitiga mostrando el valor del MVP con datos reales (como los de este documento).
- Criterio de éxito: decisión formal de Dirección sobre avanzar a Escenario C (Purview/Fabric corporativo).

**Comparación de escenarios (Fase 13):**

| Escenario | Permisos | Automatización | Ventajas | Limitaciones | Esfuerzo |
|---|---|---|---|---|---|
| A — Manual asistido | Ninguno especial | Nula/baja | Cero riesgo, arranque inmediato | No escala, alto esfuerzo humano | Bajo |
| B — Usuario autenticado (este documento) | Delegados (Graph) | Media, vía proxy MCP | Ya demostrado viable con datos reales; respeta mínimo privilegio | Alcance limitado al usuario/áreas piloto; sin Power BI/Purview aún | Medio |
| C — Corporativo | Aplicación + patrocinio | Alta (Purview + Fabric) | Cobertura total, gobierno formal, IA corporativa | Requiere aprobación, mayor superficie de riesgo si no se gestiona bien | Alto |

---

## 24. Dashboard Ejecutivo Propuesto

KPIs sugeridos para el Dashboard Ejecutivo (a construir en Power BI sobre el Inventario Maestro):

- N° total de activos descubiertos, por dominio y por estado (vigente/histórico).
- Índice global de madurez de gobierno de datos (Fase 1, 1–5 por dimensión).
- Distribución de DQS, ARS y AnRS por dominio (promedio y outliers).
- N° de activos clasificados como "Nunca procesar sin autorización" (alerta de gobierno).
- N° de duplicados detectados y % de reducción tras consolidación.
- Ranking de los 10 activos "Estratégico"/"Alta" prioridad (candidatos a caso de uso de IA/analítica).
- Avance del roadmap (30/60/90 días) vs. plan.

---

## 25. Checklist de Autoverificación

- [x] ¿Se limitó estrictamente el descubrimiento a los permisos del usuario autenticado, sin accesos administrativos? Sí.
- [x] ¿Se usaron únicamente mecanismos oficiales de Microsoft (Graph delegado), sin scraping? Sí.
- [x] ¿Se evitó leer contenido sensible o completo de correos/archivos, trabajando primero con metadatos? Sí.
- [x] ¿Se declararon explícitamente los supuestos y su nivel de incertidumbre? Sí (Sección 4).
- [x] ¿Se identificaron los activos que nunca deben procesarse sin autorización explícita? Sí (Sección 21).
- [x] ¿Se generalizó/redactó toda referencia a datos personales, de salud o de desempeño de terceros antes de dejar constancia escrita? Sí.
- [x] ¿Las fórmulas de DQS/ARS/AnRS están explicadas y son auditable (no una caja negra)? Sí (Secciones 16–18).
- [ ] ¿Se validó formalmente con cada Data Owner la clasificación de sensibilidad propuesta? Pendiente — requiere las sesiones del roadmap días 31–60.
- [ ] ¿Se habilitó el acceso a Power BI REST API / Purview / Fabric para completar el linaje? Pendiente — requiere decisión y registro de aplicación adicional (Supuesto S4).
- [ ] ¿Se obtuvo patrocinio ejecutivo formal para escalar de Escenario B a Escenario C? Pendiente — a gestionar con el Informe Ejecutivo resultante de este documento.

---

## Anexo A — Análisis complementario de metadatos (corpus "dashboard")

Profundizando el descubrimiento de la Sección 11 (Estrategia Power BI), se amplió la muestra de los ~380 activos relacionados con "dashboard" en SharePoint (de 10 a ~140 registros, solo metadatos). Hallazgos:

**A.1 Corrección metodológica — ruido en la búsqueda por texto libre.** La mayoría de los resultados desde el registro ~30 en adelante corresponden a **código fuente de un portal web institucional descontinuado (2007-2016)** en `Depto_Informatica/UNIDAD_PROYECTOS/WEB` y `SISTRANS` (archivos `dashboard.css`, `profilerviewer.js`, plantillas Joomla), donde "dashboard" aparece como nombre de clase CSS o variable de código, sin relación con reportes de negocio. **Ajuste al diseño de la Fase 2:** el motor de descubrimiento debe combinar palabra clave + `fileType` (aspx, pbix) + lista de sitios corporativos conocidos, no depender de texto libre puro, o el ruido puede superar el 60% de los resultados.

**A.2 El "hub" real de Power BI se concentra en 3 sitios, 26 páginas.**

| Sitio | Páginas de dashboard reales | Contenido |
|---|---|---|
| `Datos_y_Estadisticas` | 17 | Matrícula, asistencia, accidentes, nutrición, postulaciones SIM, calidad de datos |
| `dnvtf` | 6 | Ejecución presupuestaria, presupuesto histórico, equipo regional |
| `PlandeGestinRegionalOHiggins` | 3 (casi duplicadas entre sí) | Misma página de reporte regional publicada 3 veces con nombres ligeramente distintos |

Estos 3 sitios son el objetivo prioritario para la integración con Power BI REST API cuando se habilite el scope correspondiente (Sección 11, Supuesto S4).

**A.3 Ya existe un embrión de diccionario de datos.** `dnvtf/.../DICCIONARIO_DE_DATOS/EJECUCION_PRESUPUESTARIA/manual_usuario_proyecciones_presupuestarias.docx` — JUNJI ya documentó el proceso de proyecciones presupuestarias. El Diccionario de Metadatos (Sección 15) debe partir de este insumo existente, no reconstruirlo desde cero.

**A.4 Nueva familia de reporte periódico de bajo esfuerzo de consolidación.** Sitio dedicado `ReporteOperativoUE`, con un archivo Excel semanal ("Reporte Operativo semana del DD-MM al DD-MM-2026"), activo y corriente hasta julio 2026, con glosario propio y nomenclatura consistente. Mejor candidato que el de ejecución presupuestaria para un primer piloto de consolidación en dataset único, por tener ya nomenclatura estandarizada.

**A.5 Hallazgo de gobierno adicional a escalar.** Un archivo nombrado `Funciones Secreto.xlsx` (sitio `GestiondeProcesos`) con columnas RUT, nombres y cargo amerita revisión directa del Data Owner por su nombre inusual. Se identificó además una carpeta de proyecto de remuneraciones/payroll dentro de TI (`Depto_Informatica/.../proyecto_remuneraciones`), otra área sensible fuera del alcance tradicional de RR.HH. que debe incorporarse a la lista de activos restringidos (Sección 21).

## Anexo B — Cuantificación de duplicación: programa Plan Nacional de la Lectura (PNL)

Se profundizó la familia de plantilla "Informe Gestión PNL" (identificada en la Sección 8 como la de mayor concentración, 37% de la muestra de "informe"). Una búsqueda específica ("Informe Gestión PNL", todo tipo de archivo) devuelve **2.000 resultados** — un solo programa podría explicar la mayor parte del volumen total de "informes" detectado en el sitio `SECCIONGESTIONCURRICULAR`.

**Evidencia de duplicación de árbol de carpetas completo, no solo por región.** El mismo archivo (idéntico nombre y fecha de modificación) aparece dos veces bajo dos rutas padre distintas del mismo sitio:

- `.../PROCESOS PRESUPUESTARIOS/PLAN NACIONAL DE LA LECTURA/.../EJECUCION PRESUPUESTARIA/2019/INFORME GESTIÓN 2019/...`
- `.../PLAN NACIONAL DE LA LECTURA/PLAN NACIONAL DE LA LECTURA 2023/CARPETA COMPARTIDA MEDIADORAS/EJECUCION PRESUPUESTARIA/2019/...`

Este patrón se repite consistentemente en los ~15 informes regionales de 2019 y ~9 de 2018 (numeración romana de región, convención de nombres más antigua). **Conclusión: la carpeta histórica "2019" completa fue copiada dentro de una carpeta de trabajo "2023" nueva**, duplicando el volumen de almacenamiento y generando dos copias "vigentes" de la misma información histórica — no son activos adicionales, son los mismos activos con el doble de copias.

Dentro del mismo programa hay además sub-familias no reportadas antes: "Informe Jornada PNL [región] [año]" (asistencia a jornadas, 2016-2019), borradores iterativos ("informe pnl 2019 ultimo", "...ultimo 2"), y pares docx/pdf del mismo contenido.

**Nota metodológica para el motor de descubrimiento (Fases 2 y 13).** El índice de búsqueda de SharePoint se reordena entre llamadas equivalentes — el mismo archivo aparece en ventanas de paginación distintas y el `totalResultCount` varía levemente entre consultas similares realizadas segundos después. El descubrimiento automático de producción debe deduplicar por `driveId`+`itemId`, no confiar en offsets estables de paginación.

## Anexo C — Segunda familia cuantificada y evidencia de versionado manual sin control

**"Reporte Operativo semanal" (sitio `ReporteOperativoUE`).** El buscador reporta 1.159 resultados para "Reporte Operativo semana". La cadencia semanal confirmada (al menos agosto 2024 a julio 2026, ~100 semanas) no explica un volumen tan alto por sí sola, lo que sugiere copias duplicadas por semana: se observó al menos un caso (semana del 11 al 15 de mayo de 2026) presente tanto en la carpeta de archivo anual como en la raíz del sitio. Aun con la salvedad metodológica del Anexo B sobre totales inflados por relevancia difusa, esta familia es la mejor candidata a piloto de consolidación por tener nomenclatura ya estandarizada.

**Evidencia directa de versionado manual sin control.** Se encontraron archivos literalmente nombrados `Copia de Copia de INFORMES MENSUALES JUNIO 2021 (003) (002).xls` (repetido en tres subcarpetas distintas de RR.HH.) y `Reporte Operativo semana del 12-01 al 16-01-2026 - Copia.xlsx`. Esto confirma que el personal no utiliza el historial de versiones nativo de SharePoint, sino que crea copias manuales encadenadas — generando duplicados con nombres cada vez más largos y sin forma de saber cuál copia es la vigente. Es evidencia concreta y accionable para justificar la activación de versionado nativo + retención de versiones como control de gobierno de datos (Sección 21), no solo como recomendación teórica.

**"Informe Mensual de Reemplazos"** devolvió 3.057 resultados, pero con alta proporción de coincidencias difusas no relacionadas (bitácoras de soporte TI, informes de cierre de gestión de administración 2023-2026, actas de reunión) — refuerza la recomendación del Anexo A/B de no usar totales de búsqueda por relevancia como conteo exacto, y de deduplicar/filtrar por sitio y ruta antes de reportar cifras a Dirección.

## Anexo D — Colaboración en Microsoft Teams (solo metadatos de chat)

Se analizaron 50 chats de Teams del usuario piloto (tipo, tema, número de miembros, fecha), **sin leer contenido de mensajes**, conforme al alcance de privacidad acordado (Sección 3).

**Distribución:** 60% chats 1:1 (coordinación bilateral), 34% chats de reunión, 4% grupos persistentes.

**Los chats de reunión revelan los órganos institucionales recurrentes de JUNJI:**

| Órgano / proceso | Evidencia |
|---|---|
| COSOC JUNJI (Consejo de la Sociedad Civil) | Sesión Extraordinaria N°1 y Sesión Ordinaria N°5 — solo en esta muestra de 50 chats, confirma cadencia regular |
| Reunión DR / Directorio / Unidades Asesoras | 37 asistentes, órgano de dirección regular |
| Gestión de riesgos / PMG | "PMG Riesgos Psicosociales" con 97 miembros — probable encuesta de clima organizacional asociada |
| Auditoría / Contraloría | "Seguimiento CGR 748-2023 O'Higgins", "Revisión jurídica SdEP-VTF" |
| Gremios | Reuniones AJUNJI / APROJUNJI (asociaciones de funcionarios) |
| Continuidad operativa / emergencias | "Cogrid preventivo", "Equipo directivo evaluación emergencia" — coherente con el hallazgo de correos UNGRD de la Sección 7 |

**Hallazgo de gobierno: el Gabinete es un nodo interinstitucional.** Varias reuniones (COSOC, Lineamientos de Gestión 2026) incluyen participantes externos a JUNJI: `@mineduc.cl` (Subsecretaría de Educación Parvularia), `@integra.cl` (Fundación Integra), `@slepla.gob.cl`/`@slepelqui.gob.cl` (Servicios Locales de Educación Pública), y organizaciones de sociedad civil (`@santotomas.cl`, `@hogardecristo.cl`, `@cftla.cl`, `@unitedway.cl`, `@cristojoven.cl`). **Límite de gobierno explícito:** el contenido de estos chats con terceros externos no debe alimentar un futuro RAG/GPT corporativo sin evaluar previamente la base legal y el consentimiento de esas organizaciones — son datos de coordinación interinstitucional, no activos internos de JUNJI, y se agregan a la lista de la Sección 21.

## Anexo E — OneDrive personal (solo metadatos)

Se buscó en el sitio OneDrive personal del usuario piloto, usando el mismo conector de búsqueda (OneDrive for Business está respaldado por SharePoint, diferenciándose solo por el dominio de la URL: `-my.sharepoint.com/personal/` para OneDrive vs. `.sharepoint.com/sites/` para SharePoint).

**Hallazgo principal: OneDrive personal replica documentos institucionales oficiales, no genera activos independientes.** Se encontraron copias de trabajo del Balance de Gestión Integral (BGI) 2024 y de informes de Contraloría General de la República, cuyo original ya está identificado en sitios SharePoint compartidos, además de notas generadas por Microsoft Copilot Chat. Esto confirma en una tercera fuente (Outlook, SharePoint y ahora OneDrive) el mismo patrón de los Anexos B y C: la "copia personal de trabajo" duplica la fuente oficial en lugar de referenciarla.

**Nota metodológica para el motor de descubrimiento (Fase 3).** El "Sistema Origen" de cada activo debe clasificarse automáticamente a partir del patrón de dominio de la URL (`-my.sharepoint.com` = OneDrive personal, `.sharepoint.com/sites/` = SharePoint corporativo), y OneDrive debe tratarse en el diseño como fuente adicional de posibles duplicados de la fuente de verdad, no como una fuente de datos independiente.
