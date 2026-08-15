# ALÍA MVP 0.2

ALÍA es una PWA móvil de segunda escucha para reuniones, talleres, grupos focales y conversaciones consultivas.

## Funciones
- Transcripción en vivo preparada con OpenAI Realtime.
- Motor separado de criterio e intervención.
- Modos: diagnóstico, taller, reunión y comercial.
- Cadencia selectiva, equilibrada o activa.
- Microintervenciones por síntesis de voz del navegador.
- Panel de señales, transcripción, notas y marcadores.
- Modo demo sin API.

## Variables de entorno
- `OPENAI_API_KEY`: requerida para modo real.
- `OPENAI_ANALYSIS_MODEL`: opcional; por defecto `gpt-5.6-luna`.
- `PORT`: Render la configura automáticamente.

## Ejecutar
```bash
npm start
```

## Render
Este repositorio está preparado como un único Web Service Node.js con `npm start`.
