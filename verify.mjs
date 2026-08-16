/* Confere o codificador de QR do plugin decodificando o que ele desenha. */
import fs from 'node:fs';
import jsQR from 'jsqr';

const SRC = new URL('./plugin.js', import.meta.url);
const src = fs.readFileSync(SRC, 'utf8');

// stub do runtime: o plugin chama render() no fim
const jr = {
  root: { innerHTML: '', querySelector: () => null },
  escape: (t) => String(t),
  /* o ajuste que a sala preencheu: no app chega por postMessage */
  settings: {},
  on: () => {},
};

const load = new Function(
  'jr',
  `${src}\nreturn { encodeQr, brCode, config, PADRAO, capacity, utf8, crc16, render, money, problems, field };`,
);
const api = load(jr);

let falhas = 0;
const ok = (cond, titulo, evid) => {
  console.log(`  ${cond ? 'OK   ' : 'FALHA'} ${titulo}${evid ? ` → ${evid}` : ''}`);
  if (!cond) falhas++;
};

/** A matriz vira pixels RGBA, como uma foto da tela. */
function pixels(matrix, scale = 6, quiet = 4) {
  const n = matrix.length;
  const side = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (!matrix[i][j]) continue;

      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const y = (i + quiet) * scale + dy;
          const x = (j + quiet) * scale + dx;
          const p = (y * side + x) * 4;

          data[p] = data[p + 1] = data[p + 2] = 0;
        }
      }
    }
  }

  return { data, side };
}

const roundTrip = (texto, rotulo) => {
  let m;

  try {
    m = api.encodeQr(texto);
  } catch (e) {
    ok(false, rotulo, `nao codificou: ${e.message}`);

    return;
  }

  const { data, side } = pixels(m);
  const lido = jsQR(data, side, side);

  ok(
    lido && lido.data === texto,
    rotulo,
    lido
      ? lido.data === texto
        ? `v${(m.length - 17) / 4} · ${texto.length} bytes · bateu`
        : `leu OUTRA coisa: ${lido.data.slice(0, 40)}`
      : 'ilegivel',
  );
};

console.log('\n[1] o BR Code do PIX');

/* a sala preencheu os ajustes: e' de la' que a configuracao vem */
jr.settings = { pixKey: 'mods@jukeroom.com', name: 'JUKEROOM MODS', city: 'SAO PAULO' };

const payload = api.brCode(api.config());

console.log(`  payload (${payload.length} chars): ${payload}`);
ok(payload.startsWith('000201'), 'comeca com o indicador de formato');
ok(/6304[0-9A-F]{4}$/.test(payload), 'termina com o CRC de 4 digitos', payload.slice(-8));
ok(payload.includes('BR.GOV.BCB.PIX'), 'declara o arranjo PIX');

/*
  O CRC e' conferido recalculando sobre a cadeia sem os 4 digitos finais: e' o
  mesmo que o app do banco faz, e e' onde um erro de contagem aparece.
*/
ok(
  api.crc16(payload.slice(0, -4)) === payload.slice(-4),
  'e o CRC fecha com o proprio conteudo',
  `${payload.slice(-4)}`,
);

console.log('\n[2] o QR e legivel por um leitor de verdade');

roundTrip(payload, 'o PIX configurado volta identico');
roundTrip(api.brCode({ ...api.config(), key: '11122233344', amount: '25.50' }), 'com CPF e valor');
roundTrip(
  api.brCode({
    ...api.config(),
    key: '123e4567-e89b-12d3-a456-426614174000',
    name: 'ASSOCIACAO DE MODERADORES DO JUKEROOM',
    city: 'RIO DE JANEIRO',
  }),
  'com chave aleatoria e nome longo',
);

console.log('\n[3] os limites');

for (const n of [1, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287]) {
  roundTrip('A'.repeat(n), `${n} bytes (limite de uma versao)`);
}

let estourou = false;

try {
  api.encodeQr('A'.repeat(288));
} catch {
  estourou = true;
}

ok(estourou, 'e recusa o que nao cabe, em vez de desenhar lixo');

console.log('\n[4] a configuracao vem da SALA, e nao do arquivo');

/*
  O que faz o plugin ser GENERICO: o mesmo codigo, instalado em duas salas, gera
  dois codigos PIX diferentes. Com a chave escrita no arquivo, cada sala teria de
  bifurcar o repositorio para trocar uma linha — e a chave de uma ficaria no
  codigo de todas as outras.
*/
jr.settings = {};
jr.root.innerHTML = '';
api.render();

ok(
  /chave PIX configurada/i.test(jr.root.innerHTML),
  'sem ajuste, o plugin pede a configuracao em vez de desenhar um QR invalido',
  jr.root.innerHTML
    .replace(/<[^>]+>/g, ' ')
    .trim()
    .slice(0, 50),
);

jr.settings = { pixKey: 'sala-a@exemplo.com', name: 'SALA A', city: 'RECIFE' };

const codigoA = api.brCode(api.config());

jr.settings = { pixKey: 'sala-b@exemplo.com', name: 'SALA B', city: 'CURITIBA' };

const codigoB = api.brCode(api.config());

ok(codigoA.includes('sala-a@exemplo.com'), 'a chave da sala A entra no codigo dela');
ok(codigoB.includes('sala-b@exemplo.com'), 'a da sala B, no dela');
ok(codigoA !== codigoB, 'e os dois sao diferentes, com o MESMO plugin instalado');
roundTrip(codigoA, 'o codigo da sala A e legivel');
roundTrip(codigoB, 'o da sala B tambem');

/* Valor fixo e' opcional: com ele o campo 54 aparece, sem ele quem paga escolhe. */
jr.settings = { pixKey: 'x@y.com', name: 'SALA', city: 'SP', amount: '25,50' };

const comValor = api.brCode(api.config());

ok(comValor.includes('540525.50'), 'o valor fixo entra formatado', comValor.slice(50, 78));

jr.settings = { pixKey: 'x@y.com', name: 'SALA', city: 'SP' };

ok(!/5405\d/.test(api.brCode(api.config())), 'e sem valor, o campo nem aparece');

/* O recado tambem e' da sala, e nao uma frase presa no codigo. */
jr.settings = { pixKey: 'x@y.com', name: 'S', city: 'SP', message: 'Ajude o mods!' };
jr.root.innerHTML = '';
api.render();

ok(jr.root.innerHTML.includes('Ajude o mods!'), 'o recado da sala aparece na tela');

console.log('\n[5] o QR e GRANDE o bastante para uma camera');

/*
  O defeito que nao aparece em teste de software: o codigo estava CERTO e nao
  lia no celular.

  O SVG saia com 168px fixos para qualquer versao. Um BR Code de PIX cai na
  versao 7 — 45 modulos, 53 com a margem obrigatoria — e 168/53 da' 3,17px por
  modulo. Abaixo de ~4px a camera nao separa um modulo do vizinho: o autofoco
  fica cacando e a leitura falha. Um decodificador que le a imagem pixel a pixel
  acerta assim mesmo, e foi por isso que o [2] acima passava o tempo todo.

  Aqui a medida e' a que a camera enxerga.
*/
jr.settings = { pixKey: 'mods@jukeroom.com', name: 'JUKEROOM MODS', city: 'SAO PAULO' };
jr.root.innerHTML = '';
api.render();

const svg = /<svg[^>]*>/.exec(jr.root.innerHTML)?.[0] ?? '';
const box = /viewBox="0 0 (\d+)/.exec(svg);
const larguraPx = /width="(\d+)"/.exec(svg);

ok(!!box && !!larguraPx, 'o SVG declara viewBox e largura', svg.slice(0, 70));

if (box && larguraPx) {
  const modulos = Number(box[1]);
  const porModulo = Number(larguraPx[1]) / modulos;

  ok(
    porModulo >= 4,
    'cada modulo tem pelo menos 4px na tela',
    `${porModulo.toFixed(2)}px (${larguraPx[1]}px / ${modulos} modulos)`,
  );
}

/*
  E o navegador nao pode SUAVIZAR as bordas ao escalar: o cinza que aparece
  entre modulos vizinhos e' o outro jeito de um QR correto ficar ilegivel.
*/
ok(/crispEdges/.test(svg), 'e as bordas nao sao suavizadas', /shape-rendering[^;"]*/.exec(svg)?.[0]);

/* Codigo curto nao pode ficar minusculo, nem codigo longo estourar o painel. */
const medida = (texto) => {
  const m = api.encodeQr(texto);
  const full = m.length + 8;
  const alvo = Math.max(160, Math.min(280, full * 5));

  return { modulos: full, px: alvo, porModulo: alvo / full };
};

for (const [texto, rotulo] of [
  ['A'.repeat(10), 'codigo curto'],
  ['A'.repeat(287), 'codigo no limite'],
]) {
  const m = medida(texto);

  ok(
    m.px >= 160 && m.px <= 280,
    `${rotulo} fica entre 160 e 280px`,
    `${m.px}px · ${m.porModulo.toFixed(2)}px por modulo`,
  );
}

console.log('\n[6] o codigo que o BANCO recusa nao chega a ser desenhado');

/*
  Os tres defeitos desta secao tinham o MESMO sintoma: um QR bonito na tela e um
  erro generico no app do banco. Nenhum deles aparecia aqui, porque [1] e [2] so'
  perguntavam se o codigo era LEGIVEL — e ele era. Ilegivel e invalido sao
  problemas diferentes, e o segundo so' se vê analisando os campos.
*/

/** Os campos do payload, um a um, como o banco os le'. */
const campos = (s) => {
  const out = {};
  let i = 0;

  while (i + 4 <= s.length) {
    const id = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));

    if (!Number.isInteger(len)) break;

    out[id] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }

  return out;
};

const recusado = (settings, rotulo, esperado) => {
  jr.settings = settings;

  let erro = null;

  try {
    api.brCode(api.config());
  } catch (e) {
    erro = e.message;
  }

  ok(!!erro && new RegExp(esperado, 'i').test(erro), rotulo, erro ?? 'MONTOU o codigo assim mesmo');
};

/*
  O nome do recebedor VAZIO e' o caso mais provavel de todos: e' o estado em que
  o plugin nasce (PADRAO.name e' ''), e nada obrigava a preencher. O campo 59 e'
  obrigatorio no padrao e saia como `5900` — tamanho zero.
*/
recusado({ pixKey: 'x@y.com', city: 'SP' }, 'sem nome do recebedor, nao monta', 'nome do recebedor');
recusado({ pixKey: 'x@y.com', name: '   ' }, 'nome so' + ' com espaco tambem nao', 'nome');
recusado({ pixKey: 'x@y.com', name: 'A', city: '☺' }, 'cidade que some ao limpar', 'cidade');

/*
  `Number('R$ 10,50')` e' NaN, e o "NaN" ia inteiro para dentro do campo 54 —
  `5403NaN`. Agora "R$ 10,50" e' LIDO (ver os casos de money abaixo), porque e'
  o que uma pessoa escreve num campo chamado "valor"; o que sobra sem leitura
  possivel vira recado, e nao um numero inventado.
*/
recusado({ pixKey: 'x@y.com', name: 'A', amount: 'dez reais' }, 'valor por extenso vira recado', 'valor');
recusado({ pixKey: 'x@y.com', name: 'A', amount: '10,5,5' }, 'valor ambiguo tambem', 'valor');

/* Colar o copia e cola inteiro no campo da chave: 26 estouraria os 99 bytes. */
recusado(
  { pixKey: '00020126490014BR.GOV.BCB.PIX0127x@y.com5204000053039865802BR', name: 'A' },
  'copia e cola colado no campo da chave',
  'copia e cola',
);

/* E o que e' valido continua passando — inclusive o que antes virava NaN. */
for (const [texto, esperado] of [
  ['10,50', '10.50'],
  ['10.50', '10.50'],
  ['R$ 10,50', '10.50'],
  ['1.234,56', '1234.56'],
  ['1,234.56', '1234.56'],
  ['1234', '1234.00'],
  ['7', '7.00'],
  ['  25 ', '25.00'],
]) {
  ok(api.money(texto) === esperado, `"${texto}" vira ${esperado}`, String(api.money(texto)));
}

for (const texto of ['', 'abc', '0', '-5', '10,5,5', 'R$']) {
  ok(api.money(texto) === null, `"${texto}" nao vira valor nenhum`, String(api.money(texto)));
}

/*
  A prova final: o payload de uma configuracao COMPLETA, campo a campo. E' o que
  o app do banco faz antes de aceitar.
*/
jr.settings = { pixKey: 'mods@jukeroom.com', name: 'JUKEROOM MODS', city: 'SAO PAULO', amount: 'R$ 10,50' };

const bom = campos(api.brCode(api.config()));

ok(bom['59'].length >= 1 && bom['59'].length <= 25, 'o nome do recebedor tem de 1 a 25', bom['59']);
ok(bom['60'].length >= 1 && bom['60'].length <= 15, 'a cidade tem de 1 a 15', bom['60']);
ok(/^\d+\.\d{2}$/.test(bom['54']), 'o valor sai como numero, e nao como NaN', bom['54']);
ok(bom['53'] === '986' && bom['58'] === 'BR', 'moeda 986 e pais BR');
ok(bom['26'].includes('BR.GOV.BCB.PIX'), 'e o arranjo PIX segue la');

/* Nenhum campo pode passar de 99 bytes, ou o proximo e' lido no lugar errado. */
let estourouCampo = false;

try {
  api.field('26', 'A'.repeat(100));
} catch {
  estourouCampo = true;
}

ok(estourouCampo, 'campo acima de 99 bytes estoura em vez de corromper o resto');

/* E a tela DIZ qual campo abrir, em vez de "configuracao invalida". */
jr.settings = { pixKey: 'x@y.com', city: 'SP' };
jr.root.innerHTML = '';
api.render();

ok(
  /nome do recebedor/i.test(jr.root.innerHTML),
  'e a tela nomeia o campo que falta',
  jr.root.innerHTML
    .replace(/<[^>]+>/g, ' ')
    .trim()
    .slice(0, 60),
);

console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo passou');
process.exit(falhas ? 1 : 0);
