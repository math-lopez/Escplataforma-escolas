#!/bin/bash
# Ciclo completo contra o Supabase real: professor monta curso, cadastra e matricula aluno;
# aluno entra, vê o curso, marca aula concluída. Verifica isolamento nos dois papéis.
set -u
API=http://localhost:3333
P=/tmp/prof.txt; A=/tmp/aluno.txt; X=/tmp/outro.txt
rm -f "$P" "$A" "$X"
T=$(date +%s)
falhou=0
p(){ printf "%-56s" "$1"; }; ok(){ echo "OK"; }; er(){ echo "FALHOU -> $1"; falhou=1; }

# ---- instituição A ----
p "1. onboarding instituicao A"
R=$(curl -s -c "$P" -X POST "$API/api/instituicoes/onboarding" -H "Content-Type: application/json" \
 -d "{\"nomeInstituicao\":\"Instituto Aurora\",\"slug\":\"zz-teste-claude-a$T\",\"nomeAdmin\":\"Prof A\",\"email\":\"profa-$T@exemplo-teste.invalid\",\"senha\":\"SenhaTeste123!\"}")
echo "$R" | grep -q admin_instituicao && ok || { er "$R"; exit 1; }

p "2. cria curso + modulo + aula"
C=$(curl -s -b "$P" -X POST "$API/api/cursos" -H "Content-Type: application/json" -d '{"titulo":"Teologia I","publicado":true}')
CU=$(echo "$C"|grep -oE '"id":"[^"]+"'|head -1|cut -d'"' -f4)
M=$(curl -s -b "$P" -X POST "$API/api/cursos/$CU/modulos" -H "Content-Type: application/json" -d '{"titulo":"Modulo 1"}')
MO=$(echo "$M"|grep -oE '"id":"[^"]+"'|head -1|cut -d'"' -f4)
AU=$(curl -s -b "$P" -X POST "$API/api/modulos/$MO/aulas" -H "Content-Type: application/json" -d '{"titulo":"Aula 1","tipo":"texto","conteudoTexto":"conteudo"}')
AL=$(echo "$AU"|grep -oE '"id":"[^"]+"'|head -1|cut -d'"' -f4)
[ -n "$CU" ] && [ -n "$MO" ] && [ -n "$AL" ] && ok || er "curso=$CU mod=$MO aula=$AL"

p "3. cadastra aluno (senha provisoria)"
S=$(curl -s -b "$P" -X POST "$API/api/alunos" -H "Content-Type: application/json" \
 -d "{\"nome\":\"Aluno Teste\",\"email\":\"aluno-$T@exemplo-teste.invalid\"}")
AID=$(echo "$S"|grep -oE '"id":"[^"]+"'|head -1|cut -d'"' -f4)
SENHA=$(echo "$S"|grep -oE '"senhaProvisoria":"[^"]+"'|cut -d'"' -f4)
[ -n "$SENHA" ] && ok || er "$S"

p "4. matricula o aluno no curso"
MT=$(curl -s -o /dev/null -w "%{http_code}" -b "$P" -X POST "$API/api/cursos/$CU/matriculas" \
 -H "Content-Type: application/json" -d "{\"alunoId\":\"$AID\"}")
[ "$MT" = "201" ] && ok || er "status $MT"

# ---- aluno ----
p "5. aluno faz login com a senha provisoria"
L=$(curl -s -c "$A" -X POST "$API/api/auth/login" -H "Content-Type: application/json" \
 -d "{\"email\":\"aluno-$T@exemplo-teste.invalid\",\"senha\":\"$SENHA\"}")
echo "$L" | grep -q '"papel":"aluno"' && ok || er "$L"

p "6. aluno ve o curso matriculado"
MC=$(curl -s -b "$A" "$API/api/aluno/cursos")
echo "$MC" | grep -q "Teologia I" && ok || er "$MC"

p "7. aluno abre o curso e ve a aula"
DC=$(curl -s -b "$A" "$API/api/aluno/cursos/$CU")
echo "$DC" | grep -q "Aula 1" && ok || er "$DC"

p "8. aluno marca aula como concluida"
CC=$(curl -s -o /dev/null -w "%{http_code}" -b "$A" -X POST "$API/api/aluno/aulas/$AL/concluir")
[ "$CC" = "200" ] || [ "$CC" = "201" ] && ok || er "status $CC"

p "9. progresso reflete 1 de 1 concluida"
PR=$(curl -s -b "$A" "$API/api/aluno/cursos")
echo "$PR" | grep -qE '"aulasConcluidas":1' && ok || er "$PR"

p "10. aluno NAO acessa rota de staff"
SC=$(curl -s -o /dev/null -w "%{http_code}" -b "$A" "$API/api/alunos")
[ "$SC" = "403" ] && ok || er "status $SC (esperado 403)"

p "11. professor NAO acessa rota de aluno"
PC=$(curl -s -o /dev/null -w "%{http_code}" -b "$P" "$API/api/aluno/cursos")
[ "$PC" = "403" ] && ok || er "status $PC (esperado 403)"

# ---- isolamento entre instituicoes ----
p "12. onboarding instituicao B"
RB=$(curl -s -c "$X" -X POST "$API/api/instituicoes/onboarding" -H "Content-Type: application/json" \
 -d "{\"nomeInstituicao\":\"Escola Beta\",\"slug\":\"zz-teste-claude-b$T\",\"nomeAdmin\":\"Prof B\",\"email\":\"profb-$T@exemplo-teste.invalid\",\"senha\":\"SenhaTeste123!\"}")
echo "$RB" | grep -q admin_instituicao && ok || er "$RB"

p "13. prof B NAO enxerga curso da instituicao A"
LB=$(curl -s -b "$X" "$API/api/cursos")
echo "$LB" | grep -q "Teologia I" && er "VAZOU curso entre instituicoes!" || ok

p "14. prof B NAO abre curso de A por id direto"
GB=$(curl -s -o /dev/null -w "%{http_code}" -b "$X" "$API/api/cursos/$CU")
[ "$GB" = "404" ] && ok || er "status $GB (esperado 404)"

p "15. prof B NAO matricula aluno de A no curso dele"
CB=$(curl -s -b "$X" -X POST "$API/api/cursos" -H "Content-Type: application/json" -d '{"titulo":"Curso B"}')
CUB=$(echo "$CB"|grep -oE '"id":"[^"]+"'|head -1|cut -d'"' -f4)
MB=$(curl -s -o /dev/null -w "%{http_code}" -b "$X" -X POST "$API/api/cursos/$CUB/matriculas" \
 -H "Content-Type: application/json" -d "{\"alunoId\":\"$AID\"}")
[ "$MB" = "404" ] && ok || er "status $MB (esperado 404 — aluno de outra instituicao!)"

p "16. auto-cadastro bloqueado (modo padrao = manual)"
IC=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/publico/instituicoes/zz-teste-claude-a$T/inscricao" \
 -H "Content-Type: application/json" -d '{"nome":"Intruso","email":"intruso@exemplo-teste.invalid","senha":"Senha12345"}')
[ "$IC" = "403" ] && ok || er "status $IC (esperado 403)"

echo ""
[ "$falhou" = "0" ] && echo "RESULTADO: ciclo completo passou" || echo "RESULTADO: houve falha"

# ── Bloco 2: rotas novas da area do aluno (material PDF e isolamento) ──────────
echo ""
echo "--- area do aluno: material e isolamento ---"

p "17. aula pdf sem arquivo -> 404 no material"
AP=$(curl -s -b "$P" -X POST "$API/api/modulos/$MO/aulas" -H "Content-Type: application/json" \
 -d '{"titulo":"Apostila","tipo":"pdf"}')
APID=$(echo "$AP"|grep -oE '"id":"[^"]+"'|head -1|cut -d'"' -f4)
R17=$(curl -s -o /dev/null -w "%{http_code}" -b "$A" "$API/api/aluno/aulas/$APID/material")
[ "$R17" = "404" ] && ok || er "status $R17 (esperado 404)"

p "18. aula de texto -> 404 no material (nao e pdf)"
R18=$(curl -s -o /dev/null -w "%{http_code}" -b "$A" "$API/api/aluno/aulas/$AL/material")
[ "$R18" = "404" ] && ok || er "status $R18 (esperado 404)"

p "19. professor NAO acessa rota de material"
R19=$(curl -s -o /dev/null -w "%{http_code}" -b "$P" "$API/api/aluno/aulas/$APID/material")
[ "$R19" = "403" ] && ok || er "status $R19 (esperado 403)"

p "20. aluno de B NAO abre material de aula de A"
SB=$(curl -s -b "$X" -X POST "$API/api/alunos" -H "Content-Type: application/json" \
 -d "{\"nome\":\"Aluno B\",\"email\":\"alunob-$T@exemplo-teste.invalid\"}")
SENHAB=$(echo "$SB"|grep -oE '"senhaProvisoria":"[^"]+"'|cut -d'"' -f4)
curl -s -c /tmp/alunob.txt -X POST "$API/api/auth/login" -H "Content-Type: application/json" \
 -d "{\"email\":\"alunob-$T@exemplo-teste.invalid\",\"senha\":\"$SENHAB\"}" > /dev/null
R20=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/alunob.txt "$API/api/aluno/aulas/$APID/material")
[ "$R20" = "404" ] && ok || er "status $R20 (esperado 404 - aula de outra instituicao!)"

p "21. aluno de B NAO abre curso de A"
R21=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/alunob.txt "$API/api/aluno/cursos/$CU")
[ "$R21" = "404" ] && ok || er "status $R21 (esperado 404)"

p "22. aluno de B ve lista vazia (sem matricula)"
R22=$(curl -s -b /tmp/alunob.txt "$API/api/aluno/cursos")
[ "$R22" = "[]" ] && ok || er "$R22"

p "23. aluno desmarca aula concluida"
R23=$(curl -s -o /dev/null -w "%{http_code}" -b "$A" -X DELETE "$API/api/aluno/aulas/$AL/concluir")
[ "$R23" = "204" ] && ok || er "status $R23"

p "24. progresso voltou a 0 concluidas"
R24=$(curl -s -b "$A" "$API/api/aluno/cursos")
echo "$R24" | grep -qE '"aulasConcluidas":0' && ok || er "$R24"

echo ""
[ "$falhou" = "0" ] && echo "RESULTADO FINAL: ciclo completo passou" || echo "RESULTADO FINAL: houve falha"

# ── Bloco 3: quiz, certificado e pagina publica ───────────────────────────────
echo ""
echo "--- quiz, certificado e pagina publica ---"

p "25. professor cria quiz no curso"
Q=$(curl -s -b "$P" -X PUT "$API/api/cursos/$CU/quiz" -H "Content-Type: application/json" -d '{
 "titulo":"Prova final","notaMinimaAprovacao":50,
 "perguntas":[{"enunciado":"2+2?","ordem":0,"alternativas":[{"texto":"4","correta":true},{"texto":"5","correta":false}]},
              {"enunciado":"Capital do Brasil?","ordem":1,"alternativas":[{"texto":"Brasilia","correta":true},{"texto":"Rio","correta":false}]}]}')
echo "$Q" | grep -q '"perguntas"' && ok || er "$Q"

p "26. SEGURANCA: quiz do aluno NAO traz o gabarito"
QA=$(curl -s -b "$A" "$API/api/aluno/cursos/$CU/quiz")
# Verifica PRIMEIRO que a resposta e um quiz de verdade: uma resposta de erro tambem
# nao contem "correta", e passaria numa asserção puramente negativa (falso positivo).
if echo "$QA" | grep -q .perguntas.; then
  echo "$QA" | grep -q .correta. && er "VAZOU O GABARITO!" || ok
else
  er "aluno nao conseguiu ler o quiz: $QA"
fi

p "27. professor VE o gabarito (rota de staff)"
QS=$(curl -s -b "$P" "$API/api/cursos/$CU/quiz")
echo "$QS" | grep -q '"correta"' && ok || er "staff deveria ver: $QS"

p "28. aluno responde tudo errado -> reprovado"
P1=$(echo "$QA"|grep -oE '"id":"[^"]+"'|sed -n '2p'|cut -d'"' -f4)
A1=$(echo "$QA"|grep -oE '"id":"[^"]+"'|sed -n '3p'|cut -d'"' -f4)
TE=$(curl -s -b "$A" -X POST "$API/api/aluno/cursos/$CU/quiz/tentativas" -H "Content-Type: application/json" \
 -d "{\"respostas\":{\"$P1\":\"$A1\"},\"nota\":100,\"aprovado\":true}")
echo "$TE" | grep -qE '"aprovado":(false|null)' && ok || er "nota/aprovado do corpo foi aceita? $TE"

p "29. certificado NEGADO antes de concluir (409)"
C1=$(curl -s -o /dev/null -w "%{http_code}" -b "$A" -X POST "$API/api/aluno/cursos/$CU/certificado")
[ "$C1" = "409" ] && ok || er "status $C1 (esperado 409)"

p "30. 409 explica o que falta ao aluno"
C1B=$(curl -s -b "$A" -X POST "$API/api/aluno/cursos/$CU/certificado")
echo "$C1B" | grep -qE 'totalAulas|quizAprovado' && ok || er "$C1B"

p "31. prof B NAO le o quiz do curso de A"
QB=$(curl -s -o /dev/null -w "%{http_code}" -b "$X" "$API/api/cursos/$CU/quiz")
[ "$QB" = "404" ] && ok || er "status $QB (esperado 404)"

p "32. prof B NAO sobrescreve o quiz de A"
QW=$(curl -s -o /dev/null -w "%{http_code}" -b "$X" -X PUT "$API/api/cursos/$CU/quiz" -H "Content-Type: application/json" \
 -d '{"titulo":"Invasao","notaMinimaAprovacao":0,"perguntas":[{"enunciado":"x","ordem":0,"alternativas":[{"texto":"a","correta":true},{"texto":"b","correta":false}]}]}')
[ "$QW" = "404" ] && ok || er "status $QW (esperado 404)"

p "33. pagina publica lista so cursos publicados"
PB=$(curl -s "$API/api/publico/instituicoes/zz-teste-claude-a$T")
echo "$PB" | grep -q "Teologia I" && ok || er "$PB"

p "34. pagina publica NAO vaza e-mail nem modo interno"
echo "$PB" | grep -qE '@exemplo-teste|service_role' && er "vazou dado sensivel" || ok

p "35. validar certificado inexistente -> 404"
V1=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/publico/certificados/CODIGOINEXISTENTE9")
[ "$V1" = "404" ] && ok || er "status $V1"

echo ""
[ "$falhou" = "0" ] && echo "RESULTADO GERAL: tudo passou" || echo "RESULTADO GERAL: houve falha"
