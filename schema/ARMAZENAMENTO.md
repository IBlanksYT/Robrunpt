# Arquitetura de armazenamento (Netlify Blobs)

Não é preciso preparar nada manualmente: as stores são criadas automaticamente na primeira escrita.
Enquanto não houver nada guardado, o site usa `schema/site.default.json` (embebido no build).

| Store          | Chaves                                   | Conteúdo |
|----------------|------------------------------------------|----------|
| `rr-site`      | `draft`, `published`                     | Documento do site (tema, cabeçalho, rodapé, definições, páginas e secções) |
| `rr-versions`  | `v/<id>`                                 | Histórico de versões (criado ao publicar, restaurar ou manualmente). Mantém as últimas 100 |
| `rr-content`   | `news/<id>`, `guides/<id>`, `clans/<id>` | Notícias, guias e clãs |
| `rr-clips`     | `c/<id>`, `idx/<plataforma>-<videoId>`, `byuser/<userId>/<id>` | Clips, índice anti-duplicados e índice por autor |
| `rr-users`     | `u/<id>`                                 | Perfis (id Google, nome, foto, email, função, suspensão) |
| `rr-sessions`  | `s/<sid>`                                | Sessões do servidor (o cookie só contém o id assinado) |
| `rr-media`     | `m/<ficheiro>`                           | Imagens carregadas no painel (binário + metadados) |
| `rr-stats`     | `d/<AAAA-MM-DD>`                         | Contagens anónimas agregadas por dia |
| `rr-ratelimit` | `<bucket>/<chave>`                       | Limitação de pedidos (pseudónimos temporários, limpos diariamente) |
| `rr-backups`   | `b/<id>`                                 | Backups completos (automático diário, manuais, importados) |
| `rr-audit`     | `a/<id>`                                 | Registo de ações de administração/moderação (180 dias) |

## Concorrência
Escritas que podem colidir (rascunho do site, contadores, utilizadores, limitação de pedidos) usam
escrita condicional por ETag (`onlyIfMatch` / `onlyIfNew`) com novas tentativas. O editor deteta
quando outro administrador gravou o rascunho entretanto e pergunta o que fazer (sem perda silenciosa).
Clips e conteúdos são guardados um por chave, por isso publicações simultâneas não interferem.

## Ids ordenáveis
Clips, versões, backups e auditoria usam ids com timestamp invertido, para que a listagem
lexicográfica devolva primeiro os mais recentes.
