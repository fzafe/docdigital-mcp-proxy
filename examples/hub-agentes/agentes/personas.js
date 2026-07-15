import { z } from "zod";

// Agente departamental: Departamento de Gestion y Desarrollo de Personas
//
// Deliberadamente NO expone datos individuales de funcionarios ni de parvulos: solo
// resume el estado de tramites de alto volumen (ej. licencias medicas), respetando la
// salvaguarda de "sin microdatos personales sin aprobacion de Gobernanza de Datos"
// descrita en docs/estrategia-ia-junji-2026.md.

export function registerTools(server, { onCall }) {
  server.tool(
    "personas_estado_tramites_licencias",
    "Entrega un resumen agregado (no individualizado) del estado de tramitacion de licencias medicas por region.",
    { region: z.string().optional().describe("Nombre de la region a consultar (opcional, por defecto todas)") },
    async ({ region }) => {
      onCall("personas_estado_tramites_licencias");
      // Placeholder: en produccion consulta el ERP institucional, agregando por region
      // y nunca devolviendo el detalle de una persona especifica.
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { region: region || "todas", en_tramite: 0, resueltas_este_mes: 0 },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
