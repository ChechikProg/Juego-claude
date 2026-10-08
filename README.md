# Partidazo

Plataforma de minijuegos multijugador para el navegador. Elegís nombre, creás una
sala, pasás el código de 4 letras y el resto se suma. Se juegan varios minijuegos
seguidos y gana el que más puntos junte: cada minijuego reparte **10 / 5 / 3**.

## Minijuegos

| | Juego | De qué va |
|---|---|---|
| 🎨 | **Vicente van Gogh** | Se sortea una palabra, todos la dibujan en 2 minutos (o menos si todos dan LISTO) y después se votan los dibujos de 1 a 5 estrellas, estilo build battle. |
| 🎰 | **Viva la Timba** | Arrancás con $1.000. Blackjack, ruleta europea y un tragamonedas de caramelos con cluster pays, tumbles, scatters y giros gratis. Gana el que más plata tenga al final. |
| 🏓 | **Smash 360** | Estás fijo en el borde de un círculo con una pelota orbitando. Agachate para esquivarla o pegale para devolverla más rápido. Si te toca parado, afuera. |
| 🏔️ | **Pirámide** | Todos arrancan en el piso de una pirámide de escalones cada vez más chicos. Mientras estés en la punta sumás puntos. Se puede saltar y empujar fuerte. |
| 💬 | **Frases Chupete** | Aparece una frase con un hueco, todos la completan en 1 minuto y después se vota en anónimo cuál fue la mejor. Cada voto vale un punto. |

## Cómo correrlo

```bash
npm install
npm run dev      # servidor en :3001 y cliente (Vite) en :5173
```

Abrí <http://localhost:5173>. Para probar de a varios, abrí pestañas en incógnito
o entrá desde el celular con la IP de tu máquina.

```bash
npm run build    # compila cliente y servidor a dist/
npm start        # un solo proceso sirve la web y los websockets en :3001
npm run typecheck
```

## Publicarlo

El build deja todo en `dist/`: `dist/client` (la web) y `dist/server/index.js`
(el proceso de Node, que también sirve los estáticos). Alcanza con un solo
servicio web.

- **Render / Railway / Fly**: build `npm install && npm run build`, start `npm start`.
  Usan la variable `PORT`, que el servidor ya respeta. Hay un `render.yaml` listo.
- **Docker**: `docker build -t partidazo . && docker run -p 3001:3001 partidazo`.

Requisitos: Node 20 o más nuevo y que el hosting soporte **WebSockets** (todos los
de arriba lo hacen). No hace falta base de datos: las salas viven en memoria y se
borran solas tres minutos después de que se va el último jugador.

Variables de entorno (ver `.env.example`):

- `PORT` — puerto del servidor (por defecto 3001).
- `CORS_ORIGIN` — sólo hace falta en desarrollo si servís el cliente desde otro origen.

## Cómo está armado

```
shared/      tipos y constantes que usan cliente y servidor (una sola fuente de verdad)
server/
  index.ts     express + socket.io + validación de entrada + rate limiting
  rooms.ts     salas, jugadores, anfitrión, y el motor que encadena los minijuegos
  games/
    kit.ts     el contrato GameModule
    registry.ts  dónde se enchufan los minijuegos
    *.ts       un archivo por minijuego
client/src/
  net/, state/   socket, sincronización de reloj y store (zustand)
  components/    UI compartida
  screens/       inicio, lobby, intro, resultados, podio
  games/         un componente por minijuego
```

El servidor es **autoritativo**: el cliente nunca decide un resultado. Las cartas,
la ruleta, el tragamonedas y la física de Smash 360 y Pirámide corren en el
servidor con entropía criptográfica; el cliente sólo manda intenciones y dibuja.

Para los juegos en tiempo real el servidor simula a 60 Hz, manda snapshots
agrupados cada 40 ms y el cliente extrapola e interpola entre ellos. Smash 360
además compensa latencia: cada input se evalúa contra el momento en que el
jugador realmente apretó (estimado con el RTT), y una eliminación se resuelve
130 ms después del impacto para darle lugar a un input que venía en camino.

## Agregar un minijuego

Toda la plataforma está pensada para esto. Son cinco pasos:

1. Sumá el id en `GameId` (`shared/types.ts`) y el tipo de su vista.
2. Agregá su metadata en `GAMES` y `GAME_ORDER` (`shared/constants.ts`), más
   cualquier opción nueva en `RoomConfig` y `DEFAULT_CONFIG`.
3. Creá `server/games/<tu-juego>.ts` implementando `GameModule`:
   `create` / `start` / `event` / `view`, y `tick` + `tickHz` si necesita
   simulación. Cuando termine, llamá a `ctx.finish([{ playerId, value, label }])`
   con el valor más alto = mejor; el motor reparte 10/5/3 y maneja los empates.
4. Registralo en `server/games/registry.ts`.
5. Creá el componente en `client/src/games/<tu-juego>/` y agregalo a
   `client/src/games/index.ts`. Si tiene ajustes, sumá su `Stepper` en
   `client/src/screens/Lobby.tsx`.

No hace falta tocar el motor, el lobby, el podio ni el reparto de puntos.

## Detalles que ya están resueltos

- **Reconexión**: si recargás la página volvés a tu sala con tus puntos intactos
  (la identidad vive en `localStorage` por 3 horas).
- **Anfitrión**: si se va, el rol pasa solo al siguiente jugador conectado.
- **Espectadores**: quien entra con la partida empezada mira el minijuego en curso
  y entra a jugar en el siguiente.
- **Invitaciones**: el botón *Invitar* comparte un link `?sala=CÓDIGO` que
  autocompleta el código.
- **Límites**: hasta 12 jugadores por sala, nombres de 14 caracteres, y un balde
  de fichas por socket para que nadie inunde el servidor.
- **Sonido**: todo sintetizado con Web Audio, sin un solo archivo de audio. Se
  silencia desde la barra superior.
- **Accesibilidad**: respeta `prefers-reduced-motion`, todo se navega con teclado
  y los controles tienen etiquetas.
