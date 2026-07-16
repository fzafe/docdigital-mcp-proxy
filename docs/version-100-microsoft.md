# Versión 100% Microsoft de la arquitectura "cerebro-pulpo"

> **Estado: evaluada, no elegida.** La decisión vigente (julio 2026, ver `estrategia-ia-junji-2026.md`, sección 3.2) es usar ChatGPT como cerebro operativo y Claude como herramienta del equipo técnico para programar — no Copilot Studio ni Azure AI Foundry como orquestador. Este documento queda como referencia por si esa decisión se revisita más adelante.

Complementa [`estrategia-ia-junji-2026.md`](./estrategia-ia-junji-2026.md). Mismo concepto (núcleo
de orquestación + agentes departamentales), mismo Comité y misma hoja de ruta — lo que cambia acá
es **con qué producto se construye cada pieza**, usando solo tecnología ya licenciada o nativa de
Microsoft 365 / Azure, sin sumar un proveedor SaaS nuevo (Notion incluido).

Es la opción a evaluar si el criterio de decisión es "un solo contrato, una sola revisión de
protección de datos, un solo proveedor que audita el Estado" en vez de "el mejor modelo para cada
tarea" (que es lo que ofrece la versión con ChatGPT + Claude del documento principal).

## 1. Mapeo pieza por pieza

| Pieza de la arquitectura | Versión genérica (doc. principal) | Versión 100% Microsoft |
|---|---|---|
| Cerebro / orquestador | Gateway MCP propio (`examples/hub-agentes`) | **Microsoft Copilot Studio** (agentes con orquestación generativa) — y, para casos más complejos de multiagente, **Azure AI Foundry Agent Service** |
| Protocolo entre cerebro y agentes | MCP | El mismo **MCP**: Copilot Studio y Foundry Agent Service lo consumen de forma nativa (asistente de incorporación MCP / "bring your own MCP server") |
| Agentes departamentales | Módulos Node.js registrando tools | **Agentes de Copilot Studio**, uno por departamento, publicados en Teams/Outlook |
| Fuente de datos de cada agente | Llamadas a API propias | **Conectores de Microsoft Graph** (SharePoint, Dataverse, Outlook) con autenticación *on-behalf-of*: el agente solo ve lo que el usuario que pregunta ya tiene permiso de ver — esto resuelve gran parte del control de acceso "gratis" |
| Interfaz para funcionarios | Custom GPT / cliente MCP de Claude | **Microsoft 365 Copilot Chat** + los mismos agentes de Copilot Studio publicados como app de Teams |
| Conector a DocDigital (sistema externo, no-Microsoft) | `index.js` (Express + MCP SDK) | Sigue siendo **código propio** — vía Power Automate/Azure Logic Apps como "Action Tool", o el mismo `index.js` expuesto como conector MCP a Copilot Studio. DocDigital es una API del Estado ajena a Microsoft: ningún proveedor te libra de mantener este conector |
| Tablero de reportes diarios (idea de Aldo) | Notion | **Microsoft Loop** + **Listas de SharePoint** + **Power BI** |
| Identidad | — | **Microsoft Entra ID** (la misma que ya usan para correo y SharePoint) |
| Gobernanza de datos de párvulos | Reglas definidas "a mano" en el gateway | **Microsoft Purview**: etiquetas de sensibilidad + prevención de pérdida de datos (DLP) aplicadas sobre SharePoint, Loop, Teams y Power BI. Los agentes de Copilot respetan estas etiquetas automáticamente — es la implementación real, no solo la política escrita, de la salvaguarda "sin microdatos de párvulos sin aprobación" |
| Auditoría | Log propio en el gateway | **Microsoft Purview Audit** + centro de administración de Power Platform (consumo y actividad por agente) |

## 2. Qué gana y qué pierde esta versión

**Gana:**
- Cero proveedor nuevo, cero contrato nuevo, cero revisión de protección de datos adicional — todo corre en el tenant de Microsoft que JUNJI ya tiene aprobado.
- Control de acceso más simple de auditar: como los agentes usan autenticación *on-behalf-of* contra SharePoint/Dataverse, en gran medida heredan los permisos que ya existen, en vez de que el Comité tenga que definir esos permisos desde cero en un gateway propio.
- Menos código propio que mantener a largo plazo (Copilot Studio es de bajo código; el gateway de `examples/hub-agentes` requiere alguien que sepa Node.js).

**Pierde / hay que tenerlo claro antes de decidir:**
- **No es gratis.** Copilot Studio trae 25.000 mensajes/mes incluidos por tenant y luego se cobra por consumo (aprox. USD 0,01 por mensaje, o paquetes de USD 200 por 25.000 mensajes/mes); si además quieren Microsoft 365 Copilot dentro de Word/Excel/Teams para cada funcionario, ese es un add-on de licencia por usuario (~USD 30/usuario/mes) — hay que dimensionarlo con el volumen real esperado, no asumir que "viene incluido" porque ya pagan M365.
- **Un solo proveedor de modelos.** Se pierde la comparación/competencia entre modelos que da usar ChatGPT y Claude a la vez; quedan atados a los modelos que Microsoft ofrezca dentro de Foundry/Copilot Studio.
- El gateway MCP que ya construimos no se descarta: **se reutiliza tal cual**, solo se conecta como un "MCP server" más dentro de Copilot Studio en vez de (o además de) conectarse a un Custom GPT o a Claude. Es decir, no hay que elegir entre las dos versiones el día uno — la versión genérica y la versión Microsoft pueden convivir sobre el mismo gateway mientras se decide.

## 3. Recomendación práctica

No es una decisión "todo o nada". El camino de menor riesgo es: mantener el gateway MCP ya construido como pieza central (documento principal), y sumar Copilot Studio como un tercer "cerebro" que lo consume — igual que ChatGPT y Claude — mientras el Comité de IA evalúa, con datos reales de uso, si conviene migrar todo a Foundry/Copilot Studio o mantener la combinación de modelos.
