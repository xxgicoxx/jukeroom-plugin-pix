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
  `${src}\nreturn { encodeQr, brCode, config, PADRAO, capacity, utf8, crc16, render };`,
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

console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo passou');
process.exit(falhas ? 1 : 0);
