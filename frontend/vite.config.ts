import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// A porta e o host do `preview` são lidos aqui, e não passados como argumento no script `start`,
// porque `--port ${PORT:-4173}` só é expandido por shells POSIX: no Windows o npm usa cmd.exe e
// a string chega literal ao Vite, que falha. Lendo de process.env aqui, o mesmo script funciona
// em qualquer sistema — e dá para testar localmente antes de subir.
//
// `host: true` faz o servidor escutar em 0.0.0.0. Plataformas de container (Railway, Fly, Render)
// só alcançam o processo se ele estiver em 0.0.0.0; escutando só em localhost, o deploy sobe e
// responde "Application failed to respond", sem erro no log.
const portaPreview = Number(process.env.PORT) || 4173

export default defineConfig({
  plugins: [tailwindcss(), react()],
  preview: {
    host: true,
    port: portaPreview,
  },
})
