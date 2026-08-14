/*
  PIX da sala — um QR Code e um recado.

  Para que serve: a sala pede uma ajuda ("Ajude o mods!") e quem quiser abre o
  banco, aponta a câmera e pronto. Sem sair da sala, sem link para lugar nenhum.

  ------------------------------------------------------------------------
  O QR é desenhado AQUI, e não buscado de um serviço de QR. Três razões, e a
  primeira sozinha já decide:

  - a moldura de plugin roda com `connect-src 'none'`. O plugin não fala com a
    rede: não há como buscar imagem de API nenhuma, e é assim de propósito;
  - mandar a chave PIX para um servidor de terceiro só para virar imagem é
    entregar a chave a quem não precisa dela;
  - `<img src="https://...">` faria o navegador de CADA pessoa na sala bater
    naquele host, entregando o IP de todo mundo a ele.

  Por isso o arquivo tem um codificador de QR inteiro. Ele é longo, e é a maior
  parte do que está aqui — o plugin em si são as últimas quarenta linhas.
  ------------------------------------------------------------------------

  PARA USAR: instale o plugin na sala e preencha a chave PIX nos AJUSTES dele.
  Nada aqui precisa ser editado — o mesmo código serve para qualquer sala, e
  cada uma guarda a própria configuração.
*/

/*
  A configuração vem da SALA, e não deste arquivo.

  Quem instalou preenche chave, nome, cidade e recado nos ajustes do plugin, e
  os valores chegam em `jr.settings`. O manifesto declara esses campos; o
  servidor só guarda os que estão lá.

  Isso é o que torna o plugin genérico: o mesmo código serve para qualquer sala.
  Com a chave escrita aqui dentro, cada uma precisaria bifurcar o repositório e
  publicar a própria cópia para trocar uma linha — e a chave PIX de alguém
  ficaria no código de todo mundo.

  Os valores abaixo são só o EXEMPLO que aparece antes de alguém preencher.
*/
var PADRAO = {
  pixKey: '',
  name: '',
  city: 'SAO PAULO',
  amount: '',
  message: 'Ajude a sala!',
  note: '',
};

/** O ajuste da sala por cima do exemplo. */
function config() {
  var s = jr.settings || {};
  var out = {};

  for (var k in PADRAO) {
    if (Object.prototype.hasOwnProperty.call(PADRAO, k)) {
      var v = s[k] === undefined || s[k] === null ? '' : String(s[k]).trim();

      out[k] = v || PADRAO[k];
    }
  }

  // o codificador fala 'key'; o ajuste fala 'pixKey', que e' mais claro na tela
  out.key = out.pixKey;

  return out;
}

/* ====================================================================== */
/* BR Code: o texto que vira o QR                                          */
/* ====================================================================== */

/**
 * Um campo no formato EMV: identificador, tamanho em dois dígitos, valor.
 *
 * O tamanho é do valor em BYTES, e não em caracteres — acento em nome de
 * cidade ocupa dois, e um campo com o tamanho errado faz o banco recusar o
 * código inteiro sem dizer por quê.
 */
function field(id, value) {
  var bytes = utf8(String(value));
  var len = String(bytes.length);

  return id + (len.length < 2 ? '0' + len : len) + String(value);
}

/** Só o que o padrão aceita: sem acento, em maiúsculas, sem sobra. */
function plain(text, max) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .toUpperCase()
    .trim()
    .slice(0, max);
}

/**
 * CRC16/CCITT-FALSE, que fecha o BR Code.
 *
 * Calculado sobre a cadeia inteira JÁ com "6304" no fim — o padrão manda
 * incluir o cabeçalho do próprio campo de verificação no cálculo. Errar isso dá
 * um código que parece certo e nenhum banco lê.
 */
function crc16(text) {
  var bytes = utf8(text);
  var crc = 0xffff;

  for (var i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;

    for (var b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  var hex = crc.toString(16).toUpperCase();

  while (hex.length < 4) {
    hex = '0' + hex;
  }

  return hex;
}

/** Monta o BR Code (o "copia e cola" do PIX). */
function brCode(cfg) {
  var account = field('00', 'BR.GOV.BCB.PIX') + field('01', String(cfg.key).trim());
  var value = String(cfg.amount || '').replace(',', '.');
  var out =
    field('00', '01') +
    field('26', account) +
    field('52', '0000') +
    field('53', '986') +
    (value ? field('54', Number(value).toFixed(2)) : '') +
    field('58', 'BR') +
    field('59', plain(cfg.name, 25)) +
    field('60', plain(cfg.city, 15)) +
    // "***" é o txid livre: cada pagamento vira uma transação própria
    field('62', field('05', '***'));

  return out + '6304' + crc16(out + '6304');
}

/** Texto para bytes UTF-8. */
function utf8(text) {
  var out = [];

  for (var i = 0; i < text.length; i++) {
    var c = text.charCodeAt(i);

    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    } else if (c >= 0xd800 && c <= 0xdbff) {
      // par substituto: junta os dois em um ponto de codigo so'
      c = 0x10000 + ((c & 0x3ff) << 10) + (text.charCodeAt(++i) & 0x3ff);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }

  return out;
}

/* ====================================================================== */
/* QR Code: modo byte, correção M, versões 1 a 12                          */
/* ====================================================================== */

/*
  Correção M (recupera ~15%) porque é o que o BR Code do Banco Central
  recomenda: o QR fica numa tela, muitas vezes fotografado de lado e com
  reflexo, e L erra demais nessas condições. Versões até a 12 cobrem 287 bytes —
  um BR Code com chave aleatória e nome longo fica perto de 130.
*/

/** [correção por bloco, blocos do grupo 1, dados por bloco, grupo 2, dados]. */
var BLOCKS = [
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
  [30, 1, 50, 4, 51],
  [22, 6, 36, 2, 37],
];

/** Centros dos padrões de alinhamento, por versão. */
var ALIGN = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
];

/** Informação de versão (18 bits), só da versão 7 em diante. */
var VERSION_BITS = {
  7: 0x07c94,
  8: 0x085bc,
  9: 0x09a99,
  10: 0x0a4d3,
  11: 0x0bbf6,
  12: 0x0c762,
};

/** Formato já pronto (15 bits) para correção M, por máscara. */
var FORMAT_BITS = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];

/* Tabelas do corpo finito GF(256), com o polinômio 0x11D do padrão. */
var EXP = [];
var LOG = [];

(function () {
  var x = 1;

  for (var i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;

    if (x & 0x100) {
      x ^= 0x11d;
    }
  }

  for (var j = 255; j < 512; j++) {
    EXP[j] = EXP[j - 255];
  }
})();

function gfMul(a, b) {
  return a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0;
}

/** Polinômio gerador de grau n. */
function rsGenerator(n) {
  var p = [1];

  for (var i = 0; i < n; i++) {
    var q = [];

    for (var k = 0; k <= p.length; k++) {
      q[k] = 0;
    }

    for (var j = 0; j < p.length; j++) {
      q[j] ^= p[j];
      q[j + 1] ^= gfMul(p[j], EXP[i]);
    }

    p = q;
  }

  return p;
}

/** Os n bytes de correção de um bloco de dados. */
function rsRemainder(data, n) {
  var g = rsGenerator(n);
  var res = [];

  for (var k = 0; k < n; k++) {
    res[k] = 0;
  }

  for (var i = 0; i < data.length; i++) {
    var factor = data[i] ^ res[0];

    res.shift();
    res.push(0);

    if (factor) {
      for (var j = 0; j < n; j++) {
        res[j] ^= gfMul(g[j + 1], factor);
      }
    }
  }

  return res;
}

/** Quantos bytes cabem numa versão. */
function capacity(version) {
  var b = BLOCKS[version - 1];
  var codewords = b[1] * b[2] + b[3] * b[4];
  var countBits = version < 10 ? 8 : 16;

  return Math.floor((codewords * 8 - 4 - countBits) / 8);
}

/**
 * O fluxo de bits: modo, tamanho, dados, terminador e enchimento.
 *
 * O enchimento alterna 0xEC e 0x11 porque o padrão manda — os dois valores
 * foram escolhidos para não formar desenho regular, que é o que atrapalharia a
 * leitura.
 */
function bitStream(bytes, version) {
  var b = BLOCKS[version - 1];
  var total = b[1] * b[2] + b[3] * b[4];
  var bits = [];
  var push = function (value, len) {
    for (var i = len - 1; i >= 0; i--) {
      bits.push((value >> i) & 1);
    }
  };

  push(4, 4);
  push(bytes.length, version < 10 ? 8 : 16);

  for (var i = 0; i < bytes.length; i++) {
    push(bytes[i], 8);
  }

  for (var t = 0; t < 4 && bits.length < total * 8; t++) {
    bits.push(0);
  }

  while (bits.length % 8) {
    bits.push(0);
  }

  var out = [];

  for (var k = 0; k < bits.length; k += 8) {
    var byte = 0;

    for (var n = 0; n < 8; n++) {
      byte = (byte << 1) | bits[k + n];
    }

    out.push(byte);
  }

  var pad = [0xec, 0x11];

  while (out.length < total) {
    out.push(pad[(out.length - Math.ceil(bits.length / 8)) % 2]);
  }

  return out;
}

/**
 * Intercala os blocos de dados e os de correção.
 *
 * Intercalar é o que faz um arranhão no papel estragar um pouco de cada bloco,
 * em vez de destruir um bloco inteiro — cada bloco aguenta a sua cota de erro, e
 * espalhar o estrago é o que mantém todos dentro da cota.
 */
function interleave(codewords, version) {
  var b = BLOCKS[version - 1];
  var ecLen = b[0];
  var blocks = [];
  var at = 0;
  var i;

  for (i = 0; i < b[1]; i++) {
    blocks.push(codewords.slice(at, (at += b[2])));
  }

  for (i = 0; i < b[3]; i++) {
    blocks.push(codewords.slice(at, (at += b[4])));
  }

  var ec = blocks.map(function (block) {
    return rsRemainder(block, ecLen);
  });
  var out = [];
  var longest = Math.max.apply(
    null,
    blocks.map(function (x) {
      return x.length;
    }),
  );

  for (i = 0; i < longest; i++) {
    for (var j = 0; j < blocks.length; j++) {
      if (i < blocks[j].length) {
        out.push(blocks[j][i]);
      }
    }
  }

  for (i = 0; i < ecLen; i++) {
    for (var k = 0; k < ec.length; k++) {
      out.push(ec[k][i]);
    }
  }

  return out;
}

/** Desenha os padrões fixos e marca o que não pode receber dado. */
function skeleton(version) {
  var size = version * 4 + 17;
  var m = [];
  var reserved = [];
  var i;
  var j;

  for (i = 0; i < size; i++) {
    m[i] = [];
    reserved[i] = [];

    for (j = 0; j < size; j++) {
      m[i][j] = 0;
      reserved[i][j] = 0;
    }
  }

  var finder = function (row, col) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var y = row + r;
        var x = col + c;

        if (y < 0 || x < 0 || y >= size || x >= size) {
          continue;
        }

        var on =
          r >= 0 && r <= 6 && (c === 0 || c === 6) ? 1 : c >= 0 && c <= 6 && (r === 0 || r === 6) ? 1 : r >= 2 && r <= 4 && c >= 2 && c <= 4 ? 1 : 0;

        m[y][x] = on;
        reserved[y][x] = 1;
      }
    }
  };

  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // linhas de tempo: a regua que o leitor usa para achar o passo dos modulos
  for (i = 8; i < size - 8; i++) {
    m[6][i] = m[i][6] = i % 2 === 0 ? 1 : 0;
    reserved[6][i] = reserved[i][6] = 1;
  }

  var centers = ALIGN[version - 1];

  for (i = 0; i < centers.length; i++) {
    for (j = 0; j < centers.length; j++) {
      var cy = centers[i];
      var cx = centers[j];

      /*
        Pula SO' os tres cantos, onde o localizador ja' ocupa o lugar.

        Testar "esta reservado?" aqui parece equivalente e nao e': a partir da
        versao 7 existe alinhamento em (6,22) e (22,6), bem em cima da linha de
        tempo — que tambem esta' reservada. A versao anterior pulava esses dois,
        e o resultado era um QR que nenhum leitor abria da versao 7 para cima,
        exatamente onde um BR Code de PIX cai.
      */
      var noCanto =
        (cy <= 8 && cx <= 8) ||
        (cy <= 8 && cx >= size - 9) ||
        (cy >= size - 9 && cx <= 8);

      if (noCanto) {
        continue;
      }

      for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {
          m[cy + dy][cx + dx] =
            Math.max(Math.abs(dy), Math.abs(dx)) === 1 ? 0 : 1;
          reserved[cy + dy][cx + dx] = 1;
        }
      }
    }
  }

  // o modulo escuro, sempre aceso, e o espaco do formato
  m[size - 8][8] = 1;
  reserved[size - 8][8] = 1;

  for (i = 0; i < 9; i++) {
    if (i !== 6) {
      reserved[8][i] = 1;
      reserved[i][8] = 1;
    }
  }

  for (i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = 1;
    reserved[size - 1 - i][8] = 1;
  }

  if (version >= 7) {
    for (i = 0; i < 6; i++) {
      for (j = 0; j < 3; j++) {
        reserved[i][size - 11 + j] = 1;
        reserved[size - 11 + j][i] = 1;
      }
    }
  }

  return { m: m, reserved: reserved, size: size };
}

/** Percorre em ziguezague, de baixo para cima, pulando a coluna 6. */
function placeData(grid, codewords) {
  var size = grid.size;
  var bits = [];
  var i;

  for (i = 0; i < codewords.length; i++) {
    for (var b = 7; b >= 0; b--) {
      bits.push((codewords[i] >> b) & 1);
    }
  }

  var at = 0;
  var upward = true;

  for (var col = size - 1; col > 0; col -= 2) {
    // a coluna 6 e' a linha de tempo vertical: ela nao entra no ziguezague
    if (col === 6) {
      col--;
    }

    for (var step = 0; step < size; step++) {
      var row = upward ? size - 1 - step : step;

      for (var k = 0; k < 2; k++) {
        var x = col - k;

        if (grid.reserved[row][x]) {
          continue;
        }

        grid.m[row][x] = at < bits.length ? bits[at++] : 0;
      }
    }

    upward = !upward;
  }
}

function maskAt(id, row, col) {
  switch (id) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return ((((row + col) % 2) + ((row * col) % 3)) % 2) === 0;
  }
}

/**
 * A nota de feiura de um desenho, pelas quatro regras do padrão.
 *
 * Não é estética: cada regra pune um desenho que atrapalha a LEITURA — trechos
 * longos de uma cor só, quadrados maciços, e o pedaço que imita o localizador,
 * que é o pior deles porque faz o leitor achar canto onde não tem.
 */
function penalty(m, size) {
  var score = 0;
  var i;
  var j;
  var run;
  var dark = 0;

  for (i = 0; i < size; i++) {
    for (j = 0; j < size; j++) {
      if (m[i][j]) {
        dark++;
      }
    }
  }

  var line = function (get) {
    for (i = 0; i < size; i++) {
      run = 1;

      for (j = 1; j < size; j++) {
        if (get(i, j) === get(i, j - 1)) {
          run++;
        } else {
          if (run >= 5) {
            score += 3 + (run - 5);
          }

          run = 1;
        }
      }

      if (run >= 5) {
        score += 3 + (run - 5);
      }
    }
  };

  line(function (a, b) {
    return m[a][b];
  });
  line(function (a, b) {
    return m[b][a];
  });

  for (i = 0; i < size - 1; i++) {
    for (j = 0; j < size - 1; j++) {
      var v = m[i][j];

      if (v === m[i][j + 1] && v === m[i + 1][j] && v === m[i + 1][j + 1]) {
        score += 3;
      }
    }
  }

  var A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  var B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  var match = function (get, a, b) {
    for (var k = 0; k < 11; k++) {
      if (get(a, b + k) !== A[k]) {
        break;
      }

      if (k === 10) {
        return true;
      }
    }

    for (var n = 0; n < 11; n++) {
      if (get(a, b + n) !== B[n]) {
        return false;
      }
    }

    return true;
  };

  for (i = 0; i < size; i++) {
    for (j = 0; j + 10 < size; j++) {
      if (
        match(function (a, b) {
          return m[a][b];
        }, i, j)
      ) {
        score += 40;
      }

      if (
        match(function (a, b) {
          return m[b][a];
        }, i, j)
      ) {
        score += 40;
      }
    }
  }

  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;

  return score;
}

function putFormat(m, size, mask) {
  var bits = FORMAT_BITS[mask];
  var get = function (i) {
    return (bits >> i) & 1;
  };
  var i;

  for (i = 0; i <= 5; i++) {
    m[8][i] = get(i);
    m[i][8] = get(14 - i);
  }

  m[8][7] = get(6);
  m[8][8] = get(7);
  m[7][8] = get(8);

  for (i = 9; i <= 14; i++) {
    m[14 - i][8] = get(i);
  }

  for (i = 0; i <= 7; i++) {
    m[8][size - 1 - i] = get(i);
  }

  for (i = 8; i <= 14; i++) {
    m[size - 15 + i][8] = get(i);
  }
}

function putVersion(m, size, version) {
  if (version < 7) {
    return;
  }

  var bits = VERSION_BITS[version];

  for (var i = 0; i < 18; i++) {
    var bit = (bits >> i) & 1;
    var row = Math.floor(i / 3);
    var col = size - 11 + (i % 3);

    m[row][col] = bit;
    m[col][row] = bit;
  }
}

/** O texto vira uma matriz de 0 e 1. */
function encodeQr(text) {
  var bytes = utf8(text);
  var version = 0;

  for (var v = 1; v <= BLOCKS.length; v++) {
    if (bytes.length <= capacity(v)) {
      version = v;
      break;
    }
  }

  if (!version) {
    throw new Error('conteudo longo demais para o QR');
  }

  var grid = skeleton(version);

  placeData(grid, interleave(bitStream(bytes, version), version));

  /*
    Testa as oito máscaras e fica com a menos ruim.

    Sem isto o código sai legível na maioria das vezes e ilegível numa minoria —
    e a minoria é justamente o conteúdo que forma desenho regular. Escolher fixo
    seria trocar um erro raro e inexplicável por meia dúzia de linhas a menos.
  */
  var best = null;

  for (var mask = 0; mask < 8; mask++) {
    var m = grid.m.map(function (row) {
      return row.slice();
    });

    for (var i = 0; i < grid.size; i++) {
      for (var j = 0; j < grid.size; j++) {
        if (!grid.reserved[i][j] && maskAt(mask, i, j)) {
          m[i][j] ^= 1;
        }
      }
    }

    putFormat(m, grid.size, mask);
    putVersion(m, grid.size, version);

    var score = penalty(m, grid.size);

    if (!best || score < best.score) {
      best = { m: m, score: score };
    }
  }

  return best.m;
}

/* ====================================================================== */
/* A tela                                                                  */
/* ====================================================================== */

/** A matriz vira SVG: escala sozinho e não borra como imagem esticada. */
function qrSvg(matrix, box) {
  var size = matrix.length;
  // margem obrigatoria de 4 modulos: sem ela o leitor nao acha a borda
  var quiet = 4;
  var full = size + quiet * 2;
  var path = '';

  for (var i = 0; i < size; i++) {
    for (var j = 0; j < size; j++) {
      if (matrix[i][j]) {
        path += 'M' + (j + quiet) + ' ' + (i + quiet) + 'h1v1h-1z';
      }
    }
  }

  return (
    '<svg viewBox="0 0 ' +
    full +
    ' ' +
    full +
    '" width="' +
    box +
    '" height="' +
    box +
    '" role="img" aria-label="QR Code do PIX" style="border-radius:8px">' +
    '<rect width="' +
    full +
    '" height="' +
    full +
    '" fill="#fff"/>' +
    '<path d="' +
    path +
    '" fill="#000"/></svg>'
  );
}

function render() {
  var cfg = config();

  /*
    Sem chave, o plugin EXPLICA em vez de mostrar um QR quebrado.

    É o estado em que ele nasce: instalado e ainda não configurado. Desenhar um
    código inválido aqui seria pior que não desenhar nada — alguém pagaria para
    o lugar errado, ou o banco recusaria sem dizer por quê.
  */
  if (!cfg.key) {
    jr.root.innerHTML =
      '<p class="jr-empty">Nenhuma chave PIX configurada ainda.<br>' +
      '<span class="jr-faint">Quem modera a sala preenche isso nos ajustes do plugin.</span></p>';

    return;
  }

  var payload;

  try {
    payload = brCode(cfg);
  } catch (e) {
    jr.root.innerHTML = '<p class="jr-empty">Configuração do PIX inválida.</p>';

    return;
  }

  var svg;

  try {
    svg = qrSvg(encodeQr(payload), 168);
  } catch (e) {
    jr.root.innerHTML = '<p class="jr-empty">' + jr.escape(e.message) + '</p>';

    return;
  }

  jr.root.innerHTML =
    '<div style="text-align:center">' +
    '<div class="jr-strong" style="font-size:15px">' +
    jr.escape(cfg.message) +
    '</div>' +
    (cfg.note
      ? '<div class="jr-muted" style="margin-top:2px">' + jr.escape(cfg.note) + '</div>'
      : '') +
    '</div>' +
    '<div style="display:flex;justify-content:center">' +
    svg +
    '</div>' +
    '<div class="jr-muted" style="text-align:center">Ou use o copia e cola:</div>' +
    // readonly + clique que seleciona tudo: `navigator.clipboard` nao vale numa
    // origem opaca, e um botao "copiar" que nao copia e' pior que nao ter botao
    '<input type="text" readonly data-field="code" value="' +
    jr.escape(payload) +
    '" aria-label="Codigo PIX copia e cola">';

  var input = jr.root.querySelector('input[data-field="code"]');

  if (input) {
    input.onclick = function () {
      this.select();
    };
  }
}

jr.on('settings', render);

render();
