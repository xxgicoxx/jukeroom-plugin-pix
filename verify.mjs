/* Confere o codificador de QR do plugin decodificando o que ele desenha. */
import fs from 'node:fs';
import jsQR from 'jsqr';

const SRC = new URL('./plugin.js', import.meta.url);
const src = fs.readFileSync(SRC, 'utf8');

// stub do runtime: o plugin chama render() no fim
const jr = {
  root: { innerHTML: '', querySelector: () => null },
  escape: (t) => String(t),
};

const load = new Function(
  'jr',
  `${src}\nreturn { encodeQr, brCode, CONFIG, capacity, utf8, crc16 };`,
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

const payload = api.brCode(api.CONFIG);

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
roundTrip(api.brCode({ ...api.CONFIG, key: '11122233344', amount: '25.50' }), 'com CPF e valor');
roundTrip(
  api.brCode({
    ...api.CONFIG,
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

console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo passou');
process.exit(falhas ? 1 : 0);
