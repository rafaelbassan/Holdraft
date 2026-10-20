# Regras de criação de cards

Este arquivo é relido a cada rodada de **criação** de cards. Consultas no Jira não usam estas regras.

## Bug e card de teste companheiro

Todo card de **correção de bug** deve incluir, no mesmo rascunho, um **card companheiro de teste** para reproduzir o bug.

- O card de teste usa o tipo **Test** quando o projeto tiver esse tipo de issue.
- Se o projeto não tiver o tipo Test, o agente pergunta qual tipo usar antes de marcar o rascunho como pronto.
- Resumo, descrição e demais textos dos dois cards saem no **idioma padrão dos cards** definido em Configurações.
- Não copie o texto colado e não traduza frase a frase. Entenda o relato e escreva o trabalho: o que está errado, o impacto, o resultado esperado e, quando o relato permitir, o que mudar.
- Mantenha entre aspas os textos de interface, códigos de erro e nomes de produto exatamente como foram reportados.
- Guarde o trecho original, sem traduzir, em `source_text`. A descrição do card é o trabalho, não o relato.
- O card de teste descreve como verificar: o que fazer, o que passa e o que falha.
- Se o relato não diz o que deve ser feito, pergunte antes de marcar o rascunho como pronto. Não invente a correção.
- Após a criação confirmada das duas issues, ligue-as com `POST /rest/api/3/issueLink`.
- Tipo de ligação preferido: **Tests**. Se o site não tiver esse tipo, use **Relates**.

Não é permitido confirmar a criação do card de bug se o card de teste exigido por esta regra estiver ausente ou incompleto.
