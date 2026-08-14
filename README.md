# PIX da sala

Plugin de [JukeRoom](https://app.jukeroom.com): mostra um QR Code PIX e um
recado no painel da sala.

> **Ajude o mods!**
> Qualquer valor ajuda a manter a sala no ar.

Quem quiser abre o banco, aponta a câmera e paga. Quem preferir usa o copia e
cola, logo abaixo do código.

## Como usar

1. Bifurque este repositório (a chave PIX é sua, então a cópia também precisa
   ser).
2. Abra `plugin.js` e troque os valores de `CONFIG`, no topo do arquivo:

   ```js
   var CONFIG = {
     key: 'mods@jukeroom.com',   // CPF, CNPJ, e-mail, telefone ou chave aleatória
     name: 'JUKEROOM MODS',      // até 25 caracteres, sem acento
     city: 'SAO PAULO',          // até 15 caracteres, sem acento
     amount: '',                 // '' deixa quem paga escolher o valor
     message: 'Ajude o mods!',
     note: 'Qualquer valor ajuda a manter a sala no ar.',
   };
   ```

3. No JukeRoom, vá em **Plugins → Meus plugins** e publique apontando para o seu
   repositório. Um administrador revisa antes de o plugin entrar na loja.

O servidor guarda uma **cópia** do código no momento de publicar. Trocar o
arquivo no GitHub depois não muda nada nas salas que já instalaram — para
atualizar, publique de novo e a versão nova passa pela revisão.

## Permissões: nenhuma

O manifesto não pede nada. Este plugin não lê a fila, não lê o chat, não sabe
quem está na sala e não escreve em lugar nenhum — ele só desenha.

## Por que o QR é gerado aqui dentro

Não existe chamada a nenhuma API de QR Code, e não é por capricho:

- a moldura de plugin do JukeRoom roda com `connect-src 'none'`. O plugin não
  fala com a rede, e é assim de propósito;
- mandar a chave PIX para um serviço de terceiro só para virar imagem é entregar
  a chave a quem não precisa dela;
- um `<img src="https://...">` faria o navegador de **cada pessoa na sala** bater
  naquele host, entregando o IP de todo mundo a ele.

Por isso `plugin.js` traz um codificador de QR completo: modo byte, correção de
erro M, versões 1 a 12 (até 287 bytes — um BR Code com chave aleatória e nome
longo fica em torno de 155). A saída é SVG, que escala sem borrar.

## Conferindo

O codificador é verificado **decodificando** o que ele desenha, com um leitor de
QR de verdade ([`jsQR`](https://github.com/cozmo/jsQR)) — não por inspeção
visual:

```bash
npm install
npm test
```

O teste também confere o BR Code: indicador de formato, o arranjo
`BR.GOV.BCB.PIX` e o CRC16, recalculado sobre o próprio conteúdo como o app do
banco faz.

## Licença

MIT.
