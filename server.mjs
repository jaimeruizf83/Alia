import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;
const ANALYSIS_MODEL = process.env.OPENAI_ANALYSIS_MODEL || 'gpt-5.6-luna';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > maxBytes) {
        reject(new Error('Payload demasiado grande.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function hashUser(value = 'alia-local-user') {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function transcriptionPrompt(meta = {}) {
  const focus = Array.isArray(meta.focus) ? meta.focus.join(', ') : '';
  return [
    'Conversación organizacional en español de Colombia.',
    meta.client ? `Organización o cliente: ${meta.client}.` : '',
    meta.context ? `Contexto: ${meta.context}.` : '',
    focus ? `Vocabulario probable: ${focus}.` : '',
    'Transcribe literalmente, sin resumir ni interpretar.'
  ].filter(Boolean).join(' ');
}

async function createTranscriptionToken(req, res) {
  if (!process.env.OPENAI_API_KEY) {
    return json(res, 503, { error: 'La API de OpenAI no está configurada en el servidor.', code: 'NO_API_KEY' });
  }

  try {
    const raw = await readBody(req);
    const meta = raw ? JSON.parse(raw) : {};
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': hashUser(meta.userId)
      },
      body: JSON.stringify({
        session: {
          type: 'transcription',
          audio: {
            input: {
              transcription: {
                model: 'gpt-live-transcribe',
                prompt: transcriptionPrompt(meta),
                languages: ['es'],
                delay: 'low'
              },
              turn_detection: {
                type: 'server_vad',
                create_response: false,
                interrupt_response: false,
                silence_duration_ms: 900,
                prefix_padding_ms: 300
              }
            }
          }
        }
      })
    });

    const text = await response.text();
    res.writeHead(response.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(text);
  } catch (error) {
    console.error('transcription-token', error);
    json(res, 500, { error: 'No fue posible crear la sesión de escucha.' });
  }
}

const insightSchema = {
  type: 'object',
  properties: {
    intervene: { type: 'boolean' },
    priority: { type: 'string', enum: ['baja', 'media', 'alta', 'critica'] },
    type: { type: 'string', enum: ['patron', 'contradiccion', 'pregunta', 'conexion', 'acuerdo', 'riesgo', 'oportunidad', 'silencio'] },
    title: { type: 'string' },
    whisper: { type: 'string' },
    question: { type: 'string' },
    evidence: { type: 'string' },
    rationale: { type: 'string' },
    scores: {
      type: 'object',
      properties: {
        comunicacion: { type: 'integer' },
        liderazgo: { type: 'integer' },
        confianza: { type: 'integer' },
        reconocimiento: { type: 'integer' },
        carga: { type: 'integer' },
        acuerdos: { type: 'integer' }
      },
      required: ['comunicacion','liderazgo','confianza','reconocimiento','carga','acuerdos'],
      additionalProperties: false
    }
  },
  required: ['intervene','priority','type','title','whisper','question','evidence','rationale','scores'],
  additionalProperties: false
};

function analysisInstructions(meta = {}) {
  const modeRules = {
    diagnostico: 'Prioriza comprensión, patrones, causas, contradicciones y preguntas de profundización. Evita saltar a soluciones.',
    taller: 'Prioriza participación, aprendizaje, energía, comprensión y preguntas generativas. Señala cuándo una actividad se desconecta del objetivo.',
    reunion: 'Prioriza decisiones, ambigüedades, acuerdos, responsables, bloqueos, conversaciones pendientes y próximos pasos.',
    comercial: 'Prioriza necesidad, dolor, impacto, urgencia, criterio de decisión, objeciones, valor y siguiente paso.'
  };
  const cadenceThreshold = {
    selectiva: 'Intervén únicamente con evidencia clara y alto valor. En caso de duda, intervene=false.',
    equilibrada: 'Intervén ante señales claras que puedan mejorar significativamente la siguiente pregunta o decisión.',
    activa: 'Puedes intervenir con señales de valor medio o alto, evitando comentarios obvios o repetitivos.'
  };
  const focus = Array.isArray(meta.focus) && meta.focus.length ? meta.focus.join(', ') : 'comunicación, liderazgo, confianza, reconocimiento, carga y acuerdos';

  return `Eres ALÍA, un segundo cerebro privado para un facilitador organizacional durante una sesión real.\n\nOBJETIVO: decidir si existe AHORA una observación suficientemente útil como para interrumpir el silencio y susurrársela al facilitador.\n\nCONTEXTO\n- Tipo de sesión: ${meta.mode || 'diagnostico'}\n- Objetivo: ${meta.objective || 'Comprender la conversación y mejorar la facilitación.'}\n- Contexto: ${meta.context || 'Conversación organizacional.'}\n- Focos: ${focus}\n- Cadencia: ${meta.cadence || 'selectiva'}\n\nCRITERIO\n${modeRules[meta.mode] || modeRules.diagnostico}\n${cadenceThreshold[meta.cadence] || cadenceThreshold.selectiva}\n\nREGLAS\n1. Basa cualquier inferencia en palabras realmente presentes en la transcripción. No inventes emociones, intenciones, diagnósticos, rasgos, causas ni consensos.\n2. Busca recurrencias entre personas o momentos, contradicciones, temas evitados, lenguaje absoluto, diferencias entre problema y efecto, tensiones entre autonomía/control, necesidades, decisiones sin dueño, acuerdos vagos y oportunidades de profundización.\n3. Si la evidencia todavía es débil, responde intervene=false y type='silencio'.\n4. whisper debe ser una microintervención oral de máximo 22 palabras, natural y accionable. Si intervene=false, whisper debe ser ''.\n5. question debe ser una pregunta breve que el facilitador podría adaptar. Si no aporta, usa ''.\n6. evidence debe citar/parafrasear de forma muy breve la evidencia más reciente; nunca fabriques una cita literal.\n7. rationale explica en una frase por qué la señal importa; es para el panel, no para el audífono.\n8. Los scores van de 0 a 100 y significan prominencia del tema en el fragmento acumulado, NO riesgo, gravedad ni diagnóstico.\n9. Evita repetir una intervención que aparezca en HISTORIAL DE INSIGHTS.\n10. Español profesional, claro y natural. Nada de regionalismos forzados.`;
}

function extractOutputText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  const pieces = [];
  for (const item of payload.output || []) {
    for (const part of item.content || []) {
      if (typeof part.text === 'string') pieces.push(part.text);
    }
  }
  return pieces.join('');
}

async function analyzeTranscript(req, res) {
  if (!process.env.OPENAI_API_KEY) {
    return json(res, 503, { error: 'La API de OpenAI no está configurada.', code: 'NO_API_KEY' });
  }

  try {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const transcript = Array.isArray(body.transcript) ? body.transcript.slice(-30) : [];
    const insights = Array.isArray(body.insights) ? body.insights.slice(-8) : [];

    if (!transcript.length) return json(res, 400, { error: 'No hay transcripción para analizar.' });

    const transcriptText = transcript.map((x, i) => `${i + 1}. ${x.text}`).join('\n');
    const prior = insights.length
      ? insights.map((x, i) => `${i + 1}. ${x.type}: ${x.title} | ${x.whisper}`).join('\n')
      : 'Ninguno todavía.';

    const input = `TRANSCRIPCIÓN RECIENTE Y ACUMULADA\n${transcriptText}\n\nHISTORIAL DE INSIGHTS\n${prior}\n\nEvalúa si corresponde intervenir ahora.`;

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': hashUser(body.meta?.userId)
      },
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        reasoning: { effort: 'low' },
        instructions: analysisInstructions(body.meta || {}),
        input,
        text: {
          format: {
            type: 'json_schema',
            name: 'alia_insight',
            strict: true,
            schema: insightSchema
          }
        }
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      console.error('OpenAI analyze error', payload);
      return json(res, response.status, { error: payload?.error?.message || 'Error del motor de análisis.' });
    }

    const outputText = extractOutputText(payload);
    const parsed = JSON.parse(outputText);
    json(res, 200, { insight: parsed, model: ANALYSIS_MODEL });
  } catch (error) {
    console.error('analyze', error);
    json(res, 500, { error: 'No fue posible analizar este fragmento.' });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  const relative = pathname.replace(/^\/+/, '');
  const filePath = path.resolve(publicDir, relative);
  if (!filePath.startsWith(path.resolve(publicDir) + path.sep) && filePath !== path.join(publicDir, 'index.html')) {
    return json(res, 403, { error: 'Forbidden' });
  }

  fs.readFile(filePath, (err, data) => {
    if (err) return json(res, 404, { error: 'Not found' });
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': mime[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, {
      ok: true,
      apiConfigured: Boolean(process.env.OPENAI_API_KEY),
      analysisModel: ANALYSIS_MODEL,
      version: '0.2.0'
    });
  }
  if (req.method === 'POST' && req.url === '/transcription-token') return createTranscriptionToken(req, res);
  if (req.method === 'POST' && req.url === '/analyze') return analyzeTranscript(req, res);
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
  json(res, 405, { error: 'Method not allowed' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ALÍA 0.2 listo en http://0.0.0.0:${PORT}`);
  console.log(`Motor de análisis: ${ANALYSIS_MODEL}`);
});
