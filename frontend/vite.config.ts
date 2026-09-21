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

// `allowedHosts` existe para proteger contra DNS rebinding quando alguém roda o preview na
// própria máquina: sem ele, um site malicioso poderia apontar um domínio para 127.0.0.1 e ler
// a resposta. Por isso o Vite recusa, com 403, qualquer requisição cujo Host não seja local.
//
// Em container (Railway, Fly, Render) o tráfego chega SEMPRE pelo domínio público, então a
// proteção derruba o site inteiro — o sintoma é "Application failed to respond" / 502, sem
// nenhum erro no log do build, porque o processo subiu normalmente.
//
// `true` libera qualquer Host. É seguro aqui porque quem termina a conexão é o proxy da
// plataforma, que já valida o domínio antes de encaminhar — o ataque de rebinding depende de
// falar direto com o processo, o que não acontece atrás do proxy. Rodando localmente, o
// preview continua acessível só de quem alcança a máquina.
const hostsPermitidos = process.env.PORT ? true : undefined

export default defineConfig({
  plugins: [tailwindcss(), react()],
  preview: {
    host: true,
    port: portaPreview,
    allowedHosts: hostsPermitidos,
  },
})
