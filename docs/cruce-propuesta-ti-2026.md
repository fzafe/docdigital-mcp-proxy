# Cruce: propuesta de Sección TI (Víctor Campos) vs. arquitectura "cerebro-pulpo"

Documento corto de trabajo — julio 2026, para el Comité de IA.
Compara la "Arquitectura Institucional de Inteligencia Artificial" presentada por Víctor Campos (Encargado Sección TI) con lo ya versionado en `estrategia-ia-junji-2026.md` y `junji-2050-documento-maestro.md`, y propone una arquitectura reconciliada.

---

## 1. Las dos propuestas, lado a lado

| Capa | Propuesta Sección TI (Víctor) | Arquitectura ya versionada |
|---|---|---|
| Interfaz de usuario | Portal IA institucional, Open WebUI, Outlook 365, Teams, APIs | ChatGPT (Custom GPT + Actions) como cerebro operativo |
| Constructor de agentes | Dify (apps/RAG) + n8n (workflows) | Módulos de código (`examples/hub-agentes`), Claude como herramienta de programación |
| Enrutador de modelos | LiteLLM (unified LLM gateway): costo, latencia, balanceo | Gateway MCP propio: auth, políticas de acceso, auditoría |
| Acceso a sistemas institucionales | "APIs institucionales" (sin detalle) | MCP como protocolo de herramientas/recursos (ya en producción con DocDigital) |
| Organización de agentes | Por departamento: RRHH, Jurídico, Compras, Finanzas, TI, Atención Ciudadana | Por proceso end-to-end: Oferta Programática/Ex Ante, Aseguramiento de Calidad, Gestión de Personas, Comunicaciones, Cobertura, Gestión Financiera, Gestión Territorial |
| Proveedores de modelo | OpenAI GPT-5 y Claude vía **API** (pago por uso) | ChatGPT Teams y Claude Team Standard vía **licencias por asiento** (ya cotizadas, Compra Ágil) |
| Gobernanza | Entra ID/SSO, gobernanza de IA, seguridad de datos, auditoría, cumplimiento | Comité de IA, Política Institucional (5 ejes), "humano en el loop" |

## 2. Dónde convergen (no hay que decidir nada, ya están alineadas)

- **Un solo gateway, gobernado centralmente, con varios modelos detrás.** Es la misma tesis del "cerebro-pulpo" en las dos propuestas — que Víctor haya llegado a esto de forma independiente confirma que el diseño va por buen camino.
- **El panel de gobernanza de Víctor (Entra ID, cifrado, auditoría, cumplimiento) es la implementación técnica concreta** de las salvaguardas que ya escribimos en la sección 6 de `estrategia-ia-junji-2026.md` — se puede adoptar prácticamente tal cual, cruzado con Microsoft Purview (`version-100-microsoft.md`).

## 3. Dónde divergen — decisiones que le corresponden al Comité

### 3.1 LiteLLM y MCP no son lo mismo — probablemente hacen falta los dos
LiteLLM resuelve "qué modelo responde" (costo/latencia/balanceo entre proveedores). MCP resuelve "qué herramientas y datos institucionales puede tocar un agente" (DocDigital, GESDEP, ERP, procedimientos) — ya en producción. No son alternativas, son capas distintas y complementarias.
**Propuesta:** mantener MCP como capa de acceso a sistemas (ya construida, cero costo adicional) y evaluar LiteLLM como capa de enrutamiento de modelos encima, en vez de reemplazar una por otra.

### 3.2 Agentes por departamento vs. por proceso
La propuesta de TI vuelve a organizar agentes por función (RRHH, Jurídico, Compras, Finanzas, TI, Atención Ciudadana), el mismo patrón que el diagnóstico de 2012 y 2026 señala como causa de insularidad (ver `junji-2050-documento-maestro.md`, sección 3.4).
**Propuesta:** usar el constructor de Víctor (Dify/n8n) para *implementar* los agentes, pero poblarlos según los procesos end-to-end ya definidos, no según el organigrama. **Compras** es un proceso legítimo que no estaba en nuestra lista y conviene sumar (justo lo vivimos con la compra de las licencias de IA).

### 3.3 Modelo de facturación: asiento vs. API
La propuesta de TI llama a los modelos por **API** (pago por token). Lo que ya está en trámite con Víctor (Compra Ágil, aprox. 21 licencias) es **por asiento** (ChatGPT Teams / Claude Team Standard). Son dos mecanismos de compra y de control de costo distintos.
**Propuesta:** definir explícitamente cuál se usa para qué — por ejemplo, asientos para el uso conversacional de funcionarios (ya en trámite), y API solo si se autohospeda Dify/n8n con agentes de alto volumen que lo justifiquen — antes de comprometer presupuesto en ambas vías en paralelo.

### 3.4 Autohospedar Dify + n8n tiene un costo operativo que el diagrama no muestra
Dify y n8n son herramientas reales y de código abierto, pero autohospedarlas implica servidores, parches de seguridad y mantención continua — un costo de operación que hoy no existe (el gateway MCP actual es un solo servicio Node pequeño).
**Propuesta:** pedirle a TI una estimación de horas/persona y de infraestructura para sostener Dify + n8n en el tiempo, antes de decidir si reemplazan o complementan el enfoque actual.

### 3.5 Falta lo específico de JUNJI
El diagrama de TI trata "seguridad de datos" de forma genérica; no aparece la categoría especial de datos de niños y niñas ni el principio de "humano en el loop" para actos con efecto jurídico (sección 6 de `estrategia-ia-junji-2026.md`).
**Propuesta:** que esas dos salvaguardas queden explícitas en cualquier versión final de la arquitectura, vengan de TI o de este documento.

## 4. Arquitectura reconciliada (propuesta de este documento)

```
Funcionarios / Directivos / Sistemas
        │
Portal IA · Custom GPT (ChatGPT) · Teams · Outlook
        │
Dify / n8n (constructor de agentes) ── agentes por PROCESO, no por departamento
        │
   ┌────┴────┐
   MCP        LiteLLM
(herramientas/datos   (enrutamiento entre
 institucionales,      modelos: costo/latencia)
 ya en producción)
        │
ChatGPT (asiento) · Claude (asiento, equipo técnico) · [API solo si se justifica]
        │
Gobernanza: Comité de IA · Política Institucional (5 ejes) · Entra ID · Purview · auditoría
```

## 5. Para la reunión con Víctor / el Comité

1. Validar 3.1-3.5 directamente con Víctor — son preguntas técnicas, no objeciones a su trabajo.
2. Decidir el modelo de facturación (3.3) antes de que avance cualquier compra adicional.
3. Definir si Dify/n8n se adoptan como capa de construcción de agentes sobre el MCP ya existente, o si compiten con él.
4. Sumar "Compras" a la lista de procesos candidatos a agente.
