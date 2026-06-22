# Praça Jardim Napen — Mapa de Food Trucks

Site estático que mostra um mapa interativo da **Praça Conjunto dos Estados** (Pracinha Jardim Napen / Praça Regina Frigeri Furno) em Jardim Camburi, Vitória-ES, com avaliações dos 22 food trucks coletadas via Google Forms.

## Como rodar localmente

Você precisa apenas servir os arquivos por HTTP (não funciona abrindo o `index.html` direto por causa do `fetch` do CSV).

Opção mais simples, com Node já instalado:

```powershell
npx serve .
```

Ou com Python:

```powershell
python -m http.server 8080
```

Aí abre `http://localhost:8080`.

## Estrutura

```
praca-napen/
├── index.html          # estrutura da página
├── css/style.css       # estilos
├── js/inference.js     # motor de inferência de colunas do CSV
├── js/app.js           # mapa, marcadores, painel lateral
├── data/foodtrucks.json # lista dos 22 trucks + coordenadas
├── data/mock.csv       # CSV fictício para demonstração
├── config.example.json # modelo do config.json (renomear quando o Forms estiver pronto)
└── README.md
```

## Conectando o Google Forms real

1. Crie o Google Forms com as perguntas que quiser. **Obrigatório:** uma pergunta tipo *Lista suspensa* com os 22 nomes dos food trucks (exatamente como estão em `data/foodtrucks.json` no campo `nome`).
2. Na planilha de respostas: **Arquivo → Compartilhar → Publicar na web → Valores separados por vírgula (.csv) → Publicar**. Copie a URL.
3. Copie `config.example.json` para `config.json` e preencha:
   - `csvUrl`: a URL que você copiou.
   - `foodTruckColumn`: o nome exato (cabeçalho) da coluna da Lista suspensa.
   - `columnLabels`, `hiddenColumns`, `columnOrder`: opcionais (veja abaixo).
4. `git add . ; git commit -m "conecta CSV real" ; git push`. Em 1–2 minutos o GitHub Pages atualiza.

> O `config.json` está no `.gitignore` para você poder testar localmente sem comitar. Para publicar, remova essa linha do `.gitignore` antes do push, **ou** edite o `config.example.json` direto e renomeie no servidor — eu recomendo a primeira opção.

## Como funciona o motor de inferência

O site não sabe de antemão como o seu Forms vai ser estruturado. Para cada coluna do CSV ele decide o tipo automaticamente:

| Critério | Tipo detectado | Como é exibido |
|---|---|---|
| ≥80% dos valores são números entre 1 e 10 | **numeric** | média, barra de progresso, estrelas, nº de respostas |
| ≤6 valores únicos distintos com repetição (ex.: Sim/Não, Likert) | **categorical** | distribuição percentual em barras horizontais |
| Cabeçalho parece carimbo de data/hora | **timestamp** | "última avaliação em DD/MM/AAAA" |
| Cabeçalho contém *email*, *nome*, *telefone*, *cpf*, etc. | **personal** | **ignorada** (privacidade) |
| Qualquer outra coisa | **text** | últimos 5 comentários |

A coluna que identifica qual food truck a resposta avalia é detectada por nome (`food truck`, `empreendimento`, `estabelecimento` — case-insensitive) ou explicitamente em `foodTruckColumn` no `config.json`.

### Configuração avançada (`config.json`)

```json
{
  "csvUrl": "https://docs.google.com/spreadsheets/d/.../pub?output=csv",
  "foodTruckColumn": "Qual food truck você avaliou?",
  "columnLabels": {
    "Nota geral": "Nota geral (1-5)",
    "P3": "Atendimento"
  },
  "hiddenColumns": ["Coluna chata que não quero mostrar"],
  "columnOrder": ["Nota geral", "Qualidade da comida", "Atendimento"]
}
```

- `columnLabels`: troca o cabeçalho técnico do Forms por um rótulo apresentável.
- `hiddenColumns`: lista colunas a ignorar (além das de dado pessoal, já ignoradas automaticamente).
- `columnOrder`: ordem de exibição. O que não estiver listado vai para o fim.

## Atualizar a lista de food trucks

Edite `data/foodtrucks.json`. Estrutura por item:

```json
{ "id": 1, "nome": "Rebocando", "lat": -20.2583, "lon": -40.2360 }
```

As coordenadas iniciais foram geradas em círculo (~30 m de raio) ao redor do centro da praça (`-20.2585, -40.2360`). Substitua pelas reais quando souber.

> **Importante:** o campo `nome` precisa bater **exatamente** com o que está na Lista suspensa do Google Forms, senão a contagem de avaliações dá zero para o truck.

## Stack

- HTML/CSS/JS puro — sem build, sem bundler, sem npm install no frontend.
- [Leaflet.js](https://leafletjs.com/) via CDN para o mapa.
- [OpenStreetMap](https://www.openstreetmap.org/) como tile provider (gratuito, sem chave).
- [PapaParse](https://www.papaparse.com/) via CDN para parsear o CSV.

## Hospedagem

GitHub Pages. Cada push na branch `main` atualiza o site em 1–2 minutos.
