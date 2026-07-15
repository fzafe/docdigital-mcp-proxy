import { z } from "zod";

// Agente departamental: Departamento de Planificacion
// (Seccion de Gestion Estrategica / Oficina de Gestion de Procesos)
//
// En una implementacion real, `consultarProcedimiento` buscaria en el repositorio de
// manuales de procedimiento (intranet/SharePoint) en vez de en este arreglo de ejemplo,
// y `listarIndicadores` consultaria el sistema de control de gestion institucional.

const PROCEDIMIENTOS_DEMO = [
  {
    codigo: "PR_PL0001",
    nombre: "Formulacion, Estructura y Control de Documentos Procedimentales",
    unidad: "Oficina de Gestion de Procesos",
  },
  {
    codigo: "PR-SAF-004",
    nombre: "Procedimientos de Contabilidad",
    unidad: "Departamento de Recursos Financieros",
  },
];

export function registerTools(server, { onCall }) {
  server.tool(
    "planificacion_consultar_procedimiento",
    "Busca el manual de procedimiento vigente de JUNJI que coincide con una palabra clave (por nombre o unidad responsable).",
    { palabra_clave: z.string().describe("Texto a buscar en el nombre o unidad del procedimiento") },
    async ({ palabra_clave }) => {
      onCall("planificacion_consultar_procedimiento");
      const q = palabra_clave.toLowerCase();
      const resultados = PROCEDIMIENTOS_DEMO.filter(
        (p) => p.nombre.toLowerCase().includes(q) || p.unidad.toLowerCase().includes(q)
      );
      return { content: [{ type: "text", text: JSON.stringify(resultados, null, 2) }] };
    }
  );

  server.tool(
    "planificacion_listar_indicadores_pendientes",
    "Lista los indicadores de gestion institucional que estan pendientes de actualizacion este periodo.",
    {},
    async () => {
      onCall("planificacion_listar_indicadores_pendientes");
      // Placeholder: en produccion consulta el sistema de control de gestion real.
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              [{ indicador: "Cobertura matricula regional", estado: "pendiente de cierre mensual" }],
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
